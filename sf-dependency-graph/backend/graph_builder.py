"""
graph_builder.py - Discovers every Apex type and LWC bundle in one org
folder, parses them (via apex_parser/lwc_parser), and assembles the
in-memory dependency graph.

Discovery follows the same two patterns already used elsewhere in this repo:
Apex types are one file each (apex-org-diff's model); LWC components are a
*bundle* - a directory containing a `<dirname>.js-meta.xml` marker file
(lwc-org-diff's `_is_bundle_dir` / `_find_bundle_roots`, ported here for a
single org instead of an A/B pair).
"""
from __future__ import annotations

import logging
import os
import re
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait as futures_wait
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.apex_parser import find_type_header, line_offsets, parse_apex_file, strip_comments_and_strings
from backend.lwc_parser import parse_lwc_html, parse_lwc_js
from backend.models import GraphEdge, GraphNode, GraphSummary, NodeType, Occurrence

logger = logging.getLogger(__name__)

# Cloud-synced folders (OneDrive/Dropbox) can hold "cloud-only" placeholder
# files that trigger a slow on-demand download the moment they're opened;
# capping the read batch means a handful of unhydrated files delay
# readiness by at most this long instead of indefinitely. Same rationale as
# lwc-org-diff's scanner.py.
_SCAN_TIMEOUT_SECONDS = 30

_UNRESOLVED_NEW_RE = re.compile(r"\bnew\s+([A-Za-z_]\w*)\s*\(")
# Matches `import ALIAS from 'c/componentName'` in LWC JS files so we can
# count references to bundles that are not present in the scanned org folder.
_UNRESOLVED_LWC_IMPORT_RE = re.compile(r"""import\s+\w+\s+from\s+['"]c/(\w+)['"]"""
)


def _is_bundle_dir(dirname: str, filenames: List[str]) -> bool:
    meta_name = f"{dirname}.js-meta.xml".lower()
    return any(f.lower() == meta_name for f in filenames)


def _find_bundle_roots(folder: Path) -> Dict[str, Path]:
    """Walk *folder* for LWC bundle directories. First occurrence of a given
    (case-insensitive) bundle name wins; duplicates are logged and ignored,
    same policy as lwc-org-diff."""
    kept: Dict[str, Path] = {}
    for root, dirs, files in os.walk(folder):
        root_path = Path(root)
        if root_path == folder:
            continue
        if _is_bundle_dir(root_path.name, files):
            key = root_path.name.lower()
            if key in kept:
                logger.warning(
                    "Duplicate LWC component '%s' found; keeping first "
                    "occurrence, ignoring: %s", root_path.name, root_path,
                )
            else:
                kept[key] = root_path
            dirs[:] = []  # don't look for nested bundles inside this one
    return kept


def _collect_bundle_files(bundle_root: Path) -> Dict[str, Path]:
    """{lowercased relative path -> absolute path} for every file in a bundle."""
    out: Dict[str, Path] = {}
    for root, _dirs, files in os.walk(bundle_root):
        for filename in files:
            path = Path(root) / filename
            rel = path.relative_to(bundle_root).as_posix()
            out[rel.lower()] = path
    return out


def _find_apex_files(folder: Path) -> List[Path]:
    """Every .cls / .trigger file under *folder*, skipping anything that
    lives inside an LWC bundle directory (shouldn't normally happen, but
    guards against a stray .cls dropped next to bundle files)."""
    apex_files: List[Path] = []
    for root, dirs, files in os.walk(folder):
        root_path = Path(root)
        if root_path != folder and _is_bundle_dir(root_path.name, files):
            dirs[:] = []
            continue
        for filename in files:
            if filename.lower().endswith((".cls", ".trigger")):
                apex_files.append(root_path / filename)
    return apex_files


def _read_file_safe(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.warning("Could not read %s: %s", path, exc)
        return None


def _read_all(paths: List[Path]) -> Dict[Path, str]:
    if not paths:
        return {}
    max_workers = min(64, len(paths))
    # Use the executor as a context manager so shutdown(wait=True) is
    # guaranteed even if futures_wait raises. The wait is near-instant here
    # because futures_wait has already imposed the real timeout budget; any
    # not_done futures are cancelled before the `with` block exits.
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_read_file_safe, p): p for p in paths}
        done, not_done = futures_wait(futures.keys(), timeout=_SCAN_TIMEOUT_SECONDS)

        result: Dict[Path, str] = {}
        for future in done:
            path = futures[future]
            content = future.result()
            if content is not None:
                result[path] = content
        for future in not_done:
            future.cancel()
            path = futures[future]
            logger.warning(
                "Timed out after %ds reading %s - likely a cloud-only file "
                "(OneDrive/Dropbox/etc.) that hasn't finished downloading locally.",
                _SCAN_TIMEOUT_SECONDS, path,
            )
    return result


def _normalise_key(name: str) -> str:
    return name.strip().lower()


normalise_key = _normalise_key


class DependencyGraph:
    """In-memory dependency graph for one org folder. Built once at startup;
    O(1)/O(edges) lookups thereafter."""

    def __init__(self, org_path: str, *, build_immediately: bool = True) -> None:
        self.org_path = str(Path(org_path).resolve())

        self.nodes: Dict[str, GraphNode] = {}
        # lowercased display name -> ids. A list, not a single id: an Apex
        # type and an LWC component can share a display name (e.g. class
        # "AccountCard" + LWC "accountCard"), and silently letting the
        # second registration overwrite the first made the other
        # permanently unreachable by plain-name lookup.
        self._name_to_id: Dict[str, List[str]] = defaultdict(list)
        self.edges: List[GraphEdge] = []
        self._edges_by_source: Dict[str, List[GraphEdge]] = defaultdict(list)
        self._edges_by_target: Dict[str, List[GraphEdge]] = defaultdict(list)
        self.summary = GraphSummary(org_path=self.org_path)

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

    def _index_name(self, display_name: str, node_id: str) -> None:
        ids = self._name_to_id[_normalise_key(display_name)]
        if node_id not in ids:
            ids.append(node_id)

    # ------------------------------------------------------------------
    def _build(self) -> None:
        root = Path(self.org_path)
        logger.info("Scanning org folder: %s", root)

        apex_paths = _find_apex_files(root)
        bundle_roots = _find_bundle_roots(root)
        logger.info("Found %d Apex file(s), %d LWC bundle(s)", len(apex_paths), len(bundle_roots))

        apex_contents = _read_all(apex_paths)

        bundle_files: Dict[str, Dict[str, Path]] = {
            name: _collect_bundle_files(bundle_root) for name, bundle_root in bundle_roots.items()
        }
        all_bundle_file_paths = [p for files in bundle_files.values() for p in files.values()]
        bundle_contents = _read_all(all_bundle_file_paths)

        # --- Pass 1: register every node + build the symbol table -------
        apex_symbol_table: Dict[str, str] = {}
        # Keyed by path (not by filename/display name) so Pass 2 can look a
        # file's own node id and stripped text back up directly - a file's
        # declared type name doesn't always match its filename (renamed
        # classes, copy-paste templates, ...), and re-deriving the id from
        # path.stem there used to silently drop such files' outgoing edges.
        apex_self_id_by_path: Dict[Path, str] = {}
        apex_stripped_by_path: Dict[Path, str] = {}
        for path, content in apex_contents.items():
            stripped = strip_comments_and_strings(content)
            header = find_type_header(stripped, line_offsets(content))
            display_name = header.name if header else path.stem
            node_id = f"apex:{_normalise_key(display_name)}"
            apex_self_id_by_path[path] = node_id
            apex_stripped_by_path[path] = stripped

            if header and header.kind == "trigger":
                node_type = NodeType.APEX_TRIGGER
            elif header and header.kind == "interface":
                node_type = NodeType.APEX_INTERFACE
            else:
                node_type = NodeType.APEX_CLASS

            rel_path = str(path.relative_to(root)).replace("\\", "/")
            self.nodes[node_id] = GraphNode(
                id=node_id, name=display_name, type=node_type,
                file_path=rel_path, loc=len(content.splitlines()),
            )
            self._index_name(display_name, node_id)
            apex_symbol_table[_normalise_key(display_name)] = node_id

        lwc_symbol_table: Dict[str, str] = {}
        for bundle_name in bundle_roots:
            node_id = f"lwc:{bundle_name}"
            display_name = bundle_roots[bundle_name].name
            main_js = bundle_files[bundle_name].get(f"{bundle_name}.js")
            loc = len(bundle_contents.get(main_js, "").splitlines()) if main_js else 0
            rel_path = str(bundle_roots[bundle_name].relative_to(root)).replace("\\", "/")
            self.nodes[node_id] = GraphNode(
                id=node_id, name=display_name, type=NodeType.LWC_COMPONENT,
                file_path=rel_path, loc=loc,
            )
            self._index_name(display_name, node_id)
            lwc_symbol_table[bundle_name] = node_id

        # --- Pass 2: parse each file for references ----------------------
        edge_occurrences: Dict[Tuple[str, str], List[Occurrence]] = defaultdict(list)
        unresolved_names: set = set()

        for path, content in apex_contents.items():
            self_id = apex_self_id_by_path[path]
            rel_path = str(path.relative_to(root)).replace("\\", "/")
            # Pass the already-stripped text from Pass 1 to avoid stripping twice.
            header, occs = parse_apex_file(
                content, rel_path, self_id, apex_symbol_table,
                pre_stripped=apex_stripped_by_path[path],
            )
            for target_id, occ in occs:
                edge_occurrences[(self_id, target_id)].append(occ)

            # Track unresolved extends / implements (types not present in this org).
            if header:
                if header.extends and header.extends.lower() not in apex_symbol_table:
                    unresolved_names.add(header.extends)
                for impl_name in header.implements:
                    if impl_name.lower() not in apex_symbol_table:
                        unresolved_names.add(impl_name)

            for m in _UNRESOLVED_NEW_RE.finditer(apex_stripped_by_path[path]):
                name = m.group(1)
                if _normalise_key(name) not in apex_symbol_table:
                    unresolved_names.add(name)

        for bundle_name, files in bundle_files.items():
            self_id = lwc_symbol_table[bundle_name]
            for rel_lower, path in files.items():
                content = bundle_contents.get(path)
                if content is None:
                    continue
                original_rel = f"{bundle_roots[bundle_name].name}/{path.relative_to(bundle_roots[bundle_name]).as_posix()}"
                if rel_lower.endswith(".js") and "__tests__/" not in rel_lower and not rel_lower.endswith(".test.js"):
                    occs = parse_lwc_js(content, original_rel, self_id, apex_symbol_table, lwc_symbol_table)
                    for target_id, occ in occs:
                        edge_occurrences[(self_id, target_id)].append(occ)
                    # Track unresolved c/ component imports (components referenced
                    # but not found in the scanned org folder).
                    for m in _UNRESOLVED_LWC_IMPORT_RE.finditer(content):
                        child_name = m.group(1)
                        if child_name.lower() not in lwc_symbol_table:
                            unresolved_names.add(child_name)
                elif rel_lower.endswith(".html"):
                    occs = parse_lwc_html(content, original_rel, self_id, lwc_symbol_table)
                    for target_id, occ in occs:
                        edge_occurrences[(self_id, target_id)].append(occ)

        # --- Pass 3: assemble edges + degree counts -----------------------
        for (source_id, target_id), occs in edge_occurrences.items():
            kind_counts = Counter(o.kind for o in occs)
            dominant_kind = kind_counts.most_common(1)[0][0]
            edge = GraphEdge(source=source_id, target=target_id, kind=dominant_kind, occurrences=occs)
            self.edges.append(edge)
            self._edges_by_source[source_id].append(edge)
            self._edges_by_target[target_id].append(edge)
            if source_id in self.nodes:
                self.nodes[source_id].out_degree += 1
            if target_id in self.nodes:
                self.nodes[target_id].in_degree += 1

        # --- Summary --------------------------------------------------------
        for node in self.nodes.values():
            self.summary.total_nodes += 1
            if node.type == NodeType.APEX_CLASS:
                self.summary.apex_classes += 1
            elif node.type == NodeType.APEX_INTERFACE:
                self.summary.apex_interfaces += 1
            elif node.type == NodeType.APEX_TRIGGER:
                self.summary.apex_triggers += 1
            elif node.type == NodeType.LWC_COMPONENT:
                self.summary.lwc_components += 1
        self.summary.total_edges = len(self.edges)
        self.summary.unresolved_reference_count = len(unresolved_names)

        logger.info(
            "Graph built: nodes=%d (apex_classes=%d interfaces=%d triggers=%d lwc=%d) edges=%d unresolved=%d",
            self.summary.total_nodes, self.summary.apex_classes, self.summary.apex_interfaces,
            self.summary.apex_triggers, self.summary.lwc_components, self.summary.total_edges,
            self.summary.unresolved_reference_count,
        )

    # ------------------------------------------------------------------
    def resolve_id(self, name: str) -> Optional[str]:
        """Resolve a bare name (or an already-qualified id like
        'apex:foo'/'lwc:bar') to a node id. Returns None both when there is
        no match and when *name* ambiguously matches more than one node
        (an Apex type and an LWC component can share a display name) -
        callers that want to tell those two cases apart, e.g. to report a
        helpful error, should use resolve_name_matches() instead."""
        if name in self.nodes:
            return name
        matches = self._name_to_id.get(_normalise_key(name), [])
        return matches[0] if len(matches) == 1 else None

    def resolve_name_matches(self, name: str) -> List[str]:
        """All node ids whose display name matches *name* case-insensitively
        (0, 1, or - for a name shared by an Apex type and an LWC component -
        more than 1). An already-qualified id resolves to itself."""
        if name in self.nodes:
            return [name]
        return list(self._name_to_id.get(_normalise_key(name), []))

    def get_summary(self) -> dict:
        return self.summary.to_dict()

    def get_graph(
        self, *, types: Optional[List[str]] = None, search: Optional[str] = None,
        occurrence_limit: Optional[int] = 5,
    ) -> dict:
        nodes = list(self.nodes.values())
        if types:
            type_set = set(types)
            nodes = [n for n in nodes if n.type.value in type_set]
        if search:
            s = search.lower()
            nodes = [n for n in nodes if s in n.name.lower()]

        node_ids = {n.id for n in nodes}
        edges = [e for e in self.edges if e.source in node_ids and e.target in node_ids]

        return {
            "nodes": [n.to_dict() for n in nodes],
            "edges": [e.to_dict(occurrence_limit=occurrence_limit) for e in edges],
        }

    def get_node_detail(self, name: str) -> Optional[dict]:
        node_id = self.resolve_id(name)
        if node_id is None or node_id not in self.nodes:
            return None
        outgoing = self._edges_by_source.get(node_id, [])
        incoming = self._edges_by_target.get(node_id, [])
        return {
            "node": self.nodes[node_id].to_dict(),
            "depends_on": [e.to_dict(occurrence_limit=10) for e in outgoing],
            "used_by": [e.to_dict(occurrence_limit=10) for e in incoming],
        }

    def get_edge_detail(self, source: str, target: str) -> Optional[dict]:
        source_id = self.resolve_id(source)
        target_id = self.resolve_id(target)
        if not source_id or not target_id:
            return None
        for edge in self._edges_by_source.get(source_id, []):
            if edge.target == target_id:
                return edge.to_dict()
        return None

    def blast_radius(
        self, name: str, *, depth: Optional[int] = 2, direction: str = "both",
        occurrence_limit: Optional[int] = 5,
    ) -> Optional[dict]:
        """BFS outward from *name*. direction: 'both' | 'upstream' (who
        depends on this) | 'downstream' (what this depends on). depth=None
        means unlimited (whole connected component)."""
        focus_id = self.resolve_id(name)
        if focus_id is None or focus_id not in self.nodes:
            return None

        visited: Dict[str, Tuple[int, str]] = {focus_id: (0, "focus")}
        frontier = [focus_id]
        hop = 0
        while frontier and (depth is None or hop < depth):
            hop += 1
            next_frontier: List[str] = []
            for node_id in frontier:
                if direction in ("both", "downstream"):
                    for edge in self._edges_by_source.get(node_id, []):
                        if edge.target not in visited:
                            visited[edge.target] = (hop, "downstream")
                            next_frontier.append(edge.target)
                if direction in ("both", "upstream"):
                    for edge in self._edges_by_target.get(node_id, []):
                        if edge.source not in visited:
                            visited[edge.source] = (hop, "upstream")
                            next_frontier.append(edge.source)
            frontier = next_frontier

        node_dicts = []
        for node_id, (hop_dist, dir_label) in visited.items():
            d = self.nodes[node_id].to_dict()
            d["hop"] = hop_dist
            d["direction"] = dir_label
            node_dicts.append(d)

        edges = [
            e.to_dict(occurrence_limit=occurrence_limit)
            for e in self.edges
            if e.source in visited and e.target in visited
        ]

        return {
            "focus": focus_id,
            "depth": depth,
            "direction": direction,
            "nodes": node_dicts,
            "edges": edges,
        }
