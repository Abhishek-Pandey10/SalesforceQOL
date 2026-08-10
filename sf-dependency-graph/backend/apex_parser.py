"""
apex_parser.py - Heuristic reference extraction for a single Apex file.

There is no lightweight Apex compiler/AST available, so this is a
regex + brace-depth heuristic over the raw text, not a real parser. It:

  1. Blanks out string literals and comments (keeping length/newlines intact
     so line numbers stay correct) so they can't produce false-positive
     matches.
  2. Finds the file's top-level type declaration (class/interface/trigger,
     plus extends/implements) via a regex on the (now comment/string-free)
     header text.
  3. Walks brace depth once to find every top-level method's [start, end)
     character span and name, so any reference found inside a span can be
     attributed to "called from methodName()".
  4. Does a single token-scan pass over the whole file; any identifier that
     matches a name in the whole-org symbol table becomes a reference,
     classified by what immediately precedes/follows it (new X(, X.member(,
     X.member, extends/implements already handled in step 2, instanceof X,
     otherwise a bare type reference).

Known limitations (surfaced in the README, not hidden): this cannot resolve
overloads, polymorphism, dynamic `Type.forName`/reflection, or fully-qualified
managed-package names - it only catches direct textual references to classes
that exist in the scanned org.
"""
from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from backend.models import Occurrence

_NON_METHOD_WORDS = {
    "if", "for", "while", "switch", "catch", "try", "else", "finally", "do",
    "class", "interface", "trigger", "enum", "return", "new", "synchronized",
}

_TYPE_HEADER_RE = re.compile(
    r"\b(class|interface|trigger)\s+(\w+)\b(.*?)\{", re.IGNORECASE | re.DOTALL
)
_TRIGGER_ON_RE = re.compile(r"\bon\s+(\w+)\s*\(", re.IGNORECASE)
_EXTENDS_RE = re.compile(r"\bextends\s+(\w+)", re.IGNORECASE)
_IMPLEMENTS_RE = re.compile(r"\bimplements\s+([\w\s,]+)$", re.IGNORECASE | re.DOTALL)
_IDENT_RE = re.compile(r"[A-Za-z_]\w*")
_METHOD_SIG_RE = re.compile(r"([A-Za-z_]\w*)\s*\([^()]*\)\s*$")


@dataclass
class TypeHeader:
    kind: str                      # "class" | "interface" | "trigger"
    name: str
    extends: Optional[str]
    implements: List[str]
    sobject: Optional[str]         # trigger's "on X" target, informational only
    header_line: int
    header_text: str
    header_start: int
    header_end: int                # offset of the '{' that opens the body


def strip_comments_and_strings(text: str) -> str:
    """Blank out // and /* */ comments and '...' string literals, keeping
    every character's position (and all newlines) intact so downstream line
    numbers and offsets still line up with the original text."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                out[j] = " "
                j += 1
            i = j
        elif ch == "/" and i + 1 < n and text[i + 1] == "*":
            # Bug fix: old loop used `j + 1 < n` which stopped one character
            # short when the comment was never closed, leaving a real identifier
            # character un-blanked and causing false-positive edge matches.
            j = i
            out[j] = " "
            if j + 1 < n:
                out[j + 1] = " "
            j += 2
            while j < n:
                if j + 1 < n and text[j] == "*" and text[j + 1] == "/":
                    out[j] = " "
                    out[j + 1] = " "
                    j += 2
                    break
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            i = j
        elif ch == "'":
            j = i
            out[j] = " "
            j += 1
            while j < n and text[j] != "'":
                if text[j] == "\\" and j + 1 < n:
                    if text[j] != "\n":
                        out[j] = " "
                    j += 1
                    if text[j] != "\n":
                        out[j] = " "
                    j += 1
                    continue
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            if j < n:
                out[j] = " "
                j += 1
            i = j
        else:
            i += 1
    return "".join(out)


def _line_offsets(text: str) -> List[int]:
    """Offset (into text) of the start of each line, for bisect-based
    offset -> line-number lookup."""
    offsets = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def _line_number(line_starts: List[int], offset: int) -> int:
    return bisect_right(line_starts, offset)  # 1-based


line_offsets = _line_offsets  # public alias, used by graph_builder to build node names


def _extract_method_name(buffer: str) -> Optional[str]:
    normalised = " ".join(buffer.split())
    m = _METHOD_SIG_RE.search(normalised)
    if not m:
        return None
    name = m.group(1)
    if name.lower() in _NON_METHOD_WORDS:
        return None
    return name


def find_method_spans(stripped: str) -> List[Tuple[int, int, str]]:
    """One pass over the (comment/string-stripped) text tracking brace depth.
    Returns [(start_offset, end_offset, method_name)] for every brace block
    opened directly inside the top-level type body (depth 1 -> 2) whose
    preceding text looks like a method signature."""
    depth = 0
    stack: List[Tuple[int, int, Optional[str]]] = []  # (depth_at_open, start_off, name)
    last_boundary = 0
    spans: List[Tuple[int, int, str]] = []

    for i, ch in enumerate(stripped):
        if ch == "{":
            buffer = stripped[last_boundary:i]
            name = _extract_method_name(buffer) if depth == 1 else None
            stack.append((depth, i + 1, name))
            depth += 1
            last_boundary = i + 1
        elif ch == "}":
            # Bug fix: the old `max(0, depth - 1)` guard let depth stay at 0
            # while still popping a stack frame for a stray `}`, corrupting
            # every subsequent method-span attribution below that point.
            if depth > 0:
                depth -= 1
                if stack:
                    _open_depth, start_off, name = stack.pop()
                    if name:
                        spans.append((start_off, i, name))
            last_boundary = i + 1
        elif ch == ";":
            last_boundary = i + 1

    return spans


def _method_at(spans: List[Tuple[int, int, str]], offset: int) -> Optional[str]:
    """Return the method name whose span contains *offset*, or None.
    Uses binary search (O(log n)) instead of a linear scan: spans are
    non-overlapping and sorted by start_off, so bisect_right gives the
    candidate index in one step."""
    if not spans:
        return None
    starts = [s[0] for s in spans]
    idx = bisect_right(starts, offset) - 1
    if idx >= 0:
        start, end, name = spans[idx]
        if start <= offset < end:
            return name
    return None


def find_type_header(stripped: str, line_starts: List[int]) -> Optional[TypeHeader]:
    match = _TYPE_HEADER_RE.search(stripped)
    if not match:
        return None

    kind = match.group(1).lower()
    name = match.group(2)
    between = match.group(3)

    extends = None
    implements: List[str] = []
    sobject = None

    if kind == "trigger":
        on_match = _TRIGGER_ON_RE.search(between)
        if on_match:
            sobject = on_match.group(1)
    else:
        ext_match = _EXTENDS_RE.search(between)
        if ext_match:
            extends = ext_match.group(1)
        impl_match = _IMPLEMENTS_RE.search(between)
        if impl_match:
            implements = [
                tok.strip() for tok in impl_match.group(1).split(",") if tok.strip()
            ]

    return TypeHeader(
        kind=kind,
        name=name,
        extends=extends,
        implements=implements,
        sobject=sobject,
        header_line=_line_number(line_starts, match.start()),
        header_text=between,
        header_start=match.start(),
        header_end=match.end(),
    )


def _preceding_word(text: str, start: int) -> Optional[str]:
    i = start - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    end = i + 1
    while i >= 0 and (text[i].isalnum() or text[i] == "_"):
        i -= 1
    if end - (i + 1) <= 0:
        return None
    return text[i + 1:end]


def _next_non_space(text: str, start: int) -> Tuple[Optional[str], int]:
    i = start
    n = len(text)
    while i < n and text[i].isspace():
        i += 1
    if i >= n:
        return None, i
    return text[i], i


def _read_ident_at(text: str, start: int) -> Tuple[Optional[str], int]:
    m = _IDENT_RE.match(text, start)
    if not m:
        return None, start
    return m.group(0), m.end()


def parse_apex_file(
    original_text: str,
    rel_path: str,
    self_id: str,
    symbol_table: Dict[str, str],
    *,
    pre_stripped: Optional[str] = None,
) -> Tuple[Optional[TypeHeader], List[Tuple[str, Occurrence]]]:
    """
    Parse one Apex file's text.

    symbol_table maps lowercased class/interface/trigger name -> node id for
    every Apex type known in the org (excluding this file's own type).

    pre_stripped: pass the already-computed strip_comments_and_strings() result
    to avoid doing the work twice (graph_builder computes it in Pass 1).

    Returns (type_header, [(target_node_id, Occurrence), ...]).
    """
    stripped = pre_stripped if pre_stripped is not None else strip_comments_and_strings(original_text)
    line_starts = _line_offsets(original_text)
    original_lines = original_text.splitlines()
    method_spans = find_method_spans(stripped)
    header = find_type_header(stripped, line_starts)

    results: List[Tuple[str, Occurrence]] = []

    def snippet_for(line_no: int) -> str:
        if 1 <= line_no <= len(original_lines):
            text = original_lines[line_no - 1].strip()
        else:
            text = ""
        return text[:200]

    def emit(target_id: str, line_no: int, kind: str, caller_method: Optional[str],
              detail: Optional[str]) -> None:
        if target_id == self_id:
            return
        results.append((
            target_id,
            Occurrence(
                file=rel_path,
                line=line_no,
                snippet=snippet_for(line_no),
                kind=kind,
                caller_method=caller_method,
                detail=detail,
            ),
        ))

    header_start, header_end = (header.header_start, header.header_end) if header else (-1, -1)

    if header:
        if header.extends:
            target = symbol_table.get(header.extends.lower())
            if target:
                emit(target, header.header_line, "extends", None, None)
        for impl_name in header.implements:
            target = symbol_table.get(impl_name.lower())
            if target:
                emit(target, header.header_line, "implements", None, None)

    for m in _IDENT_RE.finditer(stripped):
        start, end = m.start(), m.end()
        if header_start <= start < header_end:
            continue  # already handled via the type header (incl. self name)

        word = m.group(0)
        target_id = symbol_table.get(word.lower())
        if not target_id or target_id == self_id:
            continue

        line_no = _line_number(line_starts, start)
        caller_method = _method_at(method_spans, start)
        preceding = _preceding_word(stripped, start)
        next_char, next_pos = _next_non_space(stripped, end)

        if preceding and preceding.lower() == "new":
            emit(target_id, line_no, "instantiation", caller_method, None)
        elif preceding and preceding.lower() == "instanceof":
            emit(target_id, line_no, "instanceof", caller_method, None)
        elif next_char == ".":
            member, member_end = _read_ident_at(stripped, next_pos + 1)
            after_member_char, _ = _next_non_space(stripped, member_end) if member else (None, member_end)
            if member and after_member_char == "(":
                emit(target_id, line_no, "static_call", caller_method, member)
            elif member:
                emit(target_id, line_no, "field_access", caller_method, member)
            else:
                emit(target_id, line_no, "type_reference", caller_method, None)
        else:
            emit(target_id, line_no, "type_reference", caller_method, None)

    return header, results
