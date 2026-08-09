#!/usr/bin/env python3
"""
apex_diff.py - Entry point for the Apex Org Diff tool.

Usage:
    python apex_diff.py <org_a_folder> <org_b_folder> [options]

Options:
    --port PORT     Port to listen on (default: 8000)
    --host HOST     Host to bind to (default: 127.0.0.1)
    --no-browser    Do not open the browser automatically
    --help          Show this help message and exit

Example:
    python apex_diff.py ./org1 ./org2
    python apex_diff.py ./org1 ./org2 --port 9000 --no-browser
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
logger = logging.getLogger("apex_diff")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="apex_diff",
        description=(
            "Apex Org Diff — compare Apex classes between two Salesforce org folders\n"
            "and display differences in a Monaco Editor diff viewer."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python apex_diff.py ./org1 ./org2
  python apex_diff.py /path/to/prod/classes /path/to/sandbox/classes --port 9000
  python apex_diff.py ./org1 ./org2 --no-browser
        """,
    )
    parser.add_argument(
        "org_a",
        metavar="ORG_A_FOLDER",
        help="Path to the folder containing Apex classes from Org A.",
    )
    parser.add_argument(
        "org_b",
        metavar="ORG_B_FOLDER",
        help="Path to the folder containing Apex classes from Org B.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        metavar="PORT",
        help="Port to run the local web server on (default: 8000).",
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
    bypassing HTTP and the browser entirely.

    This exists purely to tell apart two failure modes that look identical
    from the browser: if ApexDiffOutput.html shows up in the project root and
    looks correct, the exporter itself is fine and the problem is downstream
    (browser download handling, antivirus renaming the file, etc.). If it's
    missing or malformed, the bug is in build_full_export_html / the scan
    itself.
    """
    all_meta = diff_index.get_all_meta()
    if not all_meta:
        return

    details = [
        detail
        for meta in all_meta
        if (detail := diff_index.get_class_detail(meta["name"])) is not None
    ]

    html = build_full_export_html(diff_index.get_summary(), all_meta, details)
    debug_path = PROJECT_ROOT / "ApexDiffOutput.html"
    debug_path.write_text(html, encoding="utf-8")
    logger.info(
        "Wrote a full comparison report (%d classes) to %s — open it directly "
        "(double-click, no browser download involved) to confirm the exporter "
        "itself works.",
        len(details),
        debug_path,
    )


def build_index_in_background(diff_index: DiffIndex) -> None:
    """
    Run the (potentially slow) index scan off the startup critical path.

    diff_index is constructed with build_immediately=False, so this thread
    does the real work: scan both org folders, then log the same summary
    main() used to log synchronously, then write the debug export (which
    needs the finished index). Running all of this in the background lets
    uvicorn start accepting connections immediately — for a large org the
    scan can take a while, and there's no reason that should delay the
    server from coming up or the browser tab from opening; API routes
    return 503 (see backend.api._readiness_gate) until diff_index.is_ready().
    """
    def _run():
        diff_index.build()

        summary = diff_index.summary
        logger.info("─" * 60)
        logger.info("  Total classes : %d", summary.total)
        logger.info("  Modified      : %d", summary.modified)
        logger.info("  Identical     : %d", summary.identical)
        logger.info("  Only in Org A : %d", summary.only_in_org_a)
        logger.info("  Only in Org B : %d", summary.only_in_org_b)
        logger.info("─" * 60)
        logger.info("Index ready — API requests will now be served.")

        try:
            write_debug_export(diff_index)
        except Exception:
            logger.exception("Failed to write ApexDiffOutput.html")

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
    logger.info("  Apex Org Diff")
    logger.info("  Org A : %s", org_a_path)
    logger.info("  Org B : %s", org_b_path)
    logger.info("=" * 60)

    # Index is scanned on a background thread (build_index_in_background)
    # so a large org doesn't delay uvicorn from accepting connections; API
    # routes 503 until it's done (backend.api._readiness_gate).
    diff_index = DiffIndex(str(org_a_path), str(org_b_path), build_immediately=False)
    logger.info("Building diff index in the background …")
    build_index_in_background(diff_index)

    # Create the FastAPI app
    app = create_app(diff_index)

    url = f"http://{args.host}:{args.port}"
    logger.info("Starting server at %s", url)

    if not args.no_browser:
        open_browser_after_delay(url)

    # Run uvicorn (blocking)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",  # suppress uvicorn noise; our logger covers the rest
    )


if __name__ == "__main__":
    main()
