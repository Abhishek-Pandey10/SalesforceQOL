"""
models.py - Data models for the Salesforce Dependency Graph tool.

Unlike the two diff tools, there is only one "org" here and the unit of
comparison is not "does this file match its counterpart" but "what other
nodes does this node reference, and how". A node is either an Apex class /
interface / trigger (one file) or an LWC component (a bundle, identified by
its folder name, same as lwc-org-diff). An edge is a directed reference from
one node to another, carrying every concrete place in the source that causes
the reference (an Occurrence) so the UI can explain *why* two nodes are
connected instead of just *that* they are.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class NodeType(str, Enum):
    APEX_CLASS = "apex_class"
    APEX_INTERFACE = "apex_interface"
    APEX_TRIGGER = "apex_trigger"
    LWC_COMPONENT = "lwc_component"
    APEX_METHOD = "apex_method"     # one method inside an apex_class node - see GraphNode.parent_id


@dataclass
class Occurrence:
    """One concrete place in the source that causes an edge to exist."""
    file: str                      # relative path, original case
    line: int                      # 1-based
    snippet: str                   # the source line, trimmed
    kind: str                      # e.g. "static_call", "instantiation", "apex_wire", ...
    caller_method: Optional[str] = None   # enclosing Apex method, if any
    detail: Optional[str] = None   # e.g. callee method name, imported alias, wired/imperative
    is_test: bool = False          # inside an @isTest class, or an @isTest/testMethod method
    # The specific method this occurrence calls on the target, when known
    # (static_call/instance_call, and LWC's @salesforce/apex imports) - lets
    # graph_builder connect this occurrence to a real method-level edge
    # instead of only the coarser class-level one. None for anything that
    # isn't a call (field_access, type_reference, extends, ...) even when a
    # member name happens to be available in `detail`, since a field read
    # isn't a control-flow edge into a method.
    callee_method: Optional[str] = None
    # Parameter count of the enclosing method (caller_method) / argument
    # count at the call site (paired with callee_method) - lets
    # graph_builder pick the right overload instead of every `foo(...)`
    # call colliding on one `foo` method node regardless of arity. None
    # when there's no enclosing method, or the occurrence isn't a call.
    caller_arity: Optional[int] = None
    callee_arity: Optional[int] = None
    # True when the call's receiver type is exactly known at the call site
    # (currently: a call chained directly off `new X()`, e.g.
    # `new Utility().formatDate()`) rather than merely declared (a variable/
    # field/param typed as X, whose runtime type could be any subclass).
    # graph_builder's polymorphic-dispatch fan-out (possible_override /
    # possible_implementation) must never trigger for these - the concrete
    # type can't be anything other than X, so there's no dispatch ambiguity
    # to speculate about. Bug fix: this used to be indistinguishable from a
    # genuinely ambiguous instance_call, so `new Base().method()` spuriously
    # fanned out possible_override edges to every subclass's override even
    # though a freshly-constructed Base can never dispatch to one.
    exact_type: bool = False

    def to_dict(self) -> dict:
        return {
            "file": self.file,
            "line": self.line,
            "snippet": self.snippet,
            "kind": self.kind,
            "caller_method": self.caller_method,
            "detail": self.detail,
            "is_test": self.is_test,
        }


@dataclass
class GraphNode:
    """A single Apex class/interface/trigger or LWC component bundle."""
    id: str                        # normalised unique key, e.g. "apex:accountcontroller"
    name: str                      # original-case display name
    type: NodeType
    file_path: str                 # relative path (file for Apex, bundle dir for LWC)
    loc: int = 0                   # lines of code (main file only, for LWC)
    in_degree: int = 0             # set after edges are built
    out_degree: int = 0
    is_test: bool = False          # Apex type carries the @isTest annotation
    # Degree counts restricted to edges backed by at least one non-test
    # occurrence - lets the UI default to a view that isn't dominated by
    # every test class's calls into shared fixtures like a TestDataFactory.
    prod_in_degree: int = 0
    prod_out_degree: int = 0
    parent_id: Optional[str] = None  # for an apex_method node: the apex_class node id it belongs to
    # For an apex_method node: carries the `override` keyword - used to fan
    # a call to the declared type's method out to every subclass's own
    # override too (best-effort polymorphic dispatch; see graph_builder's
    # possible_override edges).
    is_override: bool = False
    # For an apex_method node: non-None means this method is a known platform
    # entry point (annotation, or a Batchable/Schedulable/Queueable callback)
    # rather than something only ever reachable through regular in-org calls
    # - see graph_builder's dead-code detection, which excludes these from
    # its candidate list regardless of reachability.
    entry_point_reason: Optional[str] = None
    # Start line (1-based) within file_path - only set for apex_method nodes
    # today (loc above is a line *count*, not a position). Lets the dead-code
    # UI/API point at an exact file:line the same way an Occurrence does.
    line: int = 0
    # For an apex_method node: this method's own status from the same
    # mark-and-sweep reachability walk get_dead_code() runs (see
    # graph_builder._compute_method_reachability) - computed once at build
    # time and stored here so the UI can show it inline (e.g. in a class's
    # methods list) without a second request to /api/dead-code. Never both
    # true; both false for a live/test/entry-point method, or any non-method
    # node.
    is_dead: bool = False        # unreachable from any live root at all
    is_test_only: bool = False   # reachable, but only via an @isTest path
    # For an apex_class/apex_interface/apex_trigger node: a same-build rollup
    # of its own methods' is_dead/is_test_only/entry_point_reason status (see
    # graph_builder._build), computed once rather than making the UI re-derive
    # it per node by fetching and counting every method. dead/test_only/
    # entry_point counts are disjoint and only count over "eligible" methods
    # (excludes the class's own @isTest methods, which are never candidates).
    dead_method_count: int = 0
    test_only_method_count: int = 0
    entry_point_method_count: int = 0
    # True when the class has at least one eligible method, every single one
    # of them is dead, AND it has no entry-point methods either - so nothing
    # at all (regular call, test, or platform entry point) keeps this class
    # alive. Deliberately excludes a class that's clearly still in active
    # use via its entry points but happens to also carry one dead leftover
    # method (e.g. an @AuraEnabled controller with a dead private log()
    # helper) - that method still shows its own is_dead flag, just without
    # the misleading "whole class looks safe to delete" signal. Lets the
    # main graph flag a real dead class directly, instead of only inside
    # the separate Dead Code panel.
    fully_dead: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type.value,
            "file_path": self.file_path,
            "loc": self.loc,
            "in_degree": self.in_degree,
            "out_degree": self.out_degree,
            "is_test": self.is_test,
            "prod_in_degree": self.prod_in_degree,
            "prod_out_degree": self.prod_out_degree,
            "parent_id": self.parent_id,
            "is_override": self.is_override,
            "entry_point_reason": self.entry_point_reason,
            "line": self.line,
            "is_dead": self.is_dead,
            "is_test_only": self.is_test_only,
            "dead_method_count": self.dead_method_count,
            "test_only_method_count": self.test_only_method_count,
            "entry_point_method_count": self.entry_point_method_count,
            "fully_dead": self.fully_dead,
        }


@dataclass
class GraphEdge:
    """A directed reference from one node to another, source -> target."""
    source: str                    # GraphNode.id
    target: str                    # GraphNode.id
    kind: str                      # dominant occurrence kind, drives edge color/label
    occurrences: List[Occurrence] = field(default_factory=list)

    def to_dict(self, *, occurrence_limit: Optional[int] = None) -> dict:
        occs = self.occurrences
        truncated = False
        if occurrence_limit is not None and len(occs) > occurrence_limit:
            occs = occs[:occurrence_limit]
            truncated = True
        return {
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "occurrence_count": len(self.occurrences),
            "occurrences": [o.to_dict() for o in occs],
            "truncated": truncated,
        }


@dataclass
class GraphSummary:
    """High-level counts for the whole graph."""
    total_nodes: int = 0
    apex_classes: int = 0
    apex_interfaces: int = 0
    apex_triggers: int = 0
    lwc_components: int = 0
    test_classes: int = 0          # Apex types carrying @isTest, included in apex_classes above
    apex_methods: int = 0          # method nodes indexed for precise call-chain verification
    total_edges: int = 0           # includes method-level edges, not just class-level
    unresolved_reference_count: int = 0
    # Apex types / LWC bundles found more than once under the scanned folder
    # (a stray backup .cls, two org exports merged together, ...) - only the
    # first occurrence becomes a node, so anything counted here is a node
    # that's silently missing from the graph unless surfaced here. Previously
    # only logged server-side; see graph_builder._build.
    duplicate_count: int = 0
    duplicate_names: List[str] = field(default_factory=list)
    org_path: str = ""

    def to_dict(self) -> dict:
        return {
            "total_nodes": self.total_nodes,
            "apex_classes": self.apex_classes,
            "apex_interfaces": self.apex_interfaces,
            "apex_triggers": self.apex_triggers,
            "lwc_components": self.lwc_components,
            "test_classes": self.test_classes,
            "apex_methods": self.apex_methods,
            "total_edges": self.total_edges,
            "unresolved_reference_count": self.unresolved_reference_count,
            "duplicate_count": self.duplicate_count,
            "duplicate_names": self.duplicate_names,
            "org_path": self.org_path,
        }
