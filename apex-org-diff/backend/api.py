"""
api.py - FastAPI application factory and route definitions.

The DiffIndex singleton is injected at startup via app.state so that all
routes share the same in-memory index without global variables.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from starlette.middleware.base import BaseHTTPMiddleware

from backend.export import build_export_html
from backend.scanner import DiffIndex, normalise_key

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


def create_app(diff_index: DiffIndex) -> FastAPI:
    """
    Create and return the FastAPI application.

    Parameters
    ----------
    diff_index:
        Pre-built DiffIndex to attach to app.state.
    """
    app = FastAPI(
        title="Apex Diff",
        description="Compare Apex classes between two Salesforce org folders.",
        version="1.0.0",
    )

    # Attach the index to app state so routes can access it
    app.state.diff_index = diff_index

    # This is a short-lived local dev server whose frontend assets can change
    # between runs. Without an explicit Cache-Control, browsers may keep
    # serving a stale cached app.js/styles.css after a restart, silently
    # running old code against the new backend.
    async def _no_cache_static(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    app.add_middleware(BaseHTTPMiddleware, dispatch=_no_cache_static)

    # The index may still be scanning in the background for a large org (see
    # apex_diff.py, which starts uvicorn before DiffIndex.build() finishes so
    # a slow scan doesn't delay the server from accepting connections at
    # all). Until it's ready, fail API calls with a 503 the frontend can
    # recognise and retry, rather than 404s/500s from partially-populated
    # state. The static app shell and index.html are unaffected, so the page
    # itself still loads immediately.
    async def _readiness_gate(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            index: DiffIndex = request.app.state.diff_index
            if not index.is_ready():
                return JSONResponse(
                    status_code=503,
                    content={
                        "status": "building",
                        "detail": "Index is still being built. Try again shortly.",
                    },
                )
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=_readiness_gate)

    # ------------------------------------------------------------------
    # API routes
    # ------------------------------------------------------------------

    @app.get("/api/summary")
    async def get_summary(request: Request) -> JSONResponse:
        """Return a high-level summary of the diff."""
        index: DiffIndex = request.app.state.diff_index
        return JSONResponse(content=index.get_summary())

    @app.get("/api/classes")
    async def get_classes(request: Request) -> JSONResponse:
        """
        Return metadata for all Apex classes (no content).

        Optional query params:
          - status: filter by status (modified|identical|only_in_org_a|only_in_org_b)
          - q: search class name (case-insensitive substring)
        """
        index: DiffIndex = request.app.state.diff_index
        status_filter: Optional[str] = request.query_params.get("status")
        search: Optional[str] = request.query_params.get("q", "").strip().lower()

        all_meta = index.get_all_meta()

        if status_filter:
            all_meta = [m for m in all_meta if m["status"] == status_filter]

        if search:
            all_meta = [m for m in all_meta if search in m["name"].lower()]

        return JSONResponse(content=all_meta)

    @app.get("/api/classes/{class_name:path}/export")
    async def export_class_diff(class_name: str, request: Request) -> Response:
        """
        Return a self-contained HTML diff report for one class as a real
        file download (Content-Disposition: attachment).

        Rendered server-side and returned as a normal HTTP response so the
        browser's download handling is used — this is more reliable than a
        client-side Blob + synthetic-click download, which can lose the
        filename/extension for HTML content in some browsers.
        """
        index: DiffIndex = request.app.state.diff_index

        if ".." in class_name or "/" in class_name or "\\" in class_name:
            raise HTTPException(
                status_code=400,
                detail="Invalid class name. Must be a plain filename without path separators.",
            )

        detail = index.get_class_detail(class_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"Apex class '{class_name}' not found in either org.",
            )

        html = build_export_html(detail, index.org_a_path, index.org_b_path)

        safe_name = re.sub(r'[\\/:*?"<>|]', "_", detail["name"])
        safe_name = re.sub(r"(?i)\.cls$", "", safe_name)
        filename = f"apex-diff-{safe_name}.html"

        return Response(
            content=html,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/classes/{class_name:path}")
    async def get_class_detail(class_name: str, request: Request) -> JSONResponse:
        """
        Return full detail (including content) for a specific class.

        Path parameter is URL-encoded; FastAPI decodes automatically.
        Uses case-insensitive lookup.
        """
        index: DiffIndex = request.app.state.diff_index

        # Safety: reject path traversal attempts
        if ".." in class_name or "/" in class_name or "\\" in class_name:
            raise HTTPException(
                status_code=400,
                detail="Invalid class name. Must be a plain filename without path separators.",
            )

        detail = index.get_class_detail(class_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"Apex class '{class_name}' not found in either org.",
            )
        return JSONResponse(content=detail)

    # ------------------------------------------------------------------
    # Static frontend routes
    # ------------------------------------------------------------------

    # Serve static assets (app.js, styles.css) from /static
    if FRONTEND_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def serve_index() -> FileResponse:
        """Serve the main SPA index page."""
        index_path = FRONTEND_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="Frontend not found.")
        return FileResponse(str(index_path))

    # Catch-all for SPA client-side navigation (if any)
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # Don't interfere with /api/* (already handled above)
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index_path = FRONTEND_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="Frontend not found.")
        return FileResponse(str(index_path))

    return app
