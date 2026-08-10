"""
export.py - Builds self-contained HTML diff reports for LWC components.

Same rationale as apex-org-diff/backend/export.py: server-rendered HTML
returned with a Content-Disposition header is more reliable across browsers
than a client-side Blob + synthetic <a download> click.

Two reports are built here:
  - build_export_html:      one component, a small standalone page with one
    diff section per bundle file (used by the UI's "Export" button).
  - build_full_export_html: every component in the comparison, reusing the
    real frontend (index.html/app.js/styles.css) with the dataset embedded
    inline instead of fetched from a backend - opens directly with no
    server running. Used for the startup debug export.
"""
from __future__ import annotations

import difflib
import html as html_lib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

STATUS_LABELS = {
    "modified": "Modified",
    "identical": "Identical",
    "only_in_org_a": "Only in Org A",
    "only_in_org_b": "Only in Org B",
}


def _read_frontend_asset(filename: str) -> str:
    return (FRONTEND_DIR / filename).read_text(encoding="utf-8")

# Shared look for both the single-component and full-report pages.
_BASE_STYLE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #0d1117;
  color: #e6edf3;
}
header {
  background: #161b22;
  border-bottom: 1px solid #30363d;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
h1 { font-size: 15px; font-weight: 700; letter-spacing: -.2px; }
h2 { font-size: 13px; font-weight: 700; letter-spacing: -.1px; }
.badge {
  font-size: 11px; font-weight: 700;
  padding: 2px 9px; border-radius: 4px;
  white-space: nowrap;
}
.badge-modified  { background: rgba(227,179,65,.2);  color: #e3b341; }
.badge-identical { background: rgba(63,185,80,.15);  color: #3fb950; }
.badge-only-in-org-a { background: rgba(88,166,255,.15);  color: #58a6ff; }
.badge-only-in-org-b { background: rgba(188,140,255,.15); color: #bc8cff; }
.meta { margin-left: auto; font-size: 11px; color: #8b949e; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.stat-add { color: #3fb950; font-weight: 700; }
.stat-del { color: #f85149; font-weight: 700; }
.warning-banner {
  background: rgba(248,81,73,.12);
  color: #f85149;
  border-bottom: 1px solid rgba(248,81,73,.3);
  padding: 8px 20px;
  font-size: 12px;
  flex-shrink: 0;
}
.file-section { border-top: 1px solid #21262d; }
.file-section:first-of-type { border-top: none; }
.file-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px;
  background: #10151c;
}
.file-name { font-family: 'Cascadia Code','JetBrains Mono','Fira Code','Consolas',monospace; font-size: 12.5px; color: #e6edf3; }
.col-bar {
  display: flex;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0;
  background: #161b22;
}
.col-label {
  flex: 1;
  padding: 7px 16px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .6px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 8px;
}
.col-label.a { color: #58a6ff; border-right: 1px solid #21262d; }
.col-label.b { color: #bc8cff; }
.col-path { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 10px; color: #484f58; }
.diff-area {
  display: flex;
  min-height: 0;
}
.col-code {
  flex: 1;
  overflow: auto;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12.5px;
  line-height: 1.65;
  max-height: 480px;
}
.col-code.a { border-right: 1px solid #21262d; }
.code-line {
  display: flex;
  min-width: 0;
  padding: 0 8px;
}
.code-line:hover { background: rgba(255,255,255,.03); }
.code-line.line-add { background: rgba(63,185,80,.13); }
.code-line.line-del { background: rgba(248,81,73,.13); }
.ln {
  flex-shrink: 0;
  width: 42px;
  color: #484f58;
  user-select: none;
  text-align: right;
  padding-right: 14px;
  font-size: 11px;
  line-height: 1.65;
}
.code {
  flex: 1;
  white-space: pre;
  overflow-x: visible;
  color: #e6edf3;
}
.empty { color:#484f58; padding:12px 16px; display:block; font-style: italic; }
footer {
  padding: 8px 20px;
  font-size: 10px;
  color: #484f58;
  border-top: 1px solid #21262d;
  background: #161b22;
  flex-shrink: 0;
}
"""

_LOGO_SVG = """<svg width="22" height="22" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="8" fill="#0176d3"/>
    <path d="M9 20 a5 5 0 0 1 5 -8 a6 6 0 0 1 11 2 a4.5 4.5 0 0 1 -1 8.9 H10 a4 4 0 0 1 -1 -2.9 Z" fill="#fff"/>
  </svg>"""


def _esc(text: str) -> str:
    return html_lib.escape(text, quote=True)


def _slug(name: str) -> str:
    return "lwc-" + re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-")


def _generated_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S UTC")


def _line_html(number: int, text: str, css_class: str = "") -> str:
    cls = f' class="code-line {css_class}"' if css_class else ' class="code-line"'
    return f'<div{cls}><span class="ln">{number}</span><span class="code">{_esc(text)}</span></div>'


def _plain_column(lines: List[str]) -> str:
    if not lines or (len(lines) == 1 and lines[0] == ""):
        return '<em class="empty">(empty file)</em>'
    return "".join(_line_html(i + 1, line) for i, line in enumerate(lines))


def _diff_columns(lines_a: List[str], lines_b: List[str]) -> Tuple[str, str]:
    """Render both columns with add/remove highlighting via difflib opcodes."""
    matcher = difflib.SequenceMatcher(None, lines_a, lines_b, autojunk=False)
    html_a: List[str] = []
    html_b: List[str] = []
    na = nb = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                na += 1
                nb += 1
                html_a.append(_line_html(na, lines_a[i1 + offset]))
                html_b.append(_line_html(nb, lines_b[j1 + offset]))
        else:
            if tag in ("delete", "replace"):
                for k in range(i1, i2):
                    na += 1
                    html_a.append(_line_html(na, lines_a[k], "line-del"))
            if tag in ("insert", "replace"):
                for k in range(j1, j2):
                    nb += 1
                    html_b.append(_line_html(nb, lines_b[k], "line-add"))

    return "".join(html_a) or '<em class="empty">(empty file)</em>', \
           "".join(html_b) or '<em class="empty">(empty file)</em>'


def _render_diff_body(file_detail: dict) -> Tuple[str, str, str]:
    """Return (code_a_html, code_b_html, warning_banner_html) for one file."""
    org_a = file_detail.get("org_a") or {}
    org_b = file_detail.get("org_b") or {}

    error_a = org_a.get("error")
    error_b = org_b.get("error")

    if not org_a.get("exists"):
        code_a = '<em class="empty">(not present)</em>'
    elif error_a:
        code_a = f'<em class="empty">⚠ Could not read file: {_esc(error_a)}</em>'
    else:
        code_a = None

    if not org_b.get("exists"):
        code_b = '<em class="empty">(not present)</em>'
    elif error_b:
        code_b = f'<em class="empty">⚠ Could not read file: {_esc(error_b)}</em>'
    else:
        code_b = None

    if code_a is None and code_b is None:
        # splitlines(), not split("\n"): the latter appends a phantom empty
        # element whenever content ends in a newline (i.e. almost always),
        # which renders as a bogus extra blank line, and makes two files
        # differing only in trailing-newline presence show a fake diff.
        lines_a = (org_a.get("content") or "").splitlines()
        lines_b = (org_b.get("content") or "").splitlines()
        code_a, code_b = _diff_columns(lines_a, lines_b)
    else:
        if code_a is None:
            code_a = _plain_column((org_a.get("content") or "").splitlines())
        if code_b is None:
            code_b = _plain_column((org_b.get("content") or "").splitlines())

    warning_banner = ""
    if error_a or error_b:
        msgs = []
        if error_a:
            msgs.append(f"Org A: {_esc(error_a)}")
        if error_b:
            msgs.append(f"Org B: {_esc(error_b)}")
        warning_banner = (
            '<div class="warning-banner">⚠ Could not fully read this file '
            f'&mdash; {" | ".join(msgs)}</div>'
        )

    return code_a, code_b, warning_banner


def _file_section_html(file_detail: dict) -> str:
    """One bundle file's header + diff columns."""
    name = file_detail["name"]
    status = file_detail["status"]
    stats = file_detail.get("diff_stats") or {"lines_added": 0, "lines_removed": 0}
    badge_class = "badge-" + status.replace("_", "-")
    label = STATUS_LABELS.get(status, status)
    code_a, code_b, warning_banner = _render_diff_body(file_detail)

    return f"""<section class="file-section" id="{_slug(name)}">
  <div class="file-header">
    <span class="file-name">{_esc(name)}</span>
    <span class="badge {badge_class}">{_esc(label)}</span>
    <div class="meta">
      <span class="stat-add">+{stats['lines_added']} added</span>
      <span class="stat-del">−{stats['lines_removed']} removed</span>
    </div>
  </div>
  {warning_banner}
  <div class="diff-area">
    <div class="col-code a">{code_a}</div>
    <div class="col-code b">{code_b}</div>
  </div>
</section>"""


def build_export_html(detail: dict, org_a_path: str, org_b_path: str) -> str:
    """Build a self-contained HTML diff report for one component (every
    bundle file, one section each)."""
    name = detail["name"]
    status = detail["status"]
    stats = detail.get("diff_stats") or {"lines_added": 0, "lines_removed": 0}
    badge_class = "badge-" + status.replace("_", "-")
    label = STATUS_LABELS.get(status, status)
    generated = _generated_stamp()

    files_html = "".join(_file_section_html(f) for f in detail.get("files", []))
    if not files_html:
        files_html = '<em class="empty" style="padding:20px;display:block;">(no files in this bundle)</em>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>LWC Diff — {_esc(name)}</title>
<style>
{_BASE_STYLE}
body {{ display: flex; flex-direction: column; min-height: 100vh; }}
</style>
</head>
<body>
<header>
  {_LOGO_SVG}
  <h1>{_esc(name)}</h1>
  <span class="badge {badge_class}">{_esc(label)}</span>
  <div class="meta">
    <span class="stat-add">+{stats['lines_added']} added</span>
    <span class="stat-del">−{stats['lines_removed']} removed</span>
  </div>
</header>
<div class="col-bar">
  <div class="col-label a"><span class="col-path">Org A: {_esc(org_a_path)}</span></div>
  <div class="col-label b"><span class="col-path">Org B: {_esc(org_b_path)}</span></div>
</div>
{files_html}
<footer>LWC Org Diff &mdash; exported {_esc(generated)}</footer>
</body>
</html>"""


def build_full_export_html(summary: dict, components_meta: List[dict], details: List[dict]) -> str:
    """
    Build a single, self-contained HTML file that looks and behaves like the
    live app - same sidebar with expandable per-component file rows,
    search/filter, Monaco diff editor - but with the entire dataset embedded
    inline instead of fetched from a
    backend. Open it directly (double-click, file://) with no server
    running.

    Monaco Editor itself is still loaded from the CDN the live app uses, so
    an internet connection is required to render the diff view, exactly
    like the live app.
    """
    index_html = _read_frontend_asset("index.html")
    app_js = _read_frontend_asset("app.js")
    styles_css = _read_frontend_asset("styles.css")

    details_by_name = {d["name"]: d for d in details}
    payload = {
        "summary": summary,
        "components": components_meta,
        "details": details_by_name,
    }
    # Neutralize "</script" sequences (e.g. inside an LWC file that happens
    # to contain that text) so they can't prematurely close the inline
    # <script> block.
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    index_html = index_html.replace(
        '<title>LWC Org Diff — Lightning Web Component Comparison</title>',
        f'<title>LWC Org Diff — Static Export ({summary.get("total", len(components_meta))} components)</title>',
        1,
    )
    index_html = index_html.replace(
        '<link rel="stylesheet" href="/static/styles.css" />',
        f"<style>\n{styles_css}\n</style>",
        1,
    )
    index_html = index_html.replace(
        '<script src="/static/app.js"></script>',
        f'<script>window.__EXPORT_DATA__ = {payload_json};</script>\n'
        f"<script>\n{app_js}\n</script>",
        1,
    )

    return index_html
