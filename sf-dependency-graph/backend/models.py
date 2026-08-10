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


@dataclass
class Occurrence:
    """One concrete place in the source that causes an edge to exist."""
    file: str                      # relative path, original case
    line: int                      # 1-based
    snippet: str                   # the source line, trimmed
    kind: str                      # e.g. "static_call", "instantiation", "apex_wire", ...
    caller_method: Optional[str] = None   # enclosing Apex method, if any
    detail: Optional[str] = None   # e.g. callee method name, imported alias, wired/imperative

    def to_dict(self) -> dict:
        return {
            "file": self.file,
            "line": self.line,
            "snippet": self.snippet,
            "kind": self.kind,
            "caller_method": self.caller_method,
            "detail": self.detail,
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

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type.value,
            "file_path": self.file_path,
            "loc": self.loc,
            "in_degree": self.in_degree,
            "out_degree": self.out_degree,
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
    total_edges: int = 0
    unresolved_reference_count: int = 0
    org_path: str = ""

    def to_dict(self) -> dict:
        return {
            "total_nodes": self.total_nodes,
            "apex_classes": self.apex_classes,
            "apex_interfaces": self.apex_interfaces,
            "apex_triggers": self.apex_triggers,
            "lwc_components": self.lwc_components,
            "total_edges": self.total_edges,
            "unresolved_reference_count": self.unresolved_reference_count,
            "org_path": self.org_path,
        }
