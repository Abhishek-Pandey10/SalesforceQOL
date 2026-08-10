#!/usr/bin/env python3
"""
lwc_diff.py - Entry point for the LWC Org Diff tool.

Usage:
    python lwc_diff.py <org_a_folder> <org_b_folder> [options]

Options:
    --port PORT     Port to listen on (default: 8010)
    --host HOST     Host to bind to (default: 127.0.0.1)
    --no-browser    Do not open the browser automatically
    --help          Show this help message and exit

Example:
    python lwc_diff.py ./org1/lwc ./org2/lwc
    python lwc_diff.py ./org1/lwc ./org2/lwc --port 9010 --no-browser
"""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

# Ensure the project root is on sys.path so `backend` package resolves.
PROJECT_ROOT = Path(__file__).parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.scanner import DiffIndex
from backend.api import create_app
from backend.export import build_full_export_html

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lwc_diff")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lwc_diff",
        description=(
            "LWC Org Diff — compare Lightning Web Components between two Salesforce\n"
            "org folders and display bundle-level differences in a Monaco Editor diff viewer."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python lwc_diff.py ./org1/lwc ./org2/lwc
  python lwc_diff.py /path/to/prod/lwc /path/to/sandbox/lwc --port 9010
  python lwc_diff.py ./org1/lwc ./org2/lwc --no-browser
        """,
    )
    parser.add_argument(
        "org_a",
        metavar="ORG_A_FOLDER",
        help="Path to the folder containing LWC components from Org A.",
    )
    parser.add_argument(
        "org_b",
        metavar="ORG_B_FOLDER",
        help="Path to the folder containing LWC components from Org B.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8010,
        metavar="PORT",
        help="Port to run the local web server on (default: 8010).",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        metavar="HOST",
        help="Host address to bind (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically after starting.",
    )
    return parser


def validate_paths(org_a: str, org_b: str) -> tuple[Path, Path]:
    """Validate the two org folder paths and return resolved Path objects."""
    errors = []
    a = Path(org_a)
    b = Path(org_b)

    if not a.exists():
        errors.append(f"Org A folder does not exist: {org_a!r}")
    elif not a.is_dir():
        errors.append(f"Org A path is not a directory: {org_a!r}")

    if not b.exists():
        errors.append(f"Org B folder does not exist: {org_b!r}")
    elif not b.is_dir():
        errors.append(f"Org B path is not a directory: {org_b!r}")

    if errors:
        for err in errors:
            logger.error(err)
        sys.exit(1)

    return a.resolve(), b.resolve()


def write_debug_export(diff_index: DiffIndex) -> None:
    """
    Write the full org-vs-org comparison straight to disk at startup,
    bypassing HTTP and the browser entirely - lets a broken exporter be told
    apart from a browser/download problem (see apex-org-diff's version of
    this function for the full rationale).
    """
    all_meta = diff_index.get_all_meta()
    if not all_meta:
        return

    details = [
        detail
        for meta in all_meta
        if (detail := diff_index.get_component_detail(meta["name"])) is not None
    ]

    html = build_full_export_html(diff_index.get_summary(), all_meta, details)
    debug_path = PROJECT_ROOT / "LwcDiffOutput.html"
    debug_path.write_text(html, encoding="utf-8")
    logger.info(
        "Wrote a full comparison report (%d components) to %s — open it "
        "directly (double-click, no browser download involved) to confirm "
        "the exporter itself works.",
        len(details),
        debug_path,
    )


def build_index_in_background(diff_index: DiffIndex) -> None:
    """
    Run the (potentially slow) index scan off the startup critical path so
    uvicorn starts accepting connections immediately; API routes return 503
    (see backend.api._readiness_gate) until diff_index.is_ready().
    """
    def _run():
        diff_index.build()

        summary = diff_index.summary
        logger.info("─" * 60)
        logger.info("  Total components : %d", summary.total)
        logger.info("  Modified         : %d", summary.modified)
        logger.info("  Identical        : %d", summary.identical)
        logger.info("  Only in Org A    : %d", summary.only_in_org_a)
        logger.info("  Only in Org B    : %d", summary.only_in_org_b)
        logger.info("─" * 60)
        logger.info("Index ready — API requests will now be served.")

        try:
            write_debug_export(diff_index)
        except Exception:
            logger.exception("Failed to write LwcDiffOutput.html")

    threading.Thread(target=_run, daemon=True).start()


def open_browser_after_delay(url: str, delay: float = 1.5) -> None:
    """Open the browser after a short delay to let the server start."""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not open browser: %s", exc)

    t = threading.Thread(target=_open, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    org_a_path, org_b_path = validate_paths(args.org_a, args.org_b)

    logger.info("=" * 60)
    logger.info("  LWC Org Diff")
    logger.info("  Org A : %s", org_a_path)
    logger.info("  Org B : %s", org_b_path)
    logger.info("=" * 60)

    diff_index = DiffIndex(str(org_a_path), str(org_b_path), build_immediately=False)
    logger.info("Building diff index in the background …")
    build_index_in_background(diff_index)

    app = create_app(diff_index)

    url = f"http://{args.host}:{args.port}"
    logger.info("Starting server at %s", url)

    if not args.no_browser:
        open_browser_after_delay(url)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",  # suppress uvicorn noise; our logger covers the rest
    )


if __name__ == "__main__":
    main()
