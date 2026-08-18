from __future__ import annotations
import asyncio
import json
import time
from pathlib import Path
from typing import Any, Callable

from server.config import RUNS_DIR, settings
from server.infra.logger import log
from server.infra.storage import StorageAsync
from server.tools.base import ToolRegistry, ToolResult, HarnessContext


class ExecutionQueue:
    async def submit(self, *, execution_id: str, tool_name: str, params: dict,
                     context: HarnessContext,
                     on_event: Callable[[dict], None] | None = None) -> ToolResult:
        raise NotImplementedError


class SerialExecutionQueue(ExecutionQueue):
    """A 级起步：串行执行，每个 execution 一个 asyncio.Lock per user，避免 Selenium Chrome 冲突。
    接口和 Parallel 一致，未来换 RedisParallelQueue 不影响调用方。"""

    def __init__(self, tool_registry: ToolRegistry, storage: StorageAsync | None = None):
        self._registry = tool_registry
        self._storage = storage or StorageAsync.singleton()
        self._user_locks: dict[str, asyncio.Lock] = {}

    async def submit(self, *, execution_id: str, tool_name: str, params: dict,
                     context: HarnessContext,
                     on_event: Callable[[dict], None] | None = None) -> ToolResult:
        user_lock = self._user_locks.setdefault(context.user_id, asyncio.Lock())
        async with user_lock:
            t0 = time.perf_counter()
            work_dir = RUNS_DIR / execution_id / tool_name
            work_dir.mkdir(parents=True, exist_ok=True)
            ctx = HarnessContext(execution_id=execution_id, user_id=context.user_id,
                                 user_role=context.user_role, session_token=context.session_token,
                                 work_dir=str(work_dir.resolve()))

            plugin = self._registry.get(tool_name)
            tc_id = await self._storage.new_tool_call(execution_id=execution_id, tool_name=tool_name, params=params)

            if on_event:
                await _emit(on_event, {"type": "TOOL_CALL", "toolName": tool_name,
                                       "content": json.dumps(params, ensure_ascii=False),
                                       "status": "running", "timestamp": _ts()})

            result = await plugin.execute(params, ctx)

            snippet: str | None = None
            if isinstance(result.content, (dict, list)):
                try:
                    snippet = json.dumps(result.content, ensure_ascii=False)[:2000]
                except Exception:
                    snippet = str(result.content)[:2000]
            elif result.content is not None:
                snippet = str(result.content)[:2000]

            await self._storage.complete_tool_call(
                tc_id, success=result.success, result_snippet=snippet,
                artifacts=result.artifacts, execution_ms=result.execution_ms,
                error_message=result.error,
            )

            if on_event:
                await _emit(on_event, {"type": "TOOL_RES", "toolName": tool_name,
                                       "content": (result.error or snippet or ""),
                                       "status": "success" if result.success else "error",
                                       "timestamp": _ts()})

            total_ms = int((time.perf_counter() - t0) * 1000)
            log.info("exec.tool_complete", tool=tool_name, ok=result.success, ms=total_ms, eid=execution_id)
            return result


async def _emit(on_event: Callable[[dict], Any], evt: dict) -> None:
    """on_event 允许是同步函数或 async 函数（tools_router 传入 async 回调）。"""
    ret = on_event(evt)
    if asyncio.iscoroutine(ret):
        await ret


def _ts() -> str:
    return __import__("datetime").datetime.now().strftime("%H:%M:%S")
