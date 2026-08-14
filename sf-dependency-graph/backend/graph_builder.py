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
from dataclasses import replace
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from backend.apex_parser import (
    DiscoveredType, blank_ranges, discover_all_types, find_method_spans, line_number, line_offsets,
    parse_apex_file, strip_comments_and_strings,
)
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


def _find_bundle_roots(folder: Path) -> Tuple[Dict[str, Path], List[str]]:
    """Walk *folder* for LWC bundle directories. First occurrence of a given
    (case-insensitive) bundle name wins; duplicates are logged AND returned
    (previously only logged - a dropped bundle was otherwise invisible
    outside the server console), same policy as lwc-org-diff."""
    kept: Dict[str, Path] = {}
    duplicates: List[str] = []
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
                duplicates.append(root_path.name)
            else:
                kept[key] = root_path
            dirs[:] = []  # don't look for nested bundles inside this one
    return kept, duplicates


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
    # Deliberately NOT `with ThreadPoolExecutor(...) as executor:` - that
    # form's shutdown(wait=True) blocks until every submitted thread
    # finishes, including ones still stuck on a slow cloud-only file read
    # (cancel() is a no-op on a future that already started running), which
    # defeats the whole point of the timeout below. shutdown(wait=False,
    # cancel_futures=True) lets this function actually return at the
    # _SCAN_TIMEOUT_SECONDS mark; any still-running reads are abandoned
    # (their thread keeps running in the background, harmless - the process
    # doesn't exit until the server is stopped anyway). The try/finally
    # below is still required, though: without it, an exception raised out
    # of future.result() (anything _read_file_safe doesn't itself catch)
    # would skip the shutdown() call entirely and leak the executor and its
    # worker threads - a `with` block would have caught that case, so this
    # gets the same guarantee back without the blocking-wait downside.
    executor = ThreadPoolExecutor(max_workers=max_workers)
    try:
        # Submit in *paths* order (a plain dict preserves insertion order),
        # not the `done` set futures_wait() returns below - iterating a set
        # of Future objects orders by their hash, which depends on
        # completion timing, not on *paths*. Pass 1 (_build) relies on
        # apex_contents.items() order to decide which of two duplicate-named
        # Apex files becomes the canonical node ("first occurrence wins") -
        # walking `path_to_future` (this function's own input order) instead
        # of `done` makes that choice depend on scan order alone, not on
        # which thread happened to finish first.
        path_to_future = {p: executor.submit(_read_file_safe, p) for p in paths}
        done, _not_done = futures_wait(path_to_future.values(), timeout=_SCAN_TIMEOUT_SECONDS)

        result: Dict[Path, str] = {}
        for path, future in path_to_future.items():
            if future not in done:
                logger.warning(
                    "Timed out after %ds reading %s - likely a cloud-only file "
                    "(OneDrive/Dropbox/etc.) that hasn't finished downloading locally.",
                    _SCAN_TIMEOUT_SECONDS, path,
                )
                continue
            content = future.result()
            if content is not None:
                result[path] = content
        return result
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


# Fan-out (see _build's Pass 2) adds possible_override/possible_implementation
# occurrences into the *same* (source, target) bucket a genuine occurrence
# between those two nodes might already use - _dominant_kind keeps a
# speculative occurrence from ever outvoting a real one (or vice versa) for
# the edge's displayed kind, regardless of which one happens to have more
# occurrences.
_SPECULATIVE_KINDS = {"possible_override", "possible_implementation"}


def _dominant_kind(occs: List[Occurrence]) -> str:
    """The most-common occurrence kind, used as a merged edge's displayed
    kind (drives its color/label). Bug fix: a plain majority vote across
    *all* occurrences let a genuinely proven call read as "possible
    override (unverified)" - or a purely speculative one masquerade as
    proven - whenever a class both really calls a subclass/implementer
    directly *and* reaches it speculatively elsewhere (the polymorphic
    fan-out in _build's Pass 2 appends into the same edge_occurrences
    bucket a real call would use). A real (non-speculative) occurrence, if
    any exist, always wins over a speculative one - the vote among
    speculative kinds only matters when *every* occurrence is speculative."""
    real = [o for o in occs if o.kind not in _SPECULATIVE_KINDS]
    pool = real or occs
    return Counter(o.kind for o in pool).most_common(1)[0][0]


def _normalise_key(name: str) -> str:
    return name.strip().lower()


normalise_key = _normalise_key

# (method name -> (required parameter count, first parameter's simple type
# name)) for each platform interface a class's implements clause (matched
# against TypeHeader.implements, already stripped of the `Database.`
# namespace prefix and any generic argument by apex_parser._simple_type_name)
# can carry, directly or - see _transitive_interface_names/Pass 1.6 in
# _build - indirectly through a custom interface that itself `extends` one
# of these. These signatures are fixed by the platform (Batchable.start
# (BatchableContext), execute(context, scope), finish(context); Schedulable.
# execute(SchedulableContext); Queueable.execute(QueueableContext);
# Messaging.InboundEmailHandler.handleInboundEmail(InboundEmail,
# InboundEnvelope)) - invoked by the platform's async executor (or, for
# InboundEmailHandler, Email-to-Apex) not by other in-org code, so
# dead-code detection excludes them regardless of in_degree. Matched by
# first-parameter type as well as name and arity: name+arity alone isn't
# enough - a Queueable class's own, genuinely dead `execute(String reason)`
# overload has the same name AND the same arity (1) as the real
# `execute(QueueableContext context)`, since arity only counts parameters,
# it doesn't look at their type. Checking the first parameter's simple type
# name against the platform's own fixed parameter type is what tells them
# apart without needing full type resolution (this parser has none) - it
# only has to compare one type name, since every platform callback's
# distinguishing parameter is always the first one.
_PLATFORM_ENTRY_METHODS: Dict[str, Dict[str, Tuple[int, str]]] = {
    "batchable": {
        "start": (1, "batchablecontext"), "execute": (2, "batchablecontext"), "finish": (1, "batchablecontext"),
    },
    "schedulable": {"execute": (1, "schedulablecontext")},
    "queueable": {"execute": (1, "queueablecontext")},
    "inboundemailhandler": {"handleinboundemail": (2, "inboundemail")},
}


def _platform_entry_reason(
    implements: List[str], method_name: str, arity: int, first_param_type: Optional[str],
) -> Optional[str]:
    method_lower = method_name.lower()
    first_param_lower = _normalise_key(first_param_type) if first_param_type else None
    for iface_name in implements:
        methods = _PLATFORM_ENTRY_METHODS.get(_normalise_key(iface_name))
        if not methods:
            continue
        spec = methods.get(method_lower)
        if spec and spec == (arity, first_param_lower):
            return f"{iface_name}.{method_name}"
    return None


def _transitive_interface_names(
    implements: List[str],
    apex_type_info_by_id: Dict[str, Tuple[Path, "DiscoveredType"]],
    apex_symbol_table: Dict[str, str],
) -> List[str]:
    """*implements* plus every name reachable by walking each entry's own
    `extends` chain, transitively - so `implements MyBatchInterface` where
    `interface MyBatchInterface extends Database.Batchable<SObject>` yields
    `["MyBatchInterface", "Batchable"]`, not just the former. A name that
    doesn't resolve in apex_symbol_table (a platform interface like
    "Batchable" itself, or a managed-package one) is kept as a terminal leaf
    rather than dropped - it's exactly the platform-interface names
    _platform_entry_reason needs to find. Cycle-safe (a class hierarchy
    can't legally cycle in valid Apex, but a malformed/duplicate-name org
    export might look like it does to this heuristic parser)."""
    seen: Set[str] = set()
    result: List[str] = []
    stack = list(implements)
    while stack:
        name = stack.pop()
        key = _normalise_key(name)
        if key in seen:
            continue
        seen.add(key)
        result.append(name)
        ancestor_id = apex_symbol_table.get(key)
        ancestor = apex_type_info_by_id.get(ancestor_id) if ancestor_id else None
        if ancestor is not None:
            _path, ancestor_type = ancestor
            stack.extend(ancestor_type.extends)
    return result


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
        # apex_class node id -> [method node id, ...] in declaration order.
        self._methods_by_class: Dict[str, List[str]] = defaultdict(list)
        # apex_class node id -> {method_name_lower: {arity: method node id}},
        # used to resolve a call's callee_method(+callee_arity) to a concrete
        # method node - keyed by arity so overloads don't collide (see
        # _resolve_method_id).
        self._method_id_by_class: Dict[str, Dict[str, Dict[int, str]]] = {}
        # apex_class node id -> [(method_name, arity, first_param_type), ...]
        # for every method span Pass 1 found on that class - exactly the
        # triple _platform_entry_reason needs. Stashed here so Pass 1.6's
        # indirect-platform-interface check can reuse it instead of calling
        # find_method_spans a second time over the same class body.
        self._method_signatures_by_class: Dict[str, List[Tuple[str, int, Optional[str]]]] = defaultdict(list)
        # base apex_class node id -> [direct subclass node id, ...], from
        # `extends`. Used for best-effort polymorphic dispatch: see
        # _transitive_subclasses and the possible_override edges in Pass 2.
        self._direct_subclasses: Dict[str, List[str]] = defaultdict(list)
        # interface node id -> [direct implementer class node id, ...], from
        # `implements`. Same idea as _direct_subclasses but for interface
        # dispatch: see _transitive_implementers and the
        # possible_implementation edges in Pass 2.
        self._direct_implementers: Dict[str, List[str]] = defaultdict(list)
        # Method node ids reachable from a live root (see
        # _compute_method_reachability) - computed once in _build() and
        # cached here so get_dead_code() and the per-class/-method rollup
        # (also done in _build()) share one BFS instead of each re-walking
        # the whole method-level call graph.
        self._reachable_all: Set[str] = set()
        self._reachable_prod: Set[str] = set()
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

    def _resolve_method_id(
        self, class_id: str, method_name: str, arity: Optional[int],
    ) -> Optional[Tuple[str, int]]:
        """(method_node_id, its_arity) for *method_name* on *class_id*, or
        None. Prefers an exact arity match (disambiguates overloads); when
        *arity* doesn't match anything (unknown - e.g. an LWC import names
        no argument list - or the call-site count came out wrong) but
        there's only one overload of this name, that's unambiguous anyway
        and gets returned. Two-plus same-named overloads with no arity
        match is a real ambiguity this parser can't resolve - returns None
        rather than guessing, so the call stays class-level only."""
        by_arity = self._method_id_by_class.get(class_id, {}).get(method_name.lower())
        if not by_arity:
            return None
        if arity is not None and arity in by_arity:
            return by_arity[arity], arity
        if len(by_arity) == 1:
            (only_arity, only_id), = by_arity.items()
            return only_id, only_arity
        return None

    def _transitive_subclasses(self, class_id: str) -> List[str]:
        """Every subclass of *class_id*, direct or indirect, via `extends`."""
        result: List[str] = []
        seen: Set[str] = set()
        stack = list(self._direct_subclasses.get(class_id, []))
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            result.append(cur)
            stack.extend(self._direct_subclasses.get(cur, []))
        return result

    def _transitive_implementers(self, interface_id: str) -> List[str]:
        """Every class that implements *interface_id*, directly or by
        extending a class that does - an Apex interface has no default
        method bodies, so every implementer (unlike the extends/override
        case) is a fan-out candidate, not just ones that redeclare the
        method. A subclass of a direct implementer also satisfies the
        interface, so each direct implementer's own subclass closure
        (_transitive_subclasses) is folded in too."""
        result: List[str] = []
        seen: Set[str] = set()
        for direct_id in self._direct_implementers.get(interface_id, []):
            if direct_id not in seen:
                seen.add(direct_id)
                result.append(direct_id)
            for sub_id in self._transitive_subclasses(direct_id):
                if sub_id not in seen:
                    seen.add(sub_id)
                    result.append(sub_id)
        return result

    # ------------------------------------------------------------------
    def _build(self) -> None:
        root = Path(self.org_path)
        logger.info("Scanning org folder: %s", root)

        apex_paths = _find_apex_files(root)
        bundle_roots, duplicate_names = _find_bundle_roots(root)
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
        # Every type declared in each file - the file's own top-level type
        # first, then any class/interface/enum nested inside it, at any
        # depth (Apex allows a class nested inside a class nested inside a
        # class, however rarely used in practice - see
        # apex_parser.discover_all_types). Cached so Pass 1.5 (class
        # hierarchy) and Pass 2 (reference scanning) don't need to
        # rediscover it - both need every type's own extends/implements,
        # which isn't safe to resolve mid-loop here since apex_symbol_table
        # isn't fully populated yet (file processing order isn't guaranteed
        # - see _read_all's threaded reads) and a subclass can be discovered
        # before its base class.
        apex_types_by_path: Dict[Path, List[DiscoveredType]] = {}
        for path, content in apex_contents.items():
            stripped = strip_comments_and_strings(content)
            file_line_starts = line_offsets(content)
            types = discover_all_types(stripped, file_line_starts)
            apex_types_by_path[path] = types
            apex_stripped_by_path[path] = stripped
            rel_path = str(path.relative_to(root)).replace("\\", "/")

            if not types:
                # No type declaration found at all (empty/malformed file) -
                # fall back to one node keyed by filename, same as before
                # discover_all_types existed, so the file still shows up
                # rather than vanishing silently.
                display_name = path.stem
                node_id = f"apex:{_normalise_key(display_name)}"
                apex_self_id_by_path[path] = node_id
                if node_id in self.nodes:
                    logger.warning(
                        "Duplicate Apex type '%s' found; keeping first "
                        "occurrence's metadata, ignoring: %s",
                        display_name, path,
                    )
                    duplicate_names.append(display_name)
                    continue
                self.nodes[node_id] = GraphNode(
                    id=node_id, name=display_name, type=NodeType.APEX_CLASS,
                    file_path=rel_path, loc=len(content.splitlines()),
                )
                self._index_name(display_name, node_id)
                apex_symbol_table[_normalise_key(display_name)] = node_id
                self._method_id_by_class[node_id] = {}
                continue

            for type_info in types:
                is_outer = type_info.parent_qualified_name is None
                node_id = f"apex:{_normalise_key(type_info.qualified_name)}"
                if is_outer:
                    apex_self_id_by_path[path] = node_id

                # Duplicate declared type name (e.g. a stray backup copy, or
                # two org exports merged into one folder); keeping the first
                # occurrence's own class-level metadata and warning mirrors
                # _find_bundle_roots' policy for LWC bundles below. References
                # from this file still get parsed in Pass 2 and attributed to
                # the shared node id rather than silently dropped.
                #
                # Bug fix: this used to `continue` here, which skipped the
                # method-registration loop below entirely for every duplicate
                # occurrence - so a method that existed ONLY in the duplicate
                # file (not also declared, under the same name+arity, in the
                # first occurrence) never got a node at all: not counted dead,
                # not counted alive, simply absent from the whole graph and
                # invisible to dead-code detection. The method loop below now
                # always runs; only the class-level node/indexing/symbol-table
                # registration is skipped for a duplicate (first occurrence's
                # class-level identity still wins, unchanged).
                is_duplicate_type = node_id in self.nodes
                if is_duplicate_type:
                    logger.warning(
                        "Duplicate Apex type '%s' found; keeping first "
                        "occurrence's class-level metadata, but still "
                        "registering its own methods (first occurrence wins "
                        "on a name+arity collision) under the shared node: %s",
                        type_info.qualified_name, path,
                    )
                    duplicate_names.append(type_info.qualified_name)

                # display_name is qualified for a nested type ("Outer.Inner",
                # matching how a method node's own name is already qualified
                # by its class), bare for the top-level type - unchanged
                # from before this function existed. Computed regardless of
                # is_duplicate_type: the method loop below needs it either way.
                display_name = type_info.name if is_outer else type_info.qualified_name

                if not is_duplicate_type:
                    if type_info.kind == "trigger":
                        node_type = NodeType.APEX_TRIGGER
                    elif type_info.kind == "interface":
                        node_type = NodeType.APEX_INTERFACE
                    else:
                        node_type = NodeType.APEX_CLASS  # covers "class" and "enum" (an enum gets no method nodes below)

                    parent_node_id = (
                        None if is_outer else f"apex:{_normalise_key(type_info.parent_qualified_name)}"
                    )
                    self.nodes[node_id] = GraphNode(
                        id=node_id, name=display_name, type=node_type,
                        file_path=rel_path,
                        # loc stays whole-file for the top-level type (unchanged
                        # historical behavior); a nested type has no equivalent
                        # prior behavior to preserve, so it gets its own body's
                        # line count instead - more useful than the whole file's.
                        loc=(
                            len(content.splitlines()) if is_outer
                            else stripped.count("\n", type_info.header_end, type_info.body_end) + 1
                        ),
                        is_test=type_info.is_test, parent_id=parent_node_id,
                    )
                    self._index_name(display_name, node_id)
                    if not is_outer:
                        self._index_name(type_info.name, node_id)  # bare form too, e.g. "Wrapper" alongside "Outer.Wrapper"
                    # Qualified form always registered (unambiguous cross-class
                    # reference, e.g. `AccountController.Wrapper`); the bare
                    # form too (the common in-file/same-outer-class reference,
                    # `Wrapper`) but for a nested type only if nothing else
                    # already claimed it - first occurrence wins, same policy as
                    # the duplicate-type handling above. This global entry is
                    # only ever the *fallback* though: Pass 2 shadows it per
                    # file with that file's own nested types before scanning
                    # (see `file_symbol_table` there), so a class referencing
                    # its own nested type by bare name always resolves
                    # correctly regardless of registration order - this global
                    # first-wins entry only gets used for a bare reference from
                    # a *different* file, which isn't valid Apex in the first
                    # place (an unqualified nested-type reference is only legal
                    # within the declaring class's own lexical scope) and stays
                    # an accepted, documented heuristic-parser guess (see
                    # README).
                    apex_symbol_table[_normalise_key(type_info.qualified_name)] = node_id
                    if is_outer:
                        apex_symbol_table[_normalise_key(type_info.name)] = node_id
                    else:
                        apex_symbol_table.setdefault(_normalise_key(type_info.name), node_id)

                # Method nodes, one per top-level method body found directly
                # in *this* type - find_method_spans is scoped to just its
                # own [header_end, body_end] span (via the slice below) so a
                # nested type's methods aren't picked up here too; that
                # nested type gets its own entry in `types`, handled by this
                # same loop on a later iteration, with its own scoped call.
                # Lets blast_radius/get_node_detail answer "does A really
                # reach C through a real call chain" at method granularity
                # instead of only the coarser class-level over-approximation
                # (see README "Known limitations"). Interfaces and triggers
                # don't get any: interface methods have no body (`;`, not
                # `{`) for find_method_spans to find, and a trigger body
                # isn't split into named methods either - both correctly end
                # up with zero method nodes rather than a fabricated one.
                #
                # Seeded from any methods already registered under this
                # node_id (i.e. by the first occurrence, when this is a
                # duplicate type) rather than starting fresh, so a duplicate
                # file's own scan doesn't wipe out the first occurrence's
                # method table when it's written back below.
                method_lookup: Dict[str, Dict[int, str]] = defaultdict(
                    dict, self._method_id_by_class.get(node_id, {}),
                )
                slice_base = type_info.header_end - 1  # the type's own '{' position
                type_slice = stripped[slice_base:type_info.body_end + 1]
                for span in find_method_spans(type_slice):
                    method_name, arity = span.name, span.arity
                    self._method_signatures_by_class[node_id].append(
                        (method_name, arity, span.first_param_type)
                    )
                    abs_start = slice_base + span.start
                    abs_end = slice_base + span.end
                    # "!" (not "/") separates method name from arity: node ids
                    # are path segments in /api/nodes/{name} etc., and FastAPI's
                    # default path converter can never match a literal "/" -
                    # api.py's own _validate_name rejects it too. "!" can't
                    # appear in an Apex identifier, so it's an unambiguous,
                    # URL-safe separator.
                    method_id = f"{node_id}::{method_name}!{arity}"
                    # Overloads get separate nodes when they differ by parameter
                    # *count* (`foo(Id)` vs `foo(Id, Boolean)`); two overloads
                    # with the same arity but different parameter types still
                    # collide onto one node - real type resolution would be
                    # needed to tell those apart, out of scope for a regex
                    # parser. First occurrence's span wins the node's identity
                    # on a genuine collision, same policy as duplicate-type
                    # handling above - but entry_point_reason is computed for
                    # EVERY colliding span and can still upgrade the merged
                    # node below, so which declaration happens to be seen
                    # first doesn't determine whether it's correctly excluded
                    # from dead-code candidacy (see the upgrade branch).
                    arity_label = "" if arity == 0 else f"{arity} arg" + ("" if arity == 1 else "s")
                    # entry_point_reason precedence: an annotation/`global`
                    # match found by the parser (most specific) > a
                    # Batchable/Schedulable/Queueable callback method name on
                    # a type that directly implements one of those
                    # interfaces. A constructor (MethodSpan.has_return_type
                    # False, name matching its own type) is deliberately NOT
                    # auto-excluded here anymore: apex_parser now resolves
                    # `new X(...)` (and Type.newInstance()) to a real
                    # method-level edge onto the specific constructor
                    # overload, so a constructor's in_degree is real signal
                    # like any other method's - see README "Known
                    # limitations". A constructor invoked only from outside
                    # the parsed org entirely (a Visualforce
                    # controller="X"/extensions="X" attribute, an implicit
                    # super() call Apex inserts when a subclass declares no
                    # constructor of its own) still isn't visible to this
                    # parser and can still read as a false-positive dead
                    # candidate - a narrower version of the same
                    # outside-the-org-boundary gap the other known entry
                    # points exist for, not solved here either.
                    entry_point_reason = span.entry_point_reason
                    if entry_point_reason is None:
                        entry_point_reason = _platform_entry_reason(
                            type_info.implements, method_name, arity, span.first_param_type,
                        )
                    existing = self.nodes.get(method_id)
                    if existing is None:
                        self.nodes[method_id] = GraphNode(
                            id=method_id, name=f"{display_name}.{method_name}({arity_label})",
                            type=NodeType.APEX_METHOD, file_path=rel_path,
                            loc=stripped.count("\n", abs_start, abs_end) + 1,
                            line=line_number(file_line_starts, abs_start),
                            is_test=type_info.is_test or span.is_test,
                            parent_id=node_id, is_override=span.is_override,
                            entry_point_reason=entry_point_reason,
                        )
                        self._methods_by_class[node_id].append(method_id)
                    elif entry_point_reason is not None and existing.entry_point_reason is None:
                        # This span lost the node-identity collision above
                        # (an earlier same-name-same-arity sibling already
                        # claimed method_id), but it genuinely looks like a
                        # platform entry point on its own - e.g. a class
                        # implementing Queueable declares both the real
                        # execute(QueueableContext) and an unrelated, legal
                        # same-arity execute(String) overload, and the real
                        # one happened to be declared second. Upgrading
                        # (never downgrading - an already-found reason is
                        # left alone) means the merged node is correctly
                        # excluded from dead-code candidacy regardless of
                        # declaration order.
                        existing.entry_point_reason = entry_point_reason
                    method_lookup[method_name.lower()][arity] = method_id
                self._method_id_by_class[node_id] = dict(method_lookup)

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

        # --- Pass 1.5: class hierarchy ------------------------------------
        # Direct `extends`/`implements` edges only; _transitive_subclasses /
        # _transitive_implementers walk the closures. Used for best-effort
        # polymorphic dispatch in Pass 2: a call resolved against a declared
        # base-class type also fans out to every subclass's own `override`
        # of that method, and a call resolved against a declared interface
        # type fans out to every implementer's own method (interfaces have
        # no default body, so every implementer - not just ones with
        # `override` - is a candidate), since the runtime type could be any
        # of them - see module docstring / README for the "still isn't real
        # type resolution" caveats. Needs the full apex_symbol_table, so
        # this can only run once Pass 1 is done.
        # node_id -> (its file's path, its own DiscoveredType) for every
        # Apex type - used by Pass 1.6 below to re-derive a candidate class's
        # method spans (name/arity/first_param_type) on demand, and to walk
        # a type's own `extends` list by id when resolving the indirect
        # platform-interface case.
        apex_type_info_by_id: Dict[str, Tuple[Path, DiscoveredType]] = {}
        for path, types in apex_types_by_path.items():
            for type_info in types:
                node_id = f"apex:{_normalise_key(type_info.qualified_name)}"
                apex_type_info_by_id[node_id] = (path, type_info)
                for ext_name in type_info.extends:
                    base_id = apex_symbol_table.get(ext_name.lower())
                    if base_id:
                        self._direct_subclasses[base_id].append(node_id)
                for impl_name in type_info.implements:
                    iface_id = apex_symbol_table.get(impl_name.lower())
                    if iface_id:
                        self._direct_implementers[iface_id].append(node_id)

        # --- Pass 1.6: platform entry-point methods via *indirect* interface
        # implementation (a class implements a custom interface that itself
        # `extends` Batchable/Schedulable/Queueable, rather than naming the
        # platform interface directly in its own `implements` clause) -----
        # The inline check during Pass 1 above only ever sees a class's own
        # *direct* implements list, since it runs per-file in file-discovery
        # order and can't yet assume every other file's interface hierarchy
        # is known (a base interface can live in a file processed later).
        # This runs after Pass 1.5, once the whole org's types are known, so
        # it can safely walk implements -> extends transitively - see
        # README "Known limitations" for the pattern this closes.
        for node_id, (_path, type_info) in apex_type_info_by_id.items():
            if type_info.kind != "class" or not type_info.implements:
                continue
            expanded_names = _transitive_interface_names(
                type_info.implements, apex_type_info_by_id, apex_symbol_table,
            )
            # Nothing beyond the direct implements list was reachable (no
            # custom-interface indirection here), or the closure never
            # touches a platform interface at all - skip the re-scan; the
            # overwhelming majority of classes hit this fast path.
            if len(expanded_names) == len(type_info.implements):
                continue
            if not any(_normalise_key(n) in _PLATFORM_ENTRY_METHODS for n in expanded_names):
                continue
            # (method_name, arity, first_param_type) for every method on
            # this class - stashed by Pass 1 above, so this doesn't need to
            # re-slice and re-run find_method_spans over the class body a
            # second time just to recover data already derived once.
            method_lookup = self._method_id_by_class.get(node_id, {})
            for method_name, arity, first_param_type in self._method_signatures_by_class.get(node_id, []):
                reason = _platform_entry_reason(expanded_names, method_name, arity, first_param_type)
                if reason is None:
                    continue
                method_id = method_lookup.get(method_name.lower(), {}).get(arity)
                node = self.nodes.get(method_id) if method_id else None
                # Same "upgrade, never downgrade" policy as the colliding-
                # overload case in Pass 1 - an already-found reason (e.g. an
                # annotation) is left alone.
                if node is not None and node.entry_point_reason is None:
                    node.entry_point_reason = reason

        # --- Pass 2: parse each file for references ----------------------
        edge_occurrences: Dict[Tuple[str, str], List[Occurrence]] = defaultdict(list)
        unresolved_names: set = set()

        for path, content in apex_contents.items():
            rel_path = str(path.relative_to(root)).replace("\\", "/")
            stripped_whole = apex_stripped_by_path[path]
            types = apex_types_by_path.get(path, [])

            if not types:
                # Fallback path, mirrors Pass 1's fallback for a file with no
                # discoverable type declaration - still scan it (unqualified,
                # whole file) rather than silently dropping its references.
                self_id = apex_self_id_by_path.get(path)
                if self_id is not None:
                    _header, occs = parse_apex_file(
                        content, rel_path, self_id, apex_symbol_table, pre_stripped=stripped_whole,
                    )
                    self._accumulate_type_occurrences(self_id, occs, edge_occurrences)
                for m in _UNRESOLVED_NEW_RE.finditer(stripped_whole):
                    name = m.group(1)
                    if _normalise_key(name) not in apex_symbol_table:
                        unresolved_names.add(name)
                continue

            file_line_starts = line_offsets(content)
            # Every type keyed by its own qualified_name -> the list of
            # types declared *directly* inside it - used to blank a type's
            # nested children out of its own scan (so it doesn't also pick
            # up, and misattribute to itself, references that actually live
            # inside a nested type's body - that nested type gets its own
            # separate, correctly-scoped scan later in this same loop) and,
            # recursively, to let each nested type's own scan do the same
            # for its own children.
            children_by_qualified: Dict[str, List[DiscoveredType]] = defaultdict(list)
            for t in types:
                if t.parent_qualified_name is not None:
                    children_by_qualified[t.parent_qualified_name].append(t)

            # Bug fix: apex_symbol_table's bare-name entry for a nested type
            # is global and first-occurrence-wins (see Pass 1) - two
            # unrelated files each declaring their own nested `Wrapper`
            # collide on the one shared key, so whichever file loses the
            # race had its own `new Wrapper()`/`Wrapper w` misresolve to the
            # OTHER file's Wrapper node instead of its own (a wrong edge,
            # not just a missing one). Real Apex only allows an unqualified
            # nested-type reference to resolve within the declaring class's
            # own lexical scope anyway, so this file's own scan should never
            # fall through to another file's same-named nested type via the
            # bare form - overriding the bare key with THIS file's own
            # nested types (shadowing the global entry for the duration of
            # this file's scan only - apex_symbol_table itself is untouched,
            # so other files are unaffected) fixes the common, concrete case
            # (a class referencing its own nested type) even though a bare
            # reference from a third, unrelated file still falls back to the
            # global first-wins guess - a smaller, already-documented
            # residual limitation, not a new one.
            nested_types_here = [t for t in types if t.parent_qualified_name is not None]
            if nested_types_here:
                file_symbol_table = dict(apex_symbol_table)
                for t in nested_types_here:
                    file_symbol_table[_normalise_key(t.name)] = f"apex:{_normalise_key(t.qualified_name)}"
            else:
                file_symbol_table = apex_symbol_table

            # qualified_name -> its own DiscoveredType, used below to walk a
            # nested type's parent_qualified_name chain up to the top-level
            # type (see enclosing_method_owner).
            qualified_to_type: Dict[str, DiscoveredType] = {t.qualified_name: t for t in types}

            for type_info in types:
                is_outer = type_info.parent_qualified_name is None
                self_id = f"apex:{_normalise_key(type_info.qualified_name)}"
                own_children = children_by_qualified.get(type_info.qualified_name, [])

                # {method_name_lower: owning_ancestor_node_id} for every
                # enclosing type's own methods, closest ancestor wins on a
                # name collision - lets parse_apex_file resolve a nested
                # type's bare call to its enclosing type's method (legal
                # Apex; see apex_parser's enclosing_method_owner docstring).
                # Safe to build now even though this file's own Pass 2 scan
                # isn't done yet: it only reads _method_id_by_class, which
                # Pass 1 (already complete for every file, including this
                # one) fully populated.
                enclosing_method_owner: Dict[str, str] = {}
                if not is_outer:
                    ancestor_qualified = type_info.parent_qualified_name
                    while ancestor_qualified is not None:
                        ancestor_id = f"apex:{_normalise_key(ancestor_qualified)}"
                        for method_name in self._method_id_by_class.get(ancestor_id, {}):
                            enclosing_method_owner.setdefault(method_name, ancestor_id)
                        ancestor_type = qualified_to_type.get(ancestor_qualified)
                        ancestor_qualified = ancestor_type.parent_qualified_name if ancestor_type else None

                if is_outer:
                    # Unchanged from before nested-type support existed: the
                    # whole file, scanned from position 0.
                    scan_content, scan_stripped, line_offset = content, stripped_whole, 0
                else:
                    # Sliced from this type's own declaration text (not just
                    # its '{') so parse_apex_file's own find_type_header call
                    # still correctly finds *this* type's header (kind, name,
                    # extends, implements) rather than the file's outer one.
                    slice_start, slice_end = type_info.header_start, type_info.body_end + 1
                    scan_content = content[slice_start:slice_end]
                    scan_stripped = stripped_whole[slice_start:slice_end]
                    # parse_apex_file computes line numbers fresh from
                    # position 0 of whatever text it's given - this is how
                    # many lines to add back so a reported Occurrence.line
                    # matches the real file, not the slice.
                    line_offset = line_number(file_line_starts, slice_start) - 1

                if own_children:
                    base = 0 if is_outer else type_info.header_start
                    blank_spans = [(c.header_start - base, c.body_end + 1 - base) for c in own_children]
                    scan_content = blank_ranges(scan_content, blank_spans)
                    scan_stripped = blank_ranges(scan_stripped, blank_spans)

                _header, occs = parse_apex_file(
                    scan_content, rel_path, self_id, file_symbol_table, pre_stripped=scan_stripped,
                    enclosing_method_owner=enclosing_method_owner or None,
                )
                if line_offset:
                    occs = [(target_id, replace(occ, line=occ.line + line_offset)) for target_id, occ in occs]

                self._accumulate_type_occurrences(self_id, occs, edge_occurrences)

                # Track unresolved extends / implements (types not present in this org).
                for ext_name in type_info.extends:
                    if ext_name.lower() not in apex_symbol_table:
                        unresolved_names.add(ext_name)
                for impl_name in type_info.implements:
                    if impl_name.lower() not in apex_symbol_table:
                        unresolved_names.add(impl_name)

            for m in _UNRESOLVED_NEW_RE.finditer(stripped_whole):
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
                        # An LWC import already names the exact Apex method
                        # (@salesforce/apex/Class.method) - no caller_method
                        # to resolve (the component itself is the source)
                        # and no argument list to count, so arity is
                        # unknown; _resolve_method_id falls back to "the
                        # only overload with this name" when that's enough
                        # to be unambiguous.
                        if occ.callee_method:
                            resolved = self._resolve_method_id(target_id, occ.callee_method, None)
                            if resolved:
                                target_method_id, _resolved_arity = resolved
                                edge_occurrences[(self_id, target_method_id)].append(occ)
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
            edge = GraphEdge(source=source_id, target=target_id, kind=_dominant_kind(occs), occurrences=occs)
            self.edges.append(edge)
            self._edges_by_source[source_id].append(edge)
            self._edges_by_target[target_id].append(edge)
            has_prod_occ = any(not o.is_test for o in occs)
            if source_id in self.nodes:
                self.nodes[source_id].out_degree += 1
                if has_prod_occ:
                    self.nodes[source_id].prod_out_degree += 1
            if target_id in self.nodes:
                self.nodes[target_id].in_degree += 1
                if has_prod_occ:
                    self.nodes[target_id].prod_in_degree += 1

        # --- Reachability rollup ---------------------------------------
        # Same mark-and-sweep get_dead_code() answers, run once here and
        # cached (self._reachable_all/_prod) so a request to that endpoint
        # doesn't re-walk the whole method-level call graph. Also rolled up
        # per class/method right away so the *main* graph and node-detail
        # views can show "this method/class looks dead" inline, not only in
        # the separate Dead Code panel.
        self._reachable_all, self._reachable_prod = self._compute_method_reachability()
        for class_id, method_ids in self._methods_by_class.items():
            class_node = self.nodes.get(class_id)
            if class_node is None:
                continue
            dead = test_only = entry_points = eligible = 0
            for method_id in method_ids:
                method_node = self.nodes[method_id]
                if method_node.is_test:
                    continue
                if method_node.entry_point_reason is not None:
                    entry_points += 1
                    continue
                eligible += 1
                if method_id not in self._reachable_all:
                    method_node.is_dead = True
                    dead += 1
                elif method_id not in self._reachable_prod:
                    method_node.is_test_only = True
                    test_only += 1
            class_node.dead_method_count = dead
            class_node.test_only_method_count = test_only
            class_node.entry_point_method_count = entry_points
            # entry_points == 0 too: a class can have every *eligible*
            # method dead while still clearly being alive because its only
            # other methods are entry points (e.g. an @AuraEnabled
            # controller with two live handlers and one dead private
            # log() helper) - "fully dead" should mean nothing at all keeps
            # this class alive, not just "the non-entry-point leftover is
            # dead too." A class like that still correctly shows its one
            # dead method in the methods list (is_dead), just not as a
            # class-wide delete candidate.
            class_node.fully_dead = eligible > 0 and dead == eligible and entry_points == 0

        # --- Summary --------------------------------------------------------
        for node in self.nodes.values():
            # Method nodes are an internal precision layer, not part of the
            # class/interface/trigger/lwc org structure this summary
            # describes - counted separately so total_nodes keeps meaning
            # "apex_classes + apex_interfaces + apex_triggers + lwc_components".
            if node.type == NodeType.APEX_METHOD:
                self.summary.apex_methods += 1
                continue
            self.summary.total_nodes += 1
            if node.type == NodeType.APEX_CLASS:
                self.summary.apex_classes += 1
            elif node.type == NodeType.APEX_INTERFACE:
                self.summary.apex_interfaces += 1
            elif node.type == NodeType.APEX_TRIGGER:
                self.summary.apex_triggers += 1
            elif node.type == NodeType.LWC_COMPONENT:
                self.summary.lwc_components += 1
            if node.is_test:
                self.summary.test_classes += 1
        self.summary.total_edges = len(self.edges)
        self.summary.unresolved_reference_count = len(unresolved_names)
        self.summary.duplicate_count = len(duplicate_names)
        self.summary.duplicate_names = sorted(set(duplicate_names))

        logger.info(
            "Graph built: nodes=%d (apex_classes=%d [%d test] interfaces=%d triggers=%d lwc=%d) "
            "methods=%d edges=%d unresolved=%d duplicates=%d",
            self.summary.total_nodes, self.summary.apex_classes, self.summary.test_classes,
            self.summary.apex_interfaces, self.summary.apex_triggers, self.summary.lwc_components,
            self.summary.apex_methods, self.summary.total_edges, self.summary.unresolved_reference_count,
            self.summary.duplicate_count,
        )

    # ------------------------------------------------------------------
    def _accumulate_type_occurrences(
        self, self_id: str, occs: List[Tuple[str, Occurrence]],
        edge_occurrences: Dict[Tuple[str, str], List[Occurrence]],
    ) -> None:
        """Fold one type's parsed occurrences into edge_occurrences - class-
        level pairs, plus, where resolvable, the finer method-level edge and
        best-effort polymorphic-dispatch fan-out. Shared by every type's own
        scan in _build's Pass 2 (a file's top-level type, and each class/
        interface/enum nested inside it, at any depth), each called with its
        own self_id and its own correctly-scoped occurrence list - a nested
        type's methods must never be resolved against self_methods drawn
        from its enclosing (or a sibling) type's own method table."""
        self_methods = self._method_id_by_class.get(self_id, {})
        for target_id, occ in occs:
            # apex_parser.parse_apex_file no longer drops a self_id-targeted
            # occurrence (see its emit() docstring) - a same-class call
            # needs to survive that far to become a method-level edge below,
            # but a type *referencing itself* is still not something the
            # class-level graph should show (every type textually mentions
            # its own name constantly - a self-loop edge there would be pure
            # noise, not signal). Skipping the accumulation here, rather
            # than dropping the occurrence earlier in the parser, is what
            # lets the two granularities disagree on purpose: no class-level
            # edge, but the method-level resolution just below still runs
            # against occ.callee_method regardless of target_id.
            if target_id != self_id:
                edge_occurrences[(self_id, target_id)].append(occ)
            # Additionally, a method-level edge when the call can be pinned
            # to one real method on the target type - anything else
            # (unresolved override, field access, extends, a call outside
            # any method body) stays class-level only rather than
            # fabricating a method node. Falls back to the type itself as
            # the source when there's no enclosing method (e.g. a call made
            # from a field initializer).
            if not occ.callee_method:
                continue
            target_node = self.nodes.get(target_id)
            is_interface_target = target_node is not None and target_node.type == NodeType.APEX_INTERFACE
            resolved = self._resolve_method_id(target_id, occ.callee_method, occ.callee_arity)
            # Does the declared target type have *any* method node under
            # this name at all (any arity)? True interface methods
            # (`;`-terminated) never get one - find_method_spans only sees
            # `{}`-bodied signatures - and neither does an abstract method
            # on an abstract class (`public abstract void send(String
            # msg);`), which has the identical bodyless shape. Both cases
            # mean _resolve_method_id can never succeed against target_id
            # itself, but there's still a real call to classify and fan out
            # below, keyed by the call site's own argument count instead of
            # a (nonexistent) method node on the declared type.
            target_has_method_node = occ.callee_method.lower() in self._method_id_by_class.get(target_id, {})
            if resolved is not None:
                target_method_id, resolved_arity = resolved
                caller_by_arity = self_methods.get((occ.caller_method or "").lower(), {})
                method_source = caller_by_arity.get(occ.caller_arity) or self_id
                edge_occurrences[(method_source, target_method_id)].append(occ)
            elif not target_has_method_node:
                resolved_arity = occ.callee_arity
                caller_by_arity = self_methods.get((occ.caller_method or "").lower(), {})
                method_source = caller_by_arity.get(occ.caller_arity) or self_id
            else:
                continue

            if occ.kind != "instance_call" or occ.exact_type:
                # static_call is a literal `ClassName.method()`, which in
                # Apex can only be a static method - statics can't be
                # virtual/override/interface-dispatched, so there's no
                # dispatch ambiguity to fan out there. occ.exact_type means
                # the receiver's concrete type is exactly known (e.g. a call
                # chained directly off `new X()`) rather than merely
                # declared - no runtime-type ambiguity there either, so it's
                # excluded from fan-out the same way.
                continue

            # Best-effort polymorphic dispatch: `instance_call` means this
            # went through a variable/field/param, so the runtime type could
            # be any subclass (declared type is a class) or any implementer
            # (declared type is an interface) of the declared one, not just
            # the declared type itself - fan the call out to each
            # candidate's own version of the same method too (each as a
            # distinct, clearly-labelled edge, not merged into the direct-
            # call edge). A class target only fans out to subclasses that
            # actually redeclare the method (`override`) - a non-overriding
            # subclass just inherits the base's method, no divergence to
            # report. An interface target fans out to every implementer
            # regardless, since Apex interface methods have no default body:
            # every implementer's method is the (only) real implementation,
            # never itself flagged `override`.
            if is_interface_target:
                fanout_ids = self._transitive_implementers(target_id)
                fanout_kind, fanout_label = "possible_implementation", "possible implementation"
                require_override = False
            else:
                fanout_ids = self._transitive_subclasses(target_id)
                fanout_kind, fanout_label = "possible_override", "possible override"
                require_override = True

            for candidate_id in fanout_ids:
                candidate_method_id = self._method_id_by_class.get(candidate_id, {}).get(
                    occ.callee_method.lower(), {}
                ).get(resolved_arity)
                if not candidate_method_id:
                    continue
                if require_override and not self.nodes[candidate_method_id].is_override:
                    continue
                fanout_occ = replace(
                    occ, kind=fanout_kind,
                    detail=f"{fanout_label} in {self.nodes[candidate_id].name}",
                )
                edge_occurrences[(self_id, candidate_id)].append(fanout_occ)
                edge_occurrences[(method_source, candidate_method_id)].append(fanout_occ)

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

    def _compute_method_reachability(self) -> Tuple[Set[str], Set[str]]:
        """(reachable_all, reachable_prod): every method node id reachable
        from a *live* root by walking the method-level call graph -
        possible_override/possible_implementation fan-out edges included,
        same as in_degree already counts them (see _accumulate_type_
        occurrences). This is the real mark-and-sweep get_dead_code needs
        to catch a closed loop of methods that call only each other (each
        has local in_degree=1, from the other - fixture_org's DeadLoopA/
        DeadLoopB) or a chain hanging off one (OrphanedLegacyCaller/
        OrphanedLegacyTarget) - neither has a zero-in-degree node for a
        purely local check to find, no matter how large the loop/chain; see
        README "Known limitations". A method with nonzero local in_degree
        can still end up outside reachable_all if every one of its callers
        is itself unreachable.

        A "live" root is a method invoked from outside this call graph
        entirely - the only ways that can happen:
          - entry_point_reason is set (annotation/`global`/platform-callback
            - invoked from outside the parsed org).
          - is_test (invoked by the test runner, not by other code) -
            added to reachable_all only, never reachable_prod, mirroring
            prod_in_degree's existing test-vs-prod split.
          - the *source* of an inbound edge is not itself a method node (a
            field initializer, an LWC @wire/import/binding, ...) - such a
            source is a class/interface/trigger/LWC node, never itself
            subject to dead-code analysis, so a method it calls is
            reachable "for free", the same way an entry-point method is.

        reachable_prod only follows edges carrying at least one non-test
        occurrence, seeded only from prod-live roots - the same
        prod_in_degree/in_degree split get_dead_code's dead/test_only
        buckets already make, generalized from one hop to arbitrarily many."""
        adj_all: Dict[str, List[str]] = defaultdict(list)
        adj_prod: Dict[str, List[str]] = defaultdict(list)
        roots_all: Set[str] = set()
        roots_prod: Set[str] = set()

        for node in self.nodes.values():
            if node.type != NodeType.APEX_METHOD:
                continue
            if node.entry_point_reason is not None:
                roots_all.add(node.id)
                roots_prod.add(node.id)
            if node.is_test:
                roots_all.add(node.id)

        for edge in self.edges:
            target_node = self.nodes.get(edge.target)
            if target_node is None or target_node.type != NodeType.APEX_METHOD:
                continue
            has_prod_occ = any(not o.is_test for o in edge.occurrences)
            source_node = self.nodes.get(edge.source)
            if source_node is None or source_node.type != NodeType.APEX_METHOD:
                roots_all.add(edge.target)
                if has_prod_occ:
                    roots_prod.add(edge.target)
                continue
            adj_all[edge.source].append(edge.target)
            if has_prod_occ:
                adj_prod[edge.source].append(edge.target)

        def _bfs(roots: Set[str], adj: Dict[str, List[str]]) -> Set[str]:
            seen = set(roots)
            stack = list(roots)
            while stack:
                cur = stack.pop()
                for nxt in adj.get(cur, ()):
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
            return seen

        return _bfs(roots_all, adj_all), _bfs(roots_prod, adj_prod)

    def get_dead_code(self, *, include_entry_points: bool = False) -> dict:
        """Apex methods that look safe to delete: unreachable from any live
        root via the method-level call graph (see _compute_method_
        reachability - a real mark-and-sweep, not just "does this exact
        method have a direct caller"), split into two buckets by how
        confidently that's true -

          - dead: not reachable_all - nothing at all (test or prod), even
            transitively, calls this method from anything actually live.
          - test_only: reachable_all but not reachable_prod - every path
            that reaches this method passes through at least one @isTest
            method. Weaker signal (could be a legitimate test helper, or
            dead prod code a stale test still exercises) so it's kept
            separate rather than merged into `dead` or dropped.

        This subsumes the simpler "does this method have a direct caller"
        check (a node with zero direct callers is trivially unreachable
        too), and additionally catches a closed loop of methods calling
        only each other, or a chain hanging off one - see fixture_org's
        DeadLoopA/DeadLoopB and OrphanedLegacyCaller/OrphanedLegacyTarget,
        and README "Known limitations" for why a purely-local in_degree==0
        check misses both.

        A method's own is_test methods are never candidates (they're
        invoked by the test runner, not by other code) and are excluded
        outright, not counted in either bucket. Nor is a method carrying an
        entry_point_reason (annotation/`global`/platform-interface callback,
        or a constructor reached only from outside the parsed org - see
        graph_builder's Pass 1) - these are invoked from outside the parsed
        org, so unreachability here says nothing about whether they're
        actually used. Polymorphic dispatch (possible_override/
        possible_implementation fan-out, see module docstring) already
        contributes to the call graph the same as a direct call, so an
        override/interface-implementation method reached only that way
        still correctly shows as used.

        include_entry_points: when True, also return every excluded entry
        point (id/name/reason) in a third `entry_points_excluded` list, for
        transparency into what got filtered out and why - omitted by
        default to keep the common-case response focused on actual
        candidates."""
        # Reuses the one BFS _build() already ran (see "Reachability
        # rollup" there) rather than re-walking the whole method-level call
        # graph on every request - self._reachable_all/_prod are exactly
        # what a fresh call to _compute_method_reachability() would return,
        # since the graph is immutable after _build().
        reachable_all, reachable_prod = self._reachable_all, self._reachable_prod
        dead: List[dict] = []
        test_only: List[dict] = []
        entry_points_excluded: List[dict] = []

        for node in self.nodes.values():
            if node.type != NodeType.APEX_METHOD or node.is_test:
                continue
            if node.entry_point_reason is not None:
                if include_entry_points:
                    entry_points_excluded.append({
                        "id": node.id, "name": node.name,
                        "reason": node.entry_point_reason,
                    })
                continue
            if node.id in reachable_prod:
                continue
            class_node = self.nodes.get(node.parent_id) if node.parent_id else None
            item = {
                "id": node.id, "name": node.name,
                "class_name": class_node.name if class_node else None,
                "file_path": node.file_path, "line": node.line,
                # True when this method has a direct (local) caller, but
                # that caller - possibly transitively - is itself only ever
                # reachable from other unreachable code: the closed-loop/
                # orphaned-chain case reachable_all/_prod catches that a
                # plain in_degree>0 check would have missed entirely.
                "only_reachable_from_dead_code": node.in_degree > 0,
            }
            (dead if node.id not in reachable_all else test_only).append(item)

        sort_key = lambda item: ((item["class_name"] or ""), item["name"])
        dead.sort(key=sort_key)
        test_only.sort(key=sort_key)
        entry_points_excluded.sort(key=lambda item: item["name"])

        result = {"dead": dead, "test_only": test_only}
        if include_entry_points:
            result["entry_points_excluded"] = entry_points_excluded
        return result

    @staticmethod
    def _edge_excluding_test(edge: GraphEdge) -> Optional[GraphEdge]:
        """Same edge with test-only occurrences dropped, or None if nothing
        non-test remains (e.g. an edge that only ever exists via calls from
        an @isTest class into a shared fixture like a TestDataFactory)."""
        occs = [o for o in edge.occurrences if not o.is_test]
        if not occs:
            return None
        return GraphEdge(source=edge.source, target=edge.target, kind=_dominant_kind(occs), occurrences=occs)

    def _node_dict(self, node_id: str, *, include_test: bool) -> dict:
        d = self.nodes[node_id].to_dict()
        if not include_test:
            # Show the prod-only degree as the headline in_degree/out_degree
            # so it lines up with the edges actually returned in this view -
            # otherwise a node like TestDataFactory would show its full
            # (test-inflated) degree even though most of those edges were
            # just filtered out of the response.
            d["in_degree"] = d["prod_in_degree"]
            d["out_degree"] = d["prod_out_degree"]
        return d

    def get_graph(
        self, *, types: Optional[List[str]] = None, search: Optional[str] = None,
        occurrence_limit: Optional[int] = 5, include_test: bool = False,
    ) -> dict:
        nodes = list(self.nodes.values())
        if not include_test:
            nodes = [n for n in nodes if not n.is_test]
        if types:
            type_set = set(types)
            nodes = [n for n in nodes if n.type.value in type_set]
        else:
            # Method nodes are an opt-in precision layer (pass
            # types=apex_method explicitly to fetch them) - without this,
            # every class's methods would join the default overview and
            # balloon it 5-10x. get_node_detail()'s "methods" list and
            # blast_radius() on a method-qualified id are the intended way
            # to reach them.
            nodes = [n for n in nodes if n.type != NodeType.APEX_METHOD]
        if search:
            s = search.lower()
            nodes = [n for n in nodes if s in n.name.lower()]

        node_ids = {n.id for n in nodes}
        edges: List[GraphEdge] = []
        for e in self.edges:
            if e.source not in node_ids or e.target not in node_ids:
                continue
            if include_test:
                edges.append(e)
            else:
                filtered = self._edge_excluding_test(e)
                if filtered is not None:
                    edges.append(filtered)

        return {
            "nodes": [self._node_dict(n.id, include_test=include_test) for n in nodes],
            "edges": [e.to_dict(occurrence_limit=occurrence_limit) for e in edges],
        }

    def _drop_method_edges(self, edges: List[GraphEdge], *, other_is_target: bool) -> List[GraphEdge]:
        """Filter out edges that spill into the method graph (e.g. an LWC's
        @wire import now also creates a class-to-specific-method edge
        alongside the class-level one) - a class/LWC-focused view stays
        class-level by default so the two don't show up as confusing
        duplicate-looking rows for the same relationship."""
        out = []
        for e in edges:
            other_id = e.target if other_is_target else e.source
            other_node = self.nodes.get(other_id)
            if other_node and other_node.type == NodeType.APEX_METHOD:
                continue
            out.append(e)
        return out

    def get_node_detail(self, name: str, *, include_test: bool = False) -> Optional[dict]:
        node_id = self.resolve_id(name)
        if node_id is None or node_id not in self.nodes:
            return None
        node = self.nodes[node_id]
        # Looking at a test class's own detail with everything filtered out
        # would just show two empty lists - if you named it explicitly,
        # show its real (test) edges regardless of the default filter.
        include_test = include_test or node.is_test
        outgoing = self._edges_by_source.get(node_id, [])
        incoming = self._edges_by_target.get(node_id, [])
        if node.type != NodeType.APEX_METHOD:
            outgoing = self._drop_method_edges(outgoing, other_is_target=True)
            incoming = self._drop_method_edges(incoming, other_is_target=False)
        if not include_test:
            outgoing = [e for e in (self._edge_excluding_test(e) for e in outgoing) if e is not None]
            incoming = [e for e in (self._edge_excluding_test(e) for e in incoming) if e is not None]

        result = {
            "node": self._node_dict(node_id, include_test=include_test),
            "depends_on": [e.to_dict(occurrence_limit=10) for e in outgoing],
            "used_by": [e.to_dict(occurrence_limit=10) for e in incoming],
        }
        method_ids = self._methods_by_class.get(node_id)
        if method_ids:
            methods = [
                self._node_dict(mid, include_test=include_test)
                for mid in method_ids
                if include_test or not self.nodes[mid].is_test
            ]
            methods.sort(key=lambda d: d["name"])
            result["methods"] = methods
        return result

    def get_edge_detail(self, source: str, target: str, *, include_test: bool = False) -> Optional[dict]:
        source_id = self.resolve_id(source)
        target_id = self.resolve_id(target)
        if not source_id or not target_id:
            return None
        for edge in self._edges_by_source.get(source_id, []):
            if edge.target == target_id:
                # Bug fix: this used to always return the raw, unfiltered
                # edge - every other read path (get_graph/get_node_detail/
                # blast_radius) honors include_test, so with the UI's
                # "Include test classes" toggle off, an edge's occurrence
                # count/list shown here (e.g. via the "load all occurrences"
                # link, which hits this exact method) could include
                # test-only occurrences the rest of the page had filtered
                # out, and even resolve when the class-level view says the
                # edge doesn't exist at all (an edge with only test-only
                # occurrences).
                if include_test:
                    return edge.to_dict()
                filtered = self._edge_excluding_test(edge)
                return filtered.to_dict() if filtered is not None else None
        return None

    def _bfs(
        self, seeds: List[str], *, direction: str, depth: Optional[int], include_test: bool,
        allow_method_nodes: bool, exclude_kinds: Optional[Set[str]] = None,
    ) -> Dict[str, Tuple[int, str]]:
        """Shared traversal core for blast_radius() and
        _method_reachable_class_ids(): multi-source BFS over self.edges,
        respecting include_test and (unless allow_method_nodes) staying out
        of the method-level graph entirely. exclude_kinds additionally skips
        edges of the given dominant kind entirely - used to keep
        possible_override/possible_implementation edges (speculative: the
        runtime type backing them might not actually be what's calling) out
        of the "verified" real-call-chain computation while still letting
        them appear in a regular (unverified) blast-radius result."""
        def edge_for_view(edge: GraphEdge) -> Optional[GraphEdge]:
            if exclude_kinds and edge.kind in exclude_kinds:
                return None
            return edge if include_test else self._edge_excluding_test(edge)

        visited: Dict[str, Tuple[int, str]] = {s: (0, "focus") for s in seeds}
        frontier = list(seeds)
        hop = 0
        while frontier and (depth is None or hop < depth):
            hop += 1
            next_frontier: List[str] = []
            for node_id in frontier:
                if direction in ("both", "downstream"):
                    for edge in self._edges_by_source.get(node_id, []):
                        target = edge.target
                        if target in visited:
                            continue
                        target_node = self.nodes.get(target)
                        if target_node is None:
                            continue
                        if not allow_method_nodes and target_node.type == NodeType.APEX_METHOD:
                            continue
                        if not include_test and target_node.is_test:
                            continue
                        if edge_for_view(edge) is None:
                            continue
                        visited[target] = (hop, "downstream")
                        next_frontier.append(target)
                if direction in ("both", "upstream"):
                    for edge in self._edges_by_target.get(node_id, []):
                        source = edge.source
                        if source in visited:
                            continue
                        source_node = self.nodes.get(source)
                        if source_node is None:
                            continue
                        if not allow_method_nodes and source_node.type == NodeType.APEX_METHOD:
                            continue
                        if not include_test and source_node.is_test:
                            continue
                        if edge_for_view(edge) is None:
                            continue
                        visited[source] = (hop, "upstream")
                        next_frontier.append(source)
            frontier = next_frontier
        return visited

    def _method_reachable_class_ids(
        self, focus_class_id: str, *, direction: str, depth: Optional[int], include_test: bool,
    ) -> set:
        """The set of class ids genuinely reachable from *focus_class_id* via
        a real method-to-method call chain (seeded from all of that class's
        own methods at once), used to mark blast_radius() results as
        verified vs merely class-level-adjacent. Empty for a class with no
        parsed methods (an interface, or a class find_method_spans found
        nothing in) - everything downstream is then honestly reported as
        unverified rather than guessed at."""
        seeds = [
            m for m in self._methods_by_class.get(focus_class_id, [])
            if include_test or not self.nodes[m].is_test
        ]
        # A call made outside any method body (e.g. a field/static
        # initializer) has no enclosing method to seed from above, but
        # _accumulate_type_occurrences still resolves it to a real,
        # non-speculative method-level edge sourced at the class itself
        # (method_source falls back to self_id there). Seed those targets
        # too, so a genuine call isn't invisibly excluded from "verified"
        # just because it didn't originate inside a method - without
        # pulling in the coarse class-level edges (also sourced at
        # focus_class_id) or speculative polymorphic fan-out, which would
        # defeat the point of this method-level check.
        if direction in ("both", "downstream"):
            for edge in self._edges_by_source.get(focus_class_id, []):
                target_node = self.nodes.get(edge.target)
                if (
                    target_node is not None
                    and target_node.type == NodeType.APEX_METHOD
                    and edge.kind not in ("possible_override", "possible_implementation")
                    and (include_test or not target_node.is_test)
                    and (include_test or self._edge_excluding_test(edge) is not None)
                ):
                    seeds.append(edge.target)
        if not seeds:
            return set()
        visited = self._bfs(
            seeds, direction=direction, depth=depth, include_test=include_test,
            allow_method_nodes=True, exclude_kinds={"possible_override", "possible_implementation"},
        )
        class_ids = set()
        for node_id in visited:
            node = self.nodes.get(node_id)
            if node is not None:
                class_ids.add(node.parent_id or node_id)
        return class_ids

    def blast_radius(
        self, name: str, *, depth: Optional[int] = 2, direction: str = "both",
        occurrence_limit: Optional[int] = 5, include_test: bool = False,
    ) -> Optional[dict]:
        """BFS outward from *name*. direction: 'both' | 'upstream' (who
        depends on this) | 'downstream' (what this depends on). depth=None
        means unlimited (whole connected component).

        When include_test is False (the default), test-only nodes and edges
        are excluded from the traversal itself - not just the display - so
        a focus node's blast radius doesn't jump through an @isTest class
        the way plain BFS over the raw class-level graph would.

        Focusing on a class/interface/trigger/LWC stays class-level (method
        nodes never enter the result) - focusing on a method id
        (`apex:foo::bar`) traverses the precise method call graph instead.
        For a class-level focus, each result node also gets `verified`:
        True if a real method-to-method call chain backs the connection,
        False if it only exists via the coarser class-level
        over-approximation (see README "Known limitations" - this is the
        fix for that: A depending on B and B depending on C doesn't mean A
        transitively depends on C unless the specific method of A that
        calls into B is the same one that leads to C)."""
        focus_id = self.resolve_id(name)
        if focus_id is None or focus_id not in self.nodes:
            return None
        include_test = include_test or self.nodes[focus_id].is_test
        focus_node = self.nodes[focus_id]
        focus_is_method = focus_node.type == NodeType.APEX_METHOD

        visited = self._bfs(
            [focus_id], direction=direction, depth=depth, include_test=include_test,
            allow_method_nodes=focus_is_method,
        )

        verified_class_ids: Optional[set] = None
        if focus_node.type == NodeType.APEX_CLASS:
            verified_class_ids = self._method_reachable_class_ids(
                focus_id, direction=direction, depth=depth, include_test=include_test,
            )

        def edge_for_view(edge: GraphEdge) -> Optional[GraphEdge]:
            return edge if include_test else self._edge_excluding_test(edge)

        node_dicts = []
        for node_id, (hop_dist, dir_label) in visited.items():
            d = self._node_dict(node_id, include_test=include_test)
            d["hop"] = hop_dist
            d["direction"] = dir_label
            if verified_class_ids is not None:
                d["verified"] = node_id == focus_id or node_id in verified_class_ids
            node_dicts.append(d)

        edges = []
        for e in self.edges:
            if e.source not in visited or e.target not in visited:
                continue
            ve = edge_for_view(e)
            if ve is not None:
                edges.append(ve.to_dict(occurrence_limit=occurrence_limit))

        return {
            "focus": focus_id,
            "depth": depth,
            "direction": direction,
            "include_test": include_test,
            "nodes": node_dicts,
            "edges": edges,
        }
