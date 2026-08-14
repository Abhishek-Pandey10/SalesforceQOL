"""
export.py - Builds self-contained HTML exports of the dependency graph.

Same trick as the sibling tools' build_full_export_html: the real frontend
(index.html/app.js/styles.css) is reused verbatim, with the dataset embedded
inline as window.__EXPORT_DATA__ instead of fetched from a backend, so the
file opens directly (file://, no server) and is interactive - the
frontend's blast-radius BFS, tooltips, and detail panels all run
client-side against whatever data they're given, live or embedded. Still
requires internet access to load vis-network from its CDN (see README);
only the data/backend dependency is removed, not the CDN one.

Two variants:
  - build_full_export_html: the whole graph, opened with no focus node.
  - build_export_html: one node's blast radius (used by the UI's per-node
    "Export" button, and by the startup debug export).
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Optional

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def _read_frontend_asset(filename: str) -> str:
    return (FRONTEND_DIR / filename).read_text(encoding="utf-8")


def _build_page(payload: dict, title_suffix: str) -> str:
    index_html = _read_frontend_asset("index.html")
    app_js = _read_frontend_asset("app.js")
    styles_css = _read_frontend_asset("styles.css")

    # Neutralize "</script" sequences (e.g. inside a snippet that happens to
    # contain that text) so they can't prematurely close the inline block.
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    # Title replacement: the title tag is unlikely to be reformatted, so a
    # plain string replace is fine here. title_suffix can embed a node name
    # taken verbatim from scanned org data (an LWC bundle name comes
    # straight from a filesystem directory name with no character
    # restrictions - see app.js's buildNodeTooltip, which escapes for the
    # same reason) - HTML-escaped here so it can't break out of the <title>
    # tag and inject markup/script into the exported file.
    index_html = index_html.replace(
        "<title>SF Dependency Graph — Apex/LWC Blast Radius</title>",
        f"<title>SF Dependency Graph — {html.escape(title_suffix)}</title>",
        1,
    )

    # Styles/script: anchored on the marker comments so reformatting the
    # <link>/<script> tags can never silently break the export. The
    # replacement is passed as a function, not a string: re.sub treats a
    # string repl as a mini escape language (\1, \g<...>, \n, ...), so any
    # backslash that happens to appear in generated content - e.g. a
    # control character in scanned org source rendered by json.dumps as
    # \u00XX - would raise re.error or silently mangle the output. A
    # function's return value is used verbatim, no escape processing.
    index_html = re.sub(
        r"<!--\s*INJECT:STYLES\s*--><link[^>]*/>",
        lambda _m: f"<!-- INJECT:STYLES --><style>\n{styles_css}\n</style>",
        index_html,
        count=1,
    )

    # Script: same marker-anchored approach; also embeds the export payload
    # as window.__EXPORT_DATA__ before the inlined app.js.
    index_html = re.sub(
        r"<!--\s*INJECT:SCRIPT\s*--><script[^>]*></script>",
        lambda _m: (
            f"<!-- INJECT:SCRIPT --><script>window.__EXPORT_DATA__ = {payload_json};</script>\n"
            f"<script>\n{app_js}\n</script>"
        ),
        index_html,
        count=1,
    )
    return index_html


def build_full_export_html(summary: dict, graph: dict) -> str:
    """Standalone export of the entire graph, no focus node preselected."""
    payload = {"summary": summary, "graph": graph, "focus": None}
    title = f"Static Export ({summary.get('total_nodes', 0)} nodes)"
    return _build_page(payload, title)


def build_export_html(blast_radius: dict, org_path: str) -> str:
    """Standalone export of one node's blast radius (the induced subgraph
    returned by DependencyGraph.blast_radius)."""
    nodes = blast_radius.get("nodes", [])
    edges = blast_radius.get("edges", [])
    focus_id: Optional[str] = blast_radius.get("focus")
    focus_name = next((n.get("name") for n in nodes if n.get("id") == focus_id), focus_id or "")

    summary = {
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "org_path": org_path,
        "unresolved_reference_count": 0,
    }
    payload = {
        "summary": summary,
        "graph": {"nodes": nodes, "edges": edges},
        "focus": focus_id,
        "depth": blast_radius.get("depth"),
        "direction": blast_radius.get("direction"),
    }
    return _build_page(payload, f"Blast Radius — {focus_name}")
