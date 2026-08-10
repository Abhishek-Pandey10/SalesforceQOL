"""
scanner.py - Scans two folders for LWC component bundles and builds a diff
index.

An Apex class is one file; an LWC component is a *bundle* of files. This
scanner works in two passes: first it locates bundle directories (a folder
whose name matches a `<name>.js-meta.xml` file directly inside it - the
standard SFDX marker for "this directory is a Lightning Web Component"),
then it reads every file inside each bundle (including __tests__/, .css,
.svg, etc.) so the diff is complete, not just the .js/.html pair.

All file reading happens once at startup; subsequent requests use an
in-memory dictionary for O(1) lookups, same as apex-org-diff.
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
    DiffStats,
    DiffStatus,
    DiffSummary,
    LwcComponentDetail,
    LwcComponentMeta,
    LwcFileContent,
    LwcFileDetail,
    LwcFileMeta,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bundle discovery
# ---------------------------------------------------------------------------

def _is_bundle_dir(dirname: str, filenames: List[str]) -> bool:
    """A directory is an LWC bundle root iff it directly contains a
    `<dirname>.js-meta.xml` file (case-insensitive) - the same marker the
    Salesforce CLI and Metadata API use to identify a component bundle."""
    meta_name = f"{dirname}.js-meta.xml".lower()
    return any(f.lower() == meta_name for f in filenames)


def _find_bundle_roots(folder: Path) -> Tuple[Dict[str, Path], list]:
    """
    Walk *folder* looking for LWC bundle directories.

    Returns (kept, duplicates): kept maps lowercased component name -> bundle
    root Path (first occurrence wins); duplicates lists any additional bundle
    with the same name found elsewhere in the tree (same shape as
    apex-org-diff's duplicate reporting).

    Does not descend into a bundle's own subdirectories (__tests__, etc.)
    looking for further bundles - once a directory is identified as a
    bundle root, everything under it belongs to that bundle.
    """
    kept: Dict[str, Path] = {}
    duplicates: list = []

    for root, dirs, files in os.walk(folder):
        root_path = Path(root)
        if root_path == folder:
            continue  # the org root itself is never a bundle
        if _is_bundle_dir(root_path.name, files):
            key = root_path.name.lower()
            if key in kept:
                logger.warning(
                    "Duplicate LWC component '%s' found; keeping first "
                    "occurrence. Ignoring: %s", root_path.name, root_path,
                )
                duplicates.append({
                    "name": root_path.name,
                    "kept_path": str(kept[key]),
                    "ignored_path": str(root_path),
                })
            else:
                kept[key] = root_path
            dirs[:] = []  # don't look for nested bundles inside this one

    return kept, duplicates


def _collect_bundle_files(bundle_root: Path) -> Dict[str, Tuple[Path, str]]:
    """
    Every file inside *bundle_root* (recursively, so __tests__/*.test.js is
    included), keyed by lowercased POSIX-style relative path.

    Returns {lowercased_rel_path: (path, original_rel_path_with_case)}.
    """
    out: Dict[str, Tuple[Path, str]] = {}
    for root, _dirs, files in os.walk(bundle_root):
        for filename in files:
            path = Path(root) / filename
            rel = path.relative_to(bundle_root).as_posix()
            out[rel.lower()] = (path, rel)
    return out


# ---------------------------------------------------------------------------
# File reading
# ---------------------------------------------------------------------------

def _read_file(path: Path) -> LwcFileContent:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        return LwcFileContent(
            exists=True,
            content=content,
            size_bytes=path.stat().st_size,
        )
    except PermissionError as exc:
        logger.warning("Permission denied reading %s: %s", path, exc)
        return LwcFileContent(exists=True, content="", error=f"Permission denied: {exc}")
    except OSError as exc:
        logger.warning("OS error reading %s: %s", path, exc)
        return LwcFileContent(exists=True, content="", error=f"OS error: {exc}")


def _validate_folder(folder: Path) -> bool:
    if not folder.exists():
        logger.error("Folder does not exist: %s", folder)
        return False
    if not folder.is_dir():
        logger.error("Path is not a directory: %s", folder)
        return False
    return True


# Overall budget for a batch of file reads. Cloud-synced folders (OneDrive,
# Dropbox, etc.) can hold "cloud-only" placeholder files that trigger a slow
# on-demand download the moment they're opened; a per-batch cap means a
# handful of unhydrated files delay readiness by at most this long instead
# of indefinitely, and are reported as read errors rather than hanging.
_SCAN_TIMEOUT_SECONDS = 30

# ComponentKey, FileKey identify a bundle and a file within it.
_ReadJob = Tuple[str, str, str, Path]  # (org, component_key, file_key, path)


def _discover(folder: Path) -> Tuple[Dict[str, Tuple[Dict[str, Tuple[Path, str]], str]], list]:
    """
    Discover every bundle in *folder* and every file inside each bundle.

    Returns (bundles, duplicates), where bundles maps
    component_key -> (files_map, original_component_name) and files_map maps
    file_key -> (path, original_rel_path).
    """
    roots, duplicates = _find_bundle_roots(folder) if _validate_folder(folder) else ({}, [])
    bundles: Dict[str, Tuple[Dict[str, Tuple[Path, str]], str]] = {}
    for key, root in roots.items():
        bundles[key] = (_collect_bundle_files(root), root.name)
    return bundles, duplicates


def _read_all_files(
    bundles_a: Dict[str, Tuple[Dict[str, Tuple[Path, str]], str]],
    bundles_b: Dict[str, Tuple[Dict[str, Tuple[Path, str]], str]],
) -> Tuple[Dict[str, Dict[str, LwcFileContent]], Dict[str, Dict[str, LwcFileContent]]]:
    """
    Read every file in every bundle from both orgs through one shared thread
    pool (I/O-bound reads overlap instead of finishing org A before org B
    starts) and return {component_key: {file_key: LwcFileContent}} for each
    org.
    """
    jobs: List[_ReadJob] = []
    for key, (files, _name) in bundles_a.items():
        for fkey, (path, _rel) in files.items():
            jobs.append(("a", key, fkey, path))
    for key, (files, _name) in bundles_b.items():
        for fkey, (path, _rel) in files.items():
            jobs.append(("b", key, fkey, path))

    result_a: Dict[str, Dict[str, LwcFileContent]] = {k: {} for k in bundles_a}
    result_b: Dict[str, Dict[str, LwcFileContent]] = {k: {} for k in bundles_b}
    targets = {"a": result_a, "b": result_b}

    if not jobs:
        return result_a, result_b

    max_workers = min(64, len(jobs))
    executor = ThreadPoolExecutor(max_workers=max_workers)
    futures = {
        executor.submit(_read_file, path): (org, key, fkey)
        for org, key, fkey, path in jobs
    }
    done, not_done = futures_wait(futures.keys(), timeout=_SCAN_TIMEOUT_SECONDS)
    for future in done:
        org, key, fkey = futures[future]
        targets[org][key][fkey] = future.result()
    for future in not_done:
        org, key, fkey = futures[future]
        logger.warning(
            "Timed out after %ds reading a file in bundle '%s' - treating "
            "as unreadable. Likely a cloud-only file (OneDrive/Dropbox/etc.) "
            "that hasn't finished downloading locally.",
            _SCAN_TIMEOUT_SECONDS, key,
        )
        targets[org][key][fkey] = LwcFileContent(
            exists=True,
            content="",
            error=(
                f"Timed out after {_SCAN_TIMEOUT_SECONDS}s reading file - it "
                "may be a cloud-only file (OneDrive/Dropbox/etc.) that "
                "hasn't finished downloading locally."
            ),
        )
    # Threads still stuck on a slow/hung read are abandoned rather than
    # waited on, so the rest of the build isn't held hostage by one file.
    executor.shutdown(wait=False)

    return result_a, result_b


# ---------------------------------------------------------------------------
# Diff computation
# ---------------------------------------------------------------------------

def _resolve_status(in_a: bool, in_b: bool, identical: bool) -> DiffStatus:
    """Compute a DiffStatus from presence/identity flags. Shared by both
    file-level and component-level status resolution."""
    if in_a and in_b:
        return DiffStatus.IDENTICAL if identical else DiffStatus.MODIFIED
    if in_a:
        return DiffStatus.ONLY_IN_ORG_A
    return DiffStatus.ONLY_IN_ORG_B


def _compute_diff_stats(content_a: str, content_b: str) -> DiffStats:
    """
    Line-level diff stats via SequenceMatcher.get_opcodes() - agrees with
    difflib.ndiff on added/removed counts but skips ndiff's char-level
    "fancy replace" alignment pass, which this function doesn't need since it
    only wants counts. Runs once per changed file pair at index-build time.
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

    return DiffStats(lines_added=added, lines_removed=removed, lines_changed=added + removed)


# Below this many modified-file pairs, spinning up a process pool costs more
# than it saves (Windows re-imports the entry script's full module tree -
# uvicorn + FastAPI/Starlette - in every spawned worker). See
# apex-org-diff/backend/scanner.py for the benchmark this threshold is
# carried over from.
_PARALLEL_DIFF_MIN_JOBS = 500


def _compute_diff_stats_batch(jobs: List[Tuple[str, str, str]]) -> Dict[str, DiffStats]:
    """
    Compute diff stats for every modified-file pair, in parallel once the
    batch is large enough to be worth process-pool startup cost.

    jobs: list of (composite_key, content_a, content_b). Returns
    {composite_key: DiffStats}.
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
        # On Windows, a process pool requires the entry point to be guarded
        # by `if __name__ == "__main__":`; any pool-startup failure falls
        # back to sequential computation rather than crashing the scan.
        logger.warning(
            "Process pool unavailable for diff-stat computation; falling "
            "back to sequential (slower for large orgs)",
            exc_info=True,
        )
        return {key: _compute_diff_stats(a, b) for key, a, b in jobs}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class DiffIndex:
    """
    In-memory index of all LWC component comparisons between two org
    folders. Built once at startup; O(1) metadata lookups thereafter.

    Unlike apex-org-diff (which re-reads a class's content on demand),
    component bundles are small (a handful of short files), so their content
    is kept in memory for the lifetime of the index rather than re-read per
    request - the memory cost is negligible and it avoids a filesystem
    round-trip per file tab click.
    """

    def __init__(
        self, org_a_path: str, org_b_path: str, *, build_immediately: bool = True
    ) -> None:
        self.org_a_path = str(Path(org_a_path).resolve())
        self.org_b_path = str(Path(org_b_path).resolve())

        self._meta: Dict[str, LwcComponentMeta] = {}
        self._detail: Dict[str, LwcComponentDetail] = {}
        self.summary = DiffSummary(org_a_path=self.org_a_path, org_b_path=self.org_b_path)

        self._ready = threading.Event()

        if build_immediately:
            self.build()

    # ------------------------------------------------------------------
    def build(self) -> None:
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

        bundles_a, dupes_a = _discover(Path(self.org_a_path))
        bundles_b, dupes_b = _discover(Path(self.org_b_path))
        logger.info("Found %d LWC component(s) in Org A", len(bundles_a))
        logger.info("Found %d LWC component(s) in Org B", len(bundles_b))

        for d in dupes_a:
            d["org"] = "a"
        for d in dupes_b:
            d["org"] = "b"
        self.summary.duplicates = dupes_a + dupes_b
        if self.summary.duplicates:
            logger.warning(
                "%d duplicate component name(s) ignored across both orgs",
                len(self.summary.duplicates),
            )

        contents_a, contents_b = _read_all_files(bundles_a, bundles_b)

        all_component_keys = sorted(set(bundles_a) | set(bundles_b))
        logger.info("Total unique LWC components: %d", len(all_component_keys))

        # Pass 1: resolve per-file status/identity (cheap) for every
        # component and collect the content pairs that need a full diff, so
        # that work can be batched and parallelized in one shot below.
        diff_jobs: List[Tuple[str, str, str]] = []  # (composite_key, a, b)
        component_files: Dict[str, List[dict]] = {}  # component_key -> list of working dicts

        for ckey in all_component_keys:
            a_files, a_name = bundles_a.get(ckey, ({}, None))
            b_files, b_name = bundles_b.get(ckey, ({}, None))
            a_contents = contents_a.get(ckey, {})
            b_contents = contents_b.get(ckey, {})

            file_keys = sorted(set(a_files) | set(b_files))
            working: List[dict] = []
            for fkey in file_keys:
                a_content = a_contents.get(fkey, LwcFileContent(exists=False))
                b_content = b_contents.get(fkey, LwcFileContent(exists=False))
                original_rel = (a_files[fkey][1] if fkey in a_files else b_files[fkey][1])

                in_a = a_content.exists
                in_b = b_content.exists
                has_error = bool(a_content.error) or bool(b_content.error)
                identical = (
                    in_a and in_b and not has_error
                    and (a_content.content == b_content.content)
                )
                status = _resolve_status(in_a, in_b, identical)

                entry = {
                    "rel": original_rel,
                    "status": status,
                    "a": a_content,
                    "b": b_content,
                    "has_error": has_error,
                }
                working.append(entry)

                if status == DiffStatus.MODIFIED:
                    diff_jobs.append((f"{ckey}::{fkey}", a_content.content, b_content.content))

            component_files[ckey] = working

        diff_stats_by_key = _compute_diff_stats_batch(diff_jobs)

        # Pass 2: assemble per-file metas/details and roll them up into
        # component-level meta/detail.
        for ckey in all_component_keys:
            a_files, a_name = bundles_a.get(ckey, ({}, None))
            b_files, b_name = bundles_b.get(ckey, ({}, None))
            component_name = a_name or b_name
            in_a_comp = ckey in bundles_a
            in_b_comp = ckey in bundles_b

            working = component_files[ckey]
            file_keys = sorted(set(a_files) | set(b_files))  # same order `working` was built in
            file_metas: List[dict] = []
            file_details: List[dict] = []
            comp_stats = DiffStats()
            comp_has_error = False
            comp_all_identical = True

            for idx, entry in enumerate(working):
                a_content: LwcFileContent = entry["a"]
                b_content: LwcFileContent = entry["b"]
                status: DiffStatus = entry["status"]
                has_error: bool = entry["has_error"]
                comp_has_error = comp_has_error or has_error

                if status == DiffStatus.MODIFIED:
                    fkey = file_keys[idx]
                    stats = diff_stats_by_key[f"{ckey}::{fkey}"]
                    comp_all_identical = False
                elif status == DiffStatus.ONLY_IN_ORG_A:
                    lines = len(a_content.content.splitlines())
                    stats = DiffStats(lines_added=0, lines_removed=lines, lines_changed=lines)
                    comp_all_identical = False
                elif status == DiffStatus.ONLY_IN_ORG_B:
                    lines = len(b_content.content.splitlines())
                    stats = DiffStats(lines_added=lines, lines_removed=0, lines_changed=lines)
                    comp_all_identical = False
                else:
                    stats = DiffStats()

                comp_stats += stats

                file_meta = LwcFileMeta(
                    name=entry["rel"],
                    status=status,
                    in_org_a=a_content.exists,
                    in_org_b=b_content.exists,
                    is_identical=status == DiffStatus.IDENTICAL,
                    diff_stats=stats,
                    has_error=has_error,
                )
                file_metas.append(file_meta.to_dict())

                file_detail = LwcFileDetail(
                    name=entry["rel"],
                    status=status,
                    org_a=a_content,
                    org_b=b_content,
                    diff_stats=stats,
                )
                file_details.append(file_detail.to_dict())

            # A component identical in both orgs must have >=1 file and no
            # only-in-one-side files; an empty bundle (no files at all) on
            # both sides is a degenerate case treated as identical too.
            component_identical = in_a_comp and in_b_comp and comp_all_identical
            component_status = _resolve_status(in_a_comp, in_b_comp, component_identical)

            meta = LwcComponentMeta(
                name=component_name,
                status=component_status,
                in_org_a=in_a_comp,
                in_org_b=in_b_comp,
                is_identical=component_identical,
                file_count=len(working),
                diff_stats=comp_stats,
                has_error=comp_has_error,
                files=file_metas,
            )
            self._meta[ckey] = meta
            self._detail[ckey] = LwcComponentDetail(
                name=component_name,
                status=component_status,
                files=file_details,
                diff_stats=comp_stats,
            )

            self.summary.total += 1
            if component_status == DiffStatus.MODIFIED:
                self.summary.modified += 1
            elif component_status == DiffStatus.IDENTICAL:
                self.summary.identical += 1
            elif component_status == DiffStatus.ONLY_IN_ORG_A:
                self.summary.only_in_org_a += 1
            elif component_status == DiffStatus.ONLY_IN_ORG_B:
                self.summary.only_in_org_b += 1

        logger.info(
            "Index built: total=%d modified=%d identical=%d only_a=%d only_b=%d",
            self.summary.total, self.summary.modified, self.summary.identical,
            self.summary.only_in_org_a, self.summary.only_in_org_b,
        )

    # ------------------------------------------------------------------
    def get_all_meta(self) -> list[dict]:
        """Return list of metadata dicts for all components (file list
        included, but not file content)."""
        return [m.to_dict() for m in self._meta.values()]

    def get_component_detail(self, component_name: str) -> Optional[dict]:
        """Return full detail (every file, both orgs' content) for a
        component by name. Case-insensitive."""
        key = _normalise_key(component_name)
        return self._detail.get(key).to_dict() if key in self._detail else None

    def get_summary(self) -> dict:
        return self.summary.to_dict()


# ---------------------------------------------------------------------------
# Key normalisation helper (used by API layer too)
# ---------------------------------------------------------------------------

def _normalise_key(name: str) -> str:
    return name.strip().lower()


normalise_key = _normalise_key
