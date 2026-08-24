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
# 静态文件目录：Vite 构建产物位于 server/static（开发时可能不存在）
# ---------------------------------------------------------------------------
def _resolve_static_dir() -> Path | None:
    """返回前端构建产物目录，不存在则返回 None。"""
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
    # 开发 / 源码模式
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

# NOTE: routers 模块级执行 `from server.main import shared`，
# 必须在 shared 定义之后再导入，否则部分初始化的模块会导致 ImportError。
from server.api.auth_router import router as auth_router  # noqa: E402
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

app.include_router(auth_router)
app.include_router(tools_router)
app.include_router(executions_router)
app.include_router(records_router)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "app": settings.app_name, "ts": int(time.time() * 1000)}


@app.get("/api/status")
async def api_status():
    """API 状态接口（替代原 / 路由，避免与前端冲突）。"""
    return {"name": settings.app_name, "status": "ok",
            "docs": "/docs", "health": "/healthz"}


# ---------------------------------------------------------------------------
# 静态文件托管：使用 FileResponse（兼容 PyInstaller 打包环境）
# ---------------------------------------------------------------------------
def _serve_static(file_path: Path) -> FileResponse | None:
    """安全地返回静态文件，防止路径遍历攻击。"""
    if STATIC_DIR is None:
        return None
    resolved = (STATIC_DIR / file_path).resolve()
    # 确保请求的文件在 STATIC_DIR 内
    if not str(resolved).startswith(str(STATIC_DIR.resolve())):
        return None
    if resolved.is_file():
        return FileResponse(resolved)
    return None


# 精确匹配前端构建产物中的文件
@app.get("/assets/{filename:path}")
async def _serve_assets(filename: str):
    """服务 Vite 构建的 JS/CSS 资源文件。"""
    resp = _serve_static(Path("assets") / filename)
    if resp:
        return resp
    return JSONResponse({"error": "not_found"}, status_code=404)


# SPA catch-all：所有未匹配的 GET 请求返回 index.html
@app.get("/{path:path}")
async def _spa_catch_all(path: str, request: Request):
    """SPA 路由 fallback：将前端路由请求返回 index.html。"""
    # 如果请求的是 API 或 docs，不拦截（FastAPI 会优先匹配具体路由）
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
