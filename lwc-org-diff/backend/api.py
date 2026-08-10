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
from backend.scanner import DiffIndex

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
        title="LWC Diff",
        description="Compare Lightning Web Components between two Salesforce org folders.",
        version="1.0.0",
    )

    app.state.diff_index = diff_index

    # Short-lived local dev server whose frontend assets can change between
    # runs; without this, browsers may keep serving a stale cached
    # app.js/styles.css after a restart.
    async def _no_cache_static(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    app.add_middleware(BaseHTTPMiddleware, dispatch=_no_cache_static)

    # The index may still be scanning in the background for a large org
    # (lwc_diff.py starts uvicorn before DiffIndex.build() finishes). Until
    # ready, fail API calls with a 503 the frontend can recognise and retry.
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

    @app.get("/api/components")
    async def get_components(request: Request) -> JSONResponse:
        """
        Return metadata for all LWC components (per-file status list
        included, but no file content).

        Optional query params:
          - status: filter by status (modified|identical|only_in_org_a|only_in_org_b)
          - q: search component name (case-insensitive substring)
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

    @app.get("/api/components/{component_name:path}/export")
    async def export_component_diff(component_name: str, request: Request) -> Response:
        """
        Return a self-contained HTML diff report for one component (every
        bundle file) as a real file download (Content-Disposition: attachment).
        """
        index: DiffIndex = request.app.state.diff_index

        if ".." in component_name or "/" in component_name or "\\" in component_name:
            raise HTTPException(
                status_code=400,
                detail="Invalid component name. Must be a plain folder name without path separators.",
            )

        detail = index.get_component_detail(component_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"LWC component '{component_name}' not found in either org.",
            )

        html = build_export_html(detail, index.org_a_path, index.org_b_path)

        safe_name = re.sub(r'[\\/:*?"<>|]', "_", detail["name"])
        filename = f"lwc-diff-{safe_name}.html"

        return Response(
            content=html,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/components/{component_name:path}")
    async def get_component_detail(component_name: str, request: Request) -> JSONResponse:
        """
        Return full detail (every bundle file, both orgs' content) for a
        specific component. Case-insensitive.
        """
        index: DiffIndex = request.app.state.diff_index

        if ".." in component_name or "/" in component_name or "\\" in component_name:
            raise HTTPException(
                status_code=400,
                detail="Invalid component name. Must be a plain folder name without path separators.",
            )

        detail = index.get_component_detail(component_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"LWC component '{component_name}' not found in either org.",
            )
        return JSONResponse(content=detail)

    # ------------------------------------------------------------------
    # Static frontend routes
    # ------------------------------------------------------------------

    if FRONTEND_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def serve_index() -> FileResponse:
        """Serve the main SPA index page."""
        index_path = FRONTEND_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="Frontend not found.")
        return FileResponse(str(index_path))

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index_path = FRONTEND_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="Frontend not found.")
        return FileResponse(str(index_path))

    return app
