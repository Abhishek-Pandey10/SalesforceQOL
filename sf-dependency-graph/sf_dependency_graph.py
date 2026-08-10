#!/usr/bin/env python3
"""
sf_dependency_graph.py - Entry point for the SF Dependency Graph tool.

Usage:
    python sf_dependency_graph.py <org_folder> [options]

Options:
    --focus NAME    Open straight into this class/component's blast-radius view
    --port PORT     Port to listen on (default: 8020)
    --host HOST     Host to bind to (default: 127.0.0.1)
    --no-browser    Do not open the browser automatically
    --help          Show this help message and exit

Example:
    python sf_dependency_graph.py ../samples/org1
    python sf_dependency_graph.py ../samples/org1 --focus AccountController
"""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import quote

import uvicorn

# Ensure the project root is on sys.path so `backend` package resolves.
PROJECT_ROOT = Path(__file__).parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.graph_builder import DependencyGraph
from backend.api import create_app
from backend.export import build_full_export_html

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("sf_dependency_graph")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sf_dependency_graph",
        description=(
            "SF Dependency Graph — an Obsidian-style dependency graph for one\n"
            "Salesforce org folder: which Apex classes/triggers and LWC components\n"
            "reference which, and how, so you can gauge blast radius before a change."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python sf_dependency_graph.py ../samples/org1
  python sf_dependency_graph.py /path/to/org/force-app/main/default --focus AccountController
  python sf_dependency_graph.py ../samples/org1 --port 9020 --no-browser
        """,
    )
    parser.add_argument(
        "org_folder",
        metavar="ORG_FOLDER",
        help="Path to a folder containing Apex classes/triggers and/or LWC components (searched recursively).",
    )
    parser.add_argument(
        "--focus",
        metavar="NAME",
        default=None,
        help="Class or component name to open directly into its blast-radius view.",
    )
    parser.add_argument("--port", type=int, default=8020, metavar="PORT",
                         help="Port to run the local web server on (default: 8020).")
    parser.add_argument("--host", default="127.0.0.1", metavar="HOST",
                         help="Host address to bind (default: 127.0.0.1).")
    parser.add_argument("--no-browser", action="store_true",
                         help="Do not open the browser automatically after starting.")
    return parser


def validate_path(org_folder: str) -> Path:
    path = Path(org_folder)
    if not path.exists():
        logger.error("Org folder does not exist: %r", org_folder)
        sys.exit(1)
    if not path.is_dir():
        logger.error("Path is not a directory: %r", org_folder)
        sys.exit(1)
    return path.resolve()


def write_debug_export(graph: DependencyGraph) -> None:
    """Write the full graph straight to disk at startup, bypassing HTTP and
    the browser entirely - lets a broken exporter be told apart from a
    browser/download problem. Same rationale as the sibling tools."""
    full_graph = graph.get_graph(occurrence_limit=None)
    if not full_graph["nodes"]:
        return

    html = build_full_export_html(graph.get_summary(), full_graph)
    debug_path = PROJECT_ROOT / "DependencyGraphOutput.html"
    debug_path.write_text(html, encoding="utf-8")
    logger.info(
        "Wrote a full graph report (%d nodes, %d edges) to %s — open it "
        "directly (double-click, no browser download involved) to confirm "
        "the exporter itself works.",
        len(full_graph["nodes"]), len(full_graph["edges"]), debug_path,
    )


def build_graph_in_background(graph: DependencyGraph) -> None:
    """Run the (potentially slow) scan off the startup critical path so
    uvicorn starts accepting connections immediately; API routes return 503
    (see backend.api._readiness_gate) until graph.is_ready()."""
    def _run():
        graph.build()

        summary = graph.summary
        logger.info("─" * 60)
        logger.info("  Apex classes     : %d", summary.apex_classes)
        logger.info("  Apex interfaces  : %d", summary.apex_interfaces)
        logger.info("  Apex triggers    : %d", summary.apex_triggers)
        logger.info("  LWC components   : %d", summary.lwc_components)
        logger.info("  Edges            : %d", summary.total_edges)
        logger.info("  Unresolved refs  : %d", summary.unresolved_reference_count)
        logger.info("─" * 60)
        logger.info("Graph ready — API requests will now be served.")

        try:
            write_debug_export(graph)
        except Exception:
            logger.exception("Failed to write DependencyGraphOutput.html")

    threading.Thread(target=_run, daemon=True).start()


def open_browser_after_delay(url: str, delay: float = 1.5) -> None:
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not open browser: %s", exc)

    threading.Thread(target=_open, daemon=True).start()


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    org_path = validate_path(args.org_folder)

    logger.info("=" * 60)
    logger.info("  SF Dependency Graph")
    logger.info("  Org folder : %s", org_path)
    logger.info("=" * 60)

    graph = DependencyGraph(str(org_path), build_immediately=False)
    logger.info("Building dependency graph in the background …")
    build_graph_in_background(graph)

    app = create_app(graph)

    url = f"http://{args.host}:{args.port}"
    if args.focus:
        url = f"{url}/?focus={quote(args.focus)}"
    logger.info("Starting server at %s", url)

    if not args.no_browser:
        open_browser_after_delay(url)

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
