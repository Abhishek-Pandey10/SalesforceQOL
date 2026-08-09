"""
models.py - Data models for the Apex Org Diff tool.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ClassStatus(str, Enum):
    """Status of an Apex class comparison."""
    MODIFIED = "modified"
    IDENTICAL = "identical"
    ONLY_IN_ORG_A = "only_in_org_a"
    ONLY_IN_ORG_B = "only_in_org_b"


@dataclass
class DiffStats:
    """Line-level diff statistics between two versions."""
    lines_added: int = 0
    lines_removed: int = 0
    lines_changed: int = 0   # unified changed (added + removed)

    def to_dict(self) -> dict:
        return {
            "lines_added":   self.lines_added,
            "lines_removed": self.lines_removed,
            "lines_changed": self.lines_changed,
        }


@dataclass
class ApexClassContent:
    """Content of an Apex class from one org."""
    exists: bool
    content: str = ""
    size_bytes: int = 0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "exists":     self.exists,
            "content":    self.content,
            "size_bytes": self.size_bytes,
            "error":      self.error,
        }


@dataclass
class ApexClassMeta:
    """Metadata for a single Apex class comparison (no content)."""
    name: str                    # original-case filename, e.g. AccountController.cls
    status: ClassStatus
    in_org_a: bool
    in_org_b: bool
    is_identical: bool
    diff_stats: DiffStats = field(default_factory=DiffStats)
    has_error: bool = False       # True if either org's file failed to read

    def to_dict(self) -> dict:
        return {
            "name":        self.name,
            "status":      self.status.value,
            "in_org_a":    self.in_org_a,
            "in_org_b":    self.in_org_b,
            "is_identical": self.is_identical,
            "diff_stats":  self.diff_stats.to_dict(),
            "has_error":   self.has_error,
        }


@dataclass
class ApexClassDetail:
    """Full detail for a single Apex class (including content)."""
    name: str
    status: ClassStatus
    org_a: ApexClassContent
    org_b: ApexClassContent
    diff_stats: DiffStats = field(default_factory=DiffStats)

    def to_dict(self) -> dict:
        return {
            "name":       self.name,
            "status":     self.status.value,
            "org_a":      self.org_a.to_dict(),
            "org_b":      self.org_b.to_dict(),
            "diff_stats": self.diff_stats.to_dict(),
        }


@dataclass
class DiffSummary:
    """High-level summary of the diff between two org folders."""
    total: int = 0
    modified: int = 0
    identical: int = 0
    only_in_org_a: int = 0
    only_in_org_b: int = 0
    org_a_path: str = ""
    org_b_path: str = ""
    # Duplicate .cls filenames found within a single org (same name, different
    # folder). Only the first occurrence is indexed; the rest are listed here
    # so the UI can warn the user instead of silently dropping them.
    duplicates: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total":         self.total,
            "modified":      self.modified,
            "identical":     self.identical,
            "only_in_org_a": self.only_in_org_a,
            "only_in_org_b": self.only_in_org_b,
            "org_a_path":    self.org_a_path,
            "org_b_path":    self.org_b_path,
            "duplicates":    self.duplicates,
        }
