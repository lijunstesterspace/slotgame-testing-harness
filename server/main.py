from __future__ import annotations
import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from server.config import settings
from server.infra.logger import log
from server.infra.storage import StorageAsync
from server.services.execution_queue import SerialExecutionQueue
from server.tools.base import ToolRegistry
from server.tools.impl import BUILTIN_TOOLS


# ---------------------------------------------------------------------------
# Static file directory: Vite build output lives in server/static (may not exist during development)
# ---------------------------------------------------------------------------
def _resolve_static_dir() -> Path | None:
    """Return the frontend build output directory, or None if it does not exist."""
    import sys
    if getattr(sys, 'frozen', False):
        meipass = Path(sys._MEIPASS)
        candidates = [
            meipass / "server" / "static",
            meipass / "static",
            meipass,
        ]
        for c in candidates:
            if c.is_dir() and (c / "index.html").exists():
                return c
    # Development / source mode
    src = Path(__file__).resolve().parent / "static"
    if src.is_dir() and (src / "index.html").exists():
        return src
    return None


STATIC_DIR = _resolve_static_dir()


# ---- SSE Hub (in-memory pub/sub for live execution events) --------
class SSEHub:
    def __init__(self):
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, execution_id: str, q: asyncio.Queue):
        self._subs.setdefault(execution_id, set()).add(q)

    def unsubscribe(self, execution_id: str, q: asyncio.Queue):
        s = self._subs.get(execution_id)
        if s:
            s.discard(q)
            if not s:
                self._subs.pop(execution_id, None)

    async def publish(self, execution_id: str, evt: dict):
        subs = self._subs.get(execution_id, set())
        for q in list(subs):
            try:
                q.put_nowait(evt)
            except Exception:
                pass

    async def publish_done(self, execution_id: str, success: bool, total_ms: int):
        await self.publish(execution_id, {"__done": True, "success": success,
                                           "execution_id": execution_id,
                                           "total_ms": total_ms,
                                           "timestamp": __import__("datetime").datetime.now().strftime("%H:%M:%S")})


@dataclass
class SharedDeps:
    storage: StorageAsync = field(default_factory=StorageAsync.singleton)
    tool_registry: ToolRegistry = field(default_factory=ToolRegistry)
    execution_queue: SerialExecutionQueue | None = None
    sse_hub: SSEHub = field(default_factory=SSEHub)

    def bootstrap_tools(self):
        for t in BUILTIN_TOOLS:
            self.tool_registry.register(t)
        log.info("harness.tools_registered", count=len(BUILTIN_TOOLS),
                 names=[t.info.name for t in BUILTIN_TOOLS])
        self.execution_queue = SerialExecutionQueue(self.tool_registry, self.storage)


shared = SharedDeps()

# NOTE: routers run `from server.main import shared` at module level,
# so they must be imported after shared is defined, otherwise the partially initialized module causes ImportError.
from server.api.tools_router import router as tools_router  # noqa: E402
from server.api.executions_router import router as executions_router  # noqa: E402
from server.api.records_router import router as records_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    t0 = time.perf_counter()
    await shared.storage.init_db()
    shared.bootstrap_tools()
    log.info("harness.started", port=settings.api_port, host=settings.api_host,
             duration_ms=int((time.perf_counter() - t0) * 1000))
    try:
        yield
    finally:
        log.info("harness.shutdown")


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tools_router)
app.include_router(executions_router)
app.include_router(records_router)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "app": settings.app_name, "ts": int(time.time() * 1000)}


@app.get("/api/status")
async def api_status():
    """API status endpoint (replaces the original / route to avoid conflicting with the frontend)."""
    return {"name": settings.app_name, "status": "ok",
            "docs": "/docs", "health": "/healthz"}


# ---------------------------------------------------------------------------
# Static file hosting: uses FileResponse (compatible with the PyInstaller packaged environment)
# ---------------------------------------------------------------------------
def _serve_static(file_path: Path) -> FileResponse | None:
    """Safely return a static file, preventing path traversal attacks."""
    if STATIC_DIR is None:
        return None
    resolved = (STATIC_DIR / file_path).resolve()
    # Ensure the requested file is inside STATIC_DIR
    if not str(resolved).startswith(str(STATIC_DIR.resolve())):
        return None
    if resolved.is_file():
        return FileResponse(resolved)
    return None


# Exact match for files in the frontend build output
@app.get("/assets/{filename:path}")
async def _serve_assets(filename: str):
    """Serve JS/CSS asset files built by Vite."""
    resp = _serve_static(Path("assets") / filename)
    if resp:
        return resp
    return JSONResponse({"error": "not_found"}, status_code=404)


# SPA catch-all: all unmatched GET requests return index.html
@app.get("/{path:path}")
async def _spa_catch_all(path: str, request: Request):
    """SPA route fallback: return index.html for frontend route requests."""
    # Do not intercept API or docs requests (FastAPI matches specific routes first)
    if path.startswith("api/") or path.startswith("docs") or path.startswith("openapi"):
        return JSONResponse({"error": "not_found"}, status_code=404)
    if STATIC_DIR is not None:
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
    return JSONResponse({"error": "frontend_not_built", "hint": "Run 'npm run build'"}, status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server.main:app", host=settings.api_host, port=settings.api_port, reload=False)
