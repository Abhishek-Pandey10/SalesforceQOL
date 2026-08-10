"""
lwc_parser.py - Heuristic reference extraction for a single LWC bundle.

Unlike Apex, LWC's dependency surface is mostly declared through a handful
of well-known, textually-regular patterns, so this needs far less machinery
than apex_parser.py:

  - `import ALIAS from '@salesforce/apex/Class.method'`         -> Apex edge
  - `import ALIAS from 'c/childComponent'`                       -> LWC edge
  - `<c-child-component ...>` in the template                     -> LWC edge
    (composition: this component renders that one)

For each Apex import, the rest of the JS file is checked for how ALIAS is
actually used - `@wire(ALIAS` (wired) vs `ALIAS(` elsewhere (imperative) vs
neither (imported but unused) - so the graph can show not just "this
component depends on that Apex method" but *how*.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

from backend.models import Occurrence

_IMPORT_APEX_RE = re.compile(
    r"""import\s+(\w+)\s+from\s+['"]@salesforce/apex/([\w.]+)\.(\w+)['"]"""
)
_IMPORT_LWC_DEFAULT_RE = re.compile(
    r"""import\s+(\w+)\s+from\s+['"]c/(\w+)['"]"""
)
_CHILD_TAG_RE = re.compile(r"<c-([a-z0-9-]+)", re.IGNORECASE)


def _strip_js_comments_and_strings(text: str) -> str:
    """Same idea as apex_parser.strip_comments_and_strings but also handles
    JS double-quoted and backtick-delimited strings, since LWC .js files use
    all three. Length/newlines are preserved."""
    out = list(text)
    i, n = 0, len(text)
    quote_chars = {"'", '"', "`"}
    while i < n:
        ch = text[i]
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                out[j] = " "
                j += 1
            i = j
        elif ch == "/" and i + 1 < n and text[i + 1] == "*":
            j = i
            out[j] = " "
            if j + 1 < n:
                out[j + 1] = " "
            j += 2
            while j + 1 < n and not (text[j] == "*" and text[j + 1] == "/"):
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            if j + 1 < n:
                out[j] = " "
                out[j + 1] = " "
                j += 2
            i = j
        elif ch in quote_chars:
            delim = ch
            j = i
            out[j] = " "
            j += 1
            while j < n and text[j] != delim:
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


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _snippet(lines: List[str], line_no: int) -> str:
    if 1 <= line_no <= len(lines):
        return lines[line_no - 1].strip()[:200]
    return ""


def _kebab_to_camel(kebab: str) -> str:
    parts = kebab.split("-")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:] if p)


def parse_lwc_js(
    content: str,
    rel_path: str,
    self_id: str,
    apex_symbol_table: Dict[str, str],
    lwc_symbol_table: Dict[str, str],
) -> List[Tuple[str, Occurrence]]:
    """Parse one .js file inside an LWC bundle for Apex and LWC-to-LWC
    imports. Returns [(target_node_id, Occurrence), ...]."""
    stripped = _strip_js_comments_and_strings(content)
    lines = content.splitlines()
    results: List[Tuple[str, Occurrence]] = []

    # Import regexes run against the ORIGINAL content, not the comment/string
    # -stripped text: the information we need (the apex/LWC target path) is
    # itself inside a string literal, which stripping would blank out.
    # `content` and `stripped` have identical length/newlines, so match
    # offsets from here stay valid when passed into stripped-text scans below
    # (e.g. _classify_apex_usage).
    for m in _IMPORT_APEX_RE.finditer(content):
        alias, dotted_class, method = m.group(1), m.group(2), m.group(3)
        class_name = dotted_class.rsplit(".", 1)[-1]
        target_id = apex_symbol_table.get(class_name.lower())
        if not target_id or target_id == self_id:
            continue

        line_no = _line_number(content, m.start())
        usage = _classify_apex_usage(stripped, alias, m.end())
        results.append((
            target_id,
            Occurrence(
                file=rel_path,
                line=line_no,
                snippet=_snippet(lines, line_no),
                kind=usage,
                caller_method=None,
                detail=f"imported as `{alias}`, calls {class_name}.{method}()",
            ),
        ))

    for m in _IMPORT_LWC_DEFAULT_RE.finditer(content):
        alias, child_name = m.group(1), m.group(2)
        target_id = lwc_symbol_table.get(child_name.lower())
        if not target_id or target_id == self_id:
            continue
        line_no = _line_number(content, m.start())
        results.append((
            target_id,
            Occurrence(
                file=rel_path,
                line=line_no,
                snippet=_snippet(lines, line_no),
                kind="js_import",
                caller_method=None,
                detail=f"imported as `{alias}`",
            ),
        ))

    return results


def _classify_apex_usage(stripped: str, alias: str, search_from: int) -> str:
    wire_re = re.compile(r"@wire\(\s*" + re.escape(alias) + r"\b")
    call_re = re.compile(r"\b" + re.escape(alias) + r"\s*\(")

    rest = stripped[search_from:]
    if wire_re.search(rest):
        return "apex_wire"
    if call_re.search(rest):
        return "apex_imperative"
    return "apex_unused_import"


def parse_lwc_html(
    content: str,
    rel_path: str,
    self_id: str,
    lwc_symbol_table: Dict[str, str],
) -> List[Tuple[str, Occurrence]]:
    """Parse one .html template inside an LWC bundle for child component
    tags (<c-child-name>). Returns [(target_node_id, Occurrence), ...]."""
    lines = content.splitlines()
    results: List[Tuple[str, Occurrence]] = []
    seen_lines: Dict[str, set] = {}

    for m in _CHILD_TAG_RE.finditer(content):
        kebab = m.group(1).rstrip("-")
        camel = _kebab_to_camel(kebab)
        target_id = lwc_symbol_table.get(camel.lower())
        if not target_id or target_id == self_id:
            continue

        line_no = _line_number(content, m.start())
        already = seen_lines.setdefault(target_id, set())
        if line_no in already:
            continue
        already.add(line_no)

        results.append((
            target_id,
            Occurrence(
                file=rel_path,
                line=line_no,
                snippet=_snippet(lines, line_no),
                kind="composition",
                caller_method=None,
                detail=f"<c-{kebab}>",
            ),
        ))

    return results
