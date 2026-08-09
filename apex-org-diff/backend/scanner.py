"""
scanner.py - Scans two folders for Apex .cls files and builds a diff index.

All file reading happens once at startup; subsequent requests use an in-memory
dictionary for O(1) lookups.
"""
from __future__ import annotations

import difflib
import logging
import os
import threading
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures import wait as futures_wait
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.models import (
    ApexClassContent,
    ApexClassDetail,
    ApexClassMeta,
    ClassStatus,
    DiffStats,
    DiffSummary,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _read_cls_file(path: Path) -> Tuple[ApexClassContent, str]:
    """
    Read a single .cls file safely.

    Returns (ApexClassContent, original_filename_with_case).
    """
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        return (
            ApexClassContent(
                exists=True,
                content=content,
                # Actual on-disk size, not a re-encode of `content` (which
                # would double the work of reading a large file just to
                # count bytes we already know from the filesystem).
                size_bytes=path.stat().st_size,
            ),
            path.name,   # original case filename
        )
    except PermissionError as exc:
        logger.warning("Permission denied reading %s: %s", path, exc)
        return ApexClassContent(exists=True, content="", error=f"Permission denied: {exc}"), path.name
    except OSError as exc:
        logger.warning("OS error reading %s: %s", path, exc)
        return ApexClassContent(exists=True, content="", error=f"OS error: {exc}"), path.name


def _collect_cls_paths(folder: Path) -> Tuple[Dict[str, Path], list]:
    """
    Walk *folder* and decide, per lowercase filename, which path wins (first
    occurrence in os.walk order). No file content is read here — this is a
    cheap directory-tree pass so the expensive part (reading file contents)
    can be parallelized afterwards without disturbing which file "wins" a
    duplicate filename.

    Returns (kept_path, duplicates) — same duplicate-reporting shape as before.
    """
    kept_path: Dict[str, Path] = {}
    duplicates: list = []

    for root, _dirs, files in os.walk(folder):
        for filename in files:
            if not filename.lower().endswith(".cls"):
                continue
            filepath = Path(root) / filename
            key = filename.lower()
            if key in kept_path:
                logger.warning(
                    "Duplicate .cls filename '%s' found; keeping first occurrence. "
                    "Ignoring: %s",
                    filename,
                    filepath,
                )
                duplicates.append({
                    "name": filename,
                    "kept_path": str(kept_path[key]),
                    "ignored_path": str(filepath),
                })
                continue
            kept_path[key] = filepath

    return kept_path, duplicates


# Overall budget for the batch of file reads in _scan_folders. Cloud-synced
# folders (OneDrive, Dropbox, etc. — this project's own directory is one)
# can hold "cloud-only" placeholder files that trigger a slow on-demand
# download the moment they're opened, which can stall a plain read for a
# long time. A per-batch cap means a handful of unhydrated files delay
# readiness by at most this long instead of indefinitely; the offending
# files are reported as errors (has_error) rather than silently hanging.
_SCAN_TIMEOUT_SECONDS = 30


def _validate_folder(folder: Path) -> bool:
    if not folder.exists():
        logger.error("Folder does not exist: %s", folder)
        return False
    if not folder.is_dir():
        logger.error("Path is not a directory: %s", folder)
        return False
    return True


def _scan_folders(
    folder_a: Path, folder_b: Path
) -> Tuple[
    Dict[str, Tuple[ApexClassContent, str]],
    Dict[str, Tuple[ApexClassContent, str]],
    Dict[str, Path],
    Dict[str, Path],
    list,
    list,
]:
    """
    Scan both org folders and read every .cls file found.

    Returns (result_a, result_b, kept_a, kept_b, duplicates_a, duplicates_b):
    result dicts are keyed by lowercase filename, value (ApexClassContent,
    original filename); kept_a/kept_b are the same keys mapped to the
    on-disk Path (kept around so callers can re-read a file's content later
    without holding it in memory); duplicates describe same-name files
    within one org (see _collect_cls_paths).

    File reads are I/O-bound (and can be slow on network drives or
    cloud-synced folders like OneDrive), so both orgs' files are read
    through a single shared thread pool: org A and org B's reads overlap
    instead of finishing one folder fully before starting the other.
    """
    result_a: Dict[str, Tuple[ApexClassContent, str]] = {}
    result_b: Dict[str, Tuple[ApexClassContent, str]] = {}

    kept_a, dupes_a = _collect_cls_paths(folder_a) if _validate_folder(folder_a) else ({}, [])
    kept_b, dupes_b = _collect_cls_paths(folder_b) if _validate_folder(folder_b) else ({}, [])

    # (target dict, key, path) so results from the shared pool route back
    # to the correct org's result dict.
    jobs = [(result_a, k, p) for k, p in kept_a.items()] + \
           [(result_b, k, p) for k, p in kept_b.items()]

    if jobs:
        max_workers = min(64, len(jobs))
        executor = ThreadPoolExecutor(max_workers=max_workers)
        futures = {
            executor.submit(_read_cls_file, path): (target, key, path)
            for target, key, path in jobs
        }
        done, not_done = futures_wait(futures.keys(), timeout=_SCAN_TIMEOUT_SECONDS)
        for future in done:
            target, key, _path = futures[future]
            target[key] = future.result()
        for future in not_done:
            target, key, path = futures[future]
            logger.warning(
                "Timed out after %ds reading %s — treating as unreadable. "
                "Likely a cloud-only file (OneDrive/Dropbox/etc.) that hasn't "
                "finished downloading locally.",
                _SCAN_TIMEOUT_SECONDS, path,
            )
            target[key] = (
                ApexClassContent(
                    exists=True,
                    content="",
                    error=(
                        f"Timed out after {_SCAN_TIMEOUT_SECONDS}s reading file — "
                        "it may be a cloud-only file (OneDrive/Dropbox/etc.) that "
                        "hasn't finished downloading locally."
                    ),
                ),
                path.name,
            )
        # Threads still stuck on a slow/hung read are abandoned rather than
        # waited on — shutdown(wait=False) lets the scan (and therefore the
        # rest of the build) proceed on schedule instead of being held
        # hostage by whichever file was slowest.
        executor.shutdown(wait=False)

    return result_a, result_b, kept_a, kept_b, dupes_a, dupes_b


def _resolve_status(in_a: bool, in_b: bool, identical: bool) -> ClassStatus:
    """Compute ClassStatus from presence/identity flags."""
    if in_a and in_b:
        return ClassStatus.IDENTICAL if identical else ClassStatus.MODIFIED
    if in_a:
        return ClassStatus.ONLY_IN_ORG_A
    return ClassStatus.ONLY_IN_ORG_B


def _compute_diff_stats(content_a: str, content_b: str) -> DiffStats:
    """
    Compute line-level diff stats between two content strings.

    Uses SequenceMatcher.get_opcodes() rather than difflib.ndiff: both agree
    exactly on added/removed line counts (ndiff's "+ "/"- " lines are just
    its insert/delete opcodes), but ndiff also does an expensive char-level
    "fancy replace" pass to align near-identical lines for human-readable
    output — work this function throws away anyway since it only wants
    counts. Skipping it is ~5x faster and matters here because this runs
    once per modified file for every file pair at startup, on the request
    path before the server starts serving.
    """
    lines_a = content_a.splitlines(keepends=True)
    lines_b = content_b.splitlines(keepends=True)

    added = 0
    removed = 0

    matcher = difflib.SequenceMatcher(None, lines_a, lines_b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("delete", "replace"):
            removed += i2 - i1
        if tag in ("insert", "replace"):
            added += j2 - j1

    return DiffStats(
        lines_added=added,
        lines_removed=removed,
        lines_changed=added + removed,
    )


# Below this many modified-file pairs, spinning up a process pool costs more
# than it saves. On Windows (spawn, not fork) each worker re-imports the
# entry script's full module tree before it can run anything — for
# apex_diff.py that means re-importing uvicorn + FastAPI/Starlette, measured
# at ~1.1s of pure import time alone, on top of process-creation overhead.
# Benchmarked against that real cost (not just bare _compute_diff_stats) the
# break-even was a noisy ~300 jobs; 500 keeps a safety margin above it so the
# pool only engages when it's a confident win rather than a wash.
_PARALLEL_DIFF_MIN_JOBS = 500


def _compute_diff_stats_batch(jobs: List[Tuple[str, str, str]]) -> Dict[str, DiffStats]:
    """
    Compute diff stats for every modified-file pair, in parallel.

    _compute_diff_stats is pure-Python SequenceMatcher work that holds the
    GIL, so — unlike the I/O-bound file reads in _scan_folders — a thread
    pool can't parallelize it; only real OS processes can. This is the
    dominant cost of index-build for orgs with many modified classes (it
    can be 10x+ the cost of reading every file), so for large jobs it's
    spread across a process pool instead of running serially.

    jobs: list of (key, content_a, content_b).
    Returns {key: DiffStats}.
    """
    if not jobs:
        return {}

    if len(jobs) < _PARALLEL_DIFF_MIN_JOBS:
        return {key: _compute_diff_stats(a, b) for key, a, b in jobs}

    keys = [key for key, _, _ in jobs]
    contents_a = [a for _, a, _ in jobs]
    contents_b = [b for _, _, b in jobs]

    try:
        max_workers = min(os.cpu_count() or 1, len(jobs))
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            results = list(
                executor.map(_compute_diff_stats, contents_a, contents_b, chunksize=8)
            )
        return dict(zip(keys, results))
    except Exception:
        # On Windows, starting a process pool requires the entry point to
        # be guarded by `if __name__ == "__main__":`; a caller that skips
        # that guard (or any other pool-startup failure, e.g. a sandboxed
        # environment that can't spawn processes) falls back to sequential
        # computation rather than crashing the whole scan.
        logger.warning(
            "Process pool unavailable for diff-stat computation; "
            "falling back to sequential (slower for large orgs)",
            exc_info=True,
        )
        return {key: _compute_diff_stats(a, b) for key, a, b in jobs}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class DiffIndex:
    """
    In-memory index of all Apex class comparisons between two org folders.

    Built once at startup; O(1) metadata lookups thereafter. Full file
    content is *not* retained after building — only the small per-class
    stats (ApexClassMeta) and the on-disk paths are kept, so steady-state
    memory stays small regardless of how much source text the org holds.
    get_class_detail() re-reads the one or two files it needs from disk on
    demand, which is fast for a single file and avoids paying for content
    that's never actually viewed.
    """

    def __init__(
        self, org_a_path: str, org_b_path: str, *, build_immediately: bool = True
    ) -> None:
        self.org_a_path = str(Path(org_a_path).resolve())
        self.org_b_path = str(Path(org_b_path).resolve())

        self._meta: Dict[str, ApexClassMeta] = {}
        self._paths_a: Dict[str, Path] = {}
        self._paths_b: Dict[str, Path] = {}
        self.summary = DiffSummary(org_a_path=self.org_a_path, org_b_path=self.org_b_path)

        # Set once _build() finishes. Lets a caller (e.g. apex_diff.py) build
        # the index on a background thread while the server is already
        # accepting connections, instead of blocking startup on a scan that
        # can take a while for a large org.
        self._ready = threading.Event()

        if build_immediately:
            self.build()

    # ------------------------------------------------------------------
    def build(self) -> None:
        """
        Build the index. Safe to call from a background thread when the
        constructor was given build_immediately=False; is_ready()/
        wait_until_ready() report completion.
        """
        self._build()
        self._ready.set()

    def is_ready(self) -> bool:
        return self._ready.is_set()

    def wait_until_ready(self, timeout: Optional[float] = None) -> bool:
        return self._ready.wait(timeout)

    # ------------------------------------------------------------------
    def _build(self) -> None:
        logger.info("Scanning Org A: %s", self.org_a_path)
        logger.info("Scanning Org B: %s", self.org_b_path)
        a_map, b_map, paths_a, paths_b, a_dupes, b_dupes = _scan_folders(
            Path(self.org_a_path), Path(self.org_b_path)
        )
        self._paths_a = paths_a
        self._paths_b = paths_b
        logger.info("Found %d .cls files in Org A", len(a_map))
        logger.info("Found %d .cls files in Org B", len(b_map))

        for d in a_dupes:
            d["org"] = "a"
        for d in b_dupes:
            d["org"] = "b"
        self.summary.duplicates = a_dupes + b_dupes
        if self.summary.duplicates:
            logger.warning(
                "%d duplicate .cls filename(s) ignored across both orgs — see summary.duplicates",
                len(self.summary.duplicates),
            )

        all_keys = sorted(set(a_map) | set(b_map))
        logger.info("Total unique Apex classes: %d", len(all_keys))

        # Pass 1: resolve status/identity per class (cheap) and collect the
        # content pairs that need a full diff, so that work can be batched
        # and parallelized in one shot below instead of run inline here.
        resolved: Dict[str, Tuple[str, ClassStatus, ApexClassContent, ApexClassContent, bool]] = {}
        diff_jobs: List[Tuple[str, str, str]] = []

        for key in all_keys:
            a_entry = a_map.get(key)
            b_entry = b_map.get(key)

            a_content: ApexClassContent = a_entry[0] if a_entry else ApexClassContent(exists=False)
            b_content: ApexClassContent = b_entry[0] if b_entry else ApexClassContent(exists=False)

            # Preserve original-case filename (prefer A, fall back to B)
            original_name: str = (a_entry[1] if a_entry else b_entry[1])  # type: ignore[index]

            in_a = a_content.exists
            in_b = b_content.exists
            has_error = bool(a_content.error) or bool(b_content.error)
            # A read error always leaves .content == "", so without the
            # has_error guard two unreadable files (or one unreadable file
            # that happens to match a genuinely empty file on the other
            # side) would compare equal and get reported as "Identical" —
            # hiding a read failure inside the one status users are least
            # likely to double-check.
            identical = (
                in_a and in_b and not has_error
                and (a_content.content == b_content.content)
            )
            status = _resolve_status(in_a, in_b, identical)

            resolved[key] = (original_name, status, a_content, b_content, has_error)
            if status == ClassStatus.MODIFIED:
                diff_jobs.append((key, a_content.content, b_content.content))

        diff_stats_by_key = _compute_diff_stats_batch(diff_jobs)

        for key in all_keys:
            original_name, status, a_content, b_content, has_error = resolved[key]
            in_a = a_content.exists
            in_b = b_content.exists
            identical = status == ClassStatus.IDENTICAL

            # Compute diff stats at index-build time (cached)
            if status == ClassStatus.MODIFIED:
                diff_stats = diff_stats_by_key[key]
            elif status == ClassStatus.ONLY_IN_ORG_A:
                lines = len(a_content.content.splitlines())
                diff_stats = DiffStats(lines_added=0, lines_removed=lines, lines_changed=lines)
            elif status == ClassStatus.ONLY_IN_ORG_B:
                lines = len(b_content.content.splitlines())
                diff_stats = DiffStats(lines_added=lines, lines_removed=0, lines_changed=lines)
            else:
                diff_stats = DiffStats()

            meta = ApexClassMeta(
                name=original_name,
                status=status,
                in_org_a=in_a,
                in_org_b=in_b,
                is_identical=identical,
                diff_stats=diff_stats,
                has_error=has_error,
            )

            self._meta[key] = meta

            # Update summary counters
            self.summary.total += 1
            if status == ClassStatus.MODIFIED:
                self.summary.modified += 1
            elif status == ClassStatus.IDENTICAL:
                self.summary.identical += 1
            elif status == ClassStatus.ONLY_IN_ORG_A:
                self.summary.only_in_org_a += 1
            elif status == ClassStatus.ONLY_IN_ORG_B:
                self.summary.only_in_org_b += 1

        logger.info(
            "Index built: total=%d modified=%d identical=%d only_a=%d only_b=%d",
            self.summary.total,
            self.summary.modified,
            self.summary.identical,
            self.summary.only_in_org_a,
            self.summary.only_in_org_b,
        )

    # ------------------------------------------------------------------
    def get_all_meta(self) -> list[dict]:
        """Return list of metadata dicts for all classes (no content)."""
        return [m.to_dict() for m in self._meta.values()]

    def get_class_detail(self, class_name: str) -> Optional[dict]:
        """
        Return full detail dict for a class by name, reading its content
        from disk on demand (content isn't kept in memory after build).

        *class_name* matching is case-insensitive and extension-tolerant
        (works with or without .cls suffix).
        """
        key = _normalise_key(class_name)
        meta = self._meta.get(key)
        if meta is None:
            return None

        path_a = self._paths_a.get(key)
        path_b = self._paths_b.get(key)
        content_a = _read_cls_file(path_a)[0] if path_a else ApexClassContent(exists=False)
        content_b = _read_cls_file(path_b)[0] if path_b else ApexClassContent(exists=False)

        detail = ApexClassDetail(
            name=meta.name,
            status=meta.status,
            org_a=content_a,
            org_b=content_b,
            diff_stats=meta.diff_stats,
        )
        return detail.to_dict()

    def get_summary(self) -> dict:
        return self.summary.to_dict()


# ---------------------------------------------------------------------------
# Key normalisation helper (used by API layer too)
# ---------------------------------------------------------------------------

def _normalise_key(name: str) -> str:
    """
    Normalise a class name to the internal dict key.

    Strips whitespace, lowercases, and ensures .cls suffix.
    """
    name = name.strip().lower()
    if not name.endswith(".cls"):
        name = name + ".cls"
    return name


# Expose so api.py can import it
normalise_key = _normalise_key
