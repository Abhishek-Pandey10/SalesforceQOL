"""
models.py - Data models for the LWC Org Diff tool.

An Apex class is one file; an LWC component is a *bundle* of files (.js,
.html, .css, .js-meta.xml, optionally __tests__/*.test.js, .svg, ...). Every
model here therefore has two levels: a component (the bundle as a whole,
identified by its folder name) and the individual files inside it.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class DiffStatus(str, Enum):
    """Status shared by both component-level and file-level comparisons."""
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

    def __iadd__(self, other: "DiffStats") -> "DiffStats":
        self.lines_added += other.lines_added
        self.lines_removed += other.lines_removed
        self.lines_changed += other.lines_changed
        return self


@dataclass
class LwcFileContent:
    """Content of a single bundle file from one org."""
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
class LwcFileMeta:
    """Metadata for one file inside a component bundle (no content)."""
    name: str                    # relative path within the bundle, original case
                                  # e.g. "myComponent.js", "__tests__/myComponent.test.js"
    status: DiffStatus
    in_org_a: bool
    in_org_b: bool
    is_identical: bool
    diff_stats: DiffStats = field(default_factory=DiffStats)
    has_error: bool = False

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
class LwcFileDetail:
    """Full detail for one bundle file (including content from both orgs)."""
    name: str
    status: DiffStatus
    org_a: LwcFileContent
    org_b: LwcFileContent
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
class LwcComponentMeta:
    """Metadata for a single LWC component comparison (no file content)."""
    name: str                    # original-case bundle folder name, e.g. myAccountCard
    status: DiffStatus
    in_org_a: bool
    in_org_b: bool
    is_identical: bool
    file_count: int              # union of files present on either side
    diff_stats: DiffStats = field(default_factory=DiffStats)   # summed across all files
    has_error: bool = False      # True if any file in the bundle failed to read
    files: list = field(default_factory=list)   # list[LwcFileMeta.to_dict()] - lightweight, no content

    def to_dict(self) -> dict:
        return {
            "name":        self.name,
            "status":      self.status.value,
            "in_org_a":    self.in_org_a,
            "in_org_b":    self.in_org_b,
            "is_identical": self.is_identical,
            "file_count":  self.file_count,
            "diff_stats":  self.diff_stats.to_dict(),
            "has_error":   self.has_error,
            "files":       self.files,
        }


@dataclass
class LwcComponentDetail:
    """Full detail for a single component: every bundle file, both orgs' content."""
    name: str
    status: DiffStatus
    files: list = field(default_factory=list)    # list[LwcFileDetail.to_dict()]
    diff_stats: DiffStats = field(default_factory=DiffStats)

    def to_dict(self) -> dict:
        return {
            "name":       self.name,
            "status":     self.status.value,
            "files":      self.files,
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
    # Duplicate component folder names found within a single org (same name,
    # different parent folder). Only the first occurrence is indexed; the
    # rest are listed here so the UI can warn the user instead of silently
    # dropping them.
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
