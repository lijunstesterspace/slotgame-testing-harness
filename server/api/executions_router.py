from __future__ import annotations
import asyncio
import json
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from server.config import RUNS_DIR
from server.infra import cancellation
from server.infra.security import require_user
from server.main import shared
from server.infra.storage import StorageAsync

router = APIRouter(prefix="/api/executions", tags=["Executions"])


@router.get("/mine")
async def list_mine(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
                    user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    rows = await storage.list_executions(user_id=user["id"], page=page, size=size)
    return {"items": rows, "page": page, "size": size}


@router.get("/{eid}")
async def get_execution(eid: str, user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    row = await storage.get_execution(eid)
    if row is None or row["user_id"] != user["id"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="not_found")
    calls = await storage.list_tool_calls(eid)
    records = await storage.list_test_records(execution_id=eid, user_id=user["id"])
    return {"execution": row, "tool_calls": calls, "records": records}


@router.get("/stream/{eid}")
async def stream_execution(eid: str, request: Request, user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    row = await storage.get_execution(eid)
    if row is None or row["user_id"] != user["id"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="not_found")

    async def event_generator():
        # 1) replay historical tool calls
        calls = await storage.list_tool_calls(eid)
        for c in calls:
            params = c["params_json"]
            yield _sse("harness_event", {"type": "TOOL_CALL", "toolName": c["tool_name"],
                                         "content": params,
                                         "status": "running",
                                         "timestamp": _fmt(c["started_at"])})
            yield _sse("harness_event", {"type": "TOOL_RES", "toolName": c["tool_name"],
                                         "content": (c["error_message"] or c["result_snippet"] or ""),
                                         "status": "success" if c["success"] else "error",
                                         "timestamp": _fmt(c["started_at"] + c["execution_ms"])})
        # 2) subscribe to live events
        q: asyncio.Queue = asyncio.Queue()
        shared.sse_hub.subscribe(eid, q)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    yield _sse("ping", {"ts": _now_ts()})
                    continue
                if evt.get("__done"):
                    yield _sse("done", {k: v for k, v in evt.items() if not k.startswith("__")})
                    break
                yield _sse("harness_event", evt)
        finally:
            shared.sse_hub.unsubscribe(eid, q)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class LLMAuditReq(BaseModel):
    provider: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    duration_ms: int = 0
    success: bool = True


@router.post("/audit-llm")
async def audit_llm(req: LLMAuditReq, user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    await storage.insert_llm_audit(user_id=user["id"], provider=req.provider, model=req.model,
                                    tokens_in=req.tokens_in, tokens_out=req.tokens_out,
                                    duration_ms=req.duration_ms, success=req.success)
    return {"ok": True}


class NewExecutionReq(BaseModel):
    intent: str = ""
    workflow_stage: int = 1
    llm_provider: str | None = None
    llm_model: str | None = None


@router.post("/new")
async def new_execution(req: NewExecutionReq, user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    eid = await storage.new_execution(user_id=user["id"], intent=req.intent[:500],
                                      workflow_stage=int(req.workflow_stage),
                                      status="RUNNING",
                                      llm_provider=req.llm_provider, llm_model=req.llm_model)
    return {"execution_id": eid}


@router.post("/{eid}/cancel")
async def cancel_execution(eid: str, user=Depends(require_user())):
    """Stop a running execution. Only takes effect for tools that registered a cancel callback
    (see server/infra/cancellation.py) — the browser-driven tools' Selenium sessions.
    The execution's own exception handling (not this endpoint) is what finalizes its status once
    the cancelled call unwinds, so this only reports whether a cancellable task was found."""
    storage: StorageAsync = shared.storage
    row = await storage.get_execution(eid)
    if row is None or row["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="not_found")
    cancelled = cancellation.request_cancel(eid)
    return {"ok": cancelled}


@router.get("/runs/{execution_id}/{tool_name}/{filename:path}")
async def download_run_file(execution_id: str, tool_name: str, filename: str, user=Depends(require_user())):
    """Serve a file a Plugin wrote into its own work_dir (RUNS_DIR/<execution_id>/<tool_name>/...) —
    e.g. a verifier tool's standalone report.html, which previously had no download route at
    all and just sat on disk unreachable from the UI."""
    base = (RUNS_DIR / execution_id / tool_name).resolve()
    target = (base / filename).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_filename")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")
    return FileResponse(target, filename=target.name)


# ---- helpers ----
def _now_ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def _fmt(ts_ms: int) -> str:
    try:
        return datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M:%S")
    except Exception:
        return _now_ts()

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
