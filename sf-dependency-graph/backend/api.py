"""
api.py - FastAPI application factory and route definitions.

The DependencyGraph singleton is injected at startup via app.state, same
pattern as apex-org-diff/lwc-org-diff's DiffIndex.
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

from backend.export import build_export_html, build_full_export_html
from backend.graph_builder import DependencyGraph

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


def create_app(graph: DependencyGraph) -> FastAPI:
    app = FastAPI(
        title="SF Dependency Graph",
        description="Blast-radius / dependency graph for Apex classes and LWC components in one org folder.",
        version="1.0.0",
    )

    app.state.graph = graph

    async def _no_cache_static(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    app.add_middleware(BaseHTTPMiddleware, dispatch=_no_cache_static)

    # The graph may still be building for a large org (entry point starts
    # uvicorn before DependencyGraph.build() finishes). Until ready, fail API
    # calls with a 503 the frontend can recognise and retry.
    async def _readiness_gate(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            g: DependencyGraph = request.app.state.graph
            if not g.is_ready():
                return JSONResponse(
                    status_code=503,
                    content={
                        "status": "building",
                        "detail": "Graph is still being built. Try again shortly.",
                    },
                )
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=_readiness_gate)

    def _validate_name(name: str) -> None:
        if ".." in name or "/" in name or "\\" in name:
            raise HTTPException(
                status_code=400,
                detail="Invalid node name. Must be a plain class/component name without path separators.",
            )

    def _reject_if_ambiguous(g: DependencyGraph, name: str) -> None:
        """An Apex type and an LWC component can share a display name (e.g.
        class 'AccountCard' + LWC 'accountCard'); resolve_id() treats that
        as unresolvable rather than silently guessing one. Surface it here
        as a distinct error instead of letting it fall through to a
        misleading 404, and tell the caller how to disambiguate."""
        matches = g.resolve_name_matches(name)
        if len(matches) > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"'{name}' matches more than one node: {', '.join(matches)}. "
                    "Use one of these qualified ids in place of the bare name."
                ),
            )

    # ------------------------------------------------------------------
    # API routes
    # ------------------------------------------------------------------

    @app.get("/api/summary")
    async def get_summary(request: Request) -> JSONResponse:
        g: DependencyGraph = request.app.state.graph
        return JSONResponse(content=g.get_summary())

    @app.get("/api/graph")
    async def get_graph(request: Request) -> JSONResponse:
        """
        Full node + edge list.

        Optional query params:
          - types: comma-separated node types to include
                   (apex_class|apex_interface|apex_trigger|lwc_component)
          - q: search node name (case-insensitive substring)
        """
        g: DependencyGraph = request.app.state.graph
        types_param: Optional[str] = request.query_params.get("types")
        types = [t.strip() for t in types_param.split(",") if t.strip()] if types_param else None
        search: Optional[str] = request.query_params.get("q", "").strip() or None
        return JSONResponse(content=g.get_graph(types=types, search=search))

    @app.get("/api/nodes/{name}/blast-radius")
    async def get_blast_radius(name: str, request: Request) -> JSONResponse:
        """
        Induced subgraph around one node.

        Optional query params:
          - depth: hop count (int) or "all" for the whole connected component (default 2)
          - direction: both|upstream|downstream (default both)
        """
        _validate_name(name)
        g: DependencyGraph = request.app.state.graph
        _reject_if_ambiguous(g, name)

        depth_param = request.query_params.get("depth", "2")
        depth: Optional[int] = None if depth_param.lower() == "all" else int(depth_param)
        direction = request.query_params.get("direction", "both")
        if direction not in ("both", "upstream", "downstream"):
            raise HTTPException(status_code=400, detail="direction must be one of: both, upstream, downstream")

        result = g.blast_radius(name, depth=depth, direction=direction)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node '{name}' not found.")
        return JSONResponse(content=result)

    @app.get("/api/nodes/{name}/export")
    async def export_node(name: str, request: Request) -> Response:
        """Standalone HTML export of one node's blast radius (2-hop, both
        directions) as a real file download."""
        _validate_name(name)
        g: DependencyGraph = request.app.state.graph
        _reject_if_ambiguous(g, name)
        result = g.blast_radius(name, depth=2, direction="both", occurrence_limit=None)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node '{name}' not found.")

        html = build_export_html(result, g.org_path)
        safe_name = re.sub(r'[\\/:*?"<>|]', "_", name)
        filename = f"blast-radius-{safe_name}.html"
        return Response(
            content=html, media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/nodes/{name}")
    async def get_node_detail(name: str, request: Request) -> JSONResponse:
        _validate_name(name)
        g: DependencyGraph = request.app.state.graph
        _reject_if_ambiguous(g, name)
        detail = g.get_node_detail(name)
        if detail is None:
            raise HTTPException(status_code=404, detail=f"Node '{name}' not found.")
        return JSONResponse(content=detail)

    @app.get("/api/edges/{source}/{target}")
    async def get_edge_detail(source: str, target: str, request: Request) -> JSONResponse:
        _validate_name(source)
        _validate_name(target)
        g: DependencyGraph = request.app.state.graph
        _reject_if_ambiguous(g, source)
        _reject_if_ambiguous(g, target)
        detail = g.get_edge_detail(source, target)
        if detail is None:
            raise HTTPException(status_code=404, detail=f"No edge from '{source}' to '{target}'.")
        return JSONResponse(content=detail)

    @app.get("/api/export")
    async def export_full_graph(request: Request) -> Response:
        """Standalone HTML export of the entire graph - opens directly with
        no server running, same trick as the sibling tools' full export."""
        g: DependencyGraph = request.app.state.graph
        html = build_full_export_html(g.get_summary(), g.get_graph())
        return Response(
            content=html, media_type="text/html",
            headers={"Content-Disposition": 'attachment; filename="DependencyGraphOutput.html"'},
        )

    # ------------------------------------------------------------------
    # Static frontend routes
    # ------------------------------------------------------------------

    if FRONTEND_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def serve_index() -> FileResponse:
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
