from __future__ import annotations
import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.config import settings
from server.infra.logger import log
from server.infra.storage import StorageAsync
from server.services.execution_queue import SerialExecutionQueue
from server.tools.base import ToolRegistry
from server.tools.impl import BUILTIN_TOOLS


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


@app.get("/")
async def index():
    return {"name": settings.app_name, "status": "ok",
            "docs": "/docs", "health": "/healthz"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server.main:app", host=settings.api_host, port=settings.api_port, reload=False)
