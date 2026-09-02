from __future__ import annotations
import asyncio
import os
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from server.infra.security import require_user
from server.main import shared  # type: ignore # will be defined below

router = APIRouter(prefix="/api/tools", tags=["Tools"])

# ── Scenario → required plugins mapping (mirrors frontend intentRouter.ts) ──
SCENARIO_PLUGINS: dict[str, list[str]] = {
    "testdata_generation": ["testdata_parser", "testdata_generator", "zip_packager"],
    "game_verification": ["testdata_verifier", "log_diagnoser"],
    "log_diagnosis": ["log_diagnoser"],
    "easyhelp_checking": ["html_to_text_converter", "diff_comparator", "helpfile_analyzer"],
}


class ExecuteReq(BaseModel):
    tool_name: str
    params: dict


class ExecuteAsyncReq(BaseModel):
    tool_name: str
    params: dict
    execution_id: str | None = None


class ScanTestdataReq(BaseModel):
    folder_path: str


@router.get("/list")
async def list_tools(
    scenario_id: str | None = Query(None, description="Filter tools by scenario's requiredPlugins"),
    user=Depends(require_user()),
):
    registry = shared.tool_registry
    all_tools = registry.list_info()
    all_schema = registry.as_function_calling_schema()

    # Filter by scenario if specified
    if scenario_id and scenario_id in SCENARIO_PLUGINS:
        allowed = set(SCENARIO_PLUGINS[scenario_id])
        all_tools = [t for t in all_tools if t.name in allowed]
        all_schema = [s for s in all_schema if s["function"]["name"] in allowed]

    return {"tools": [i.model_dump() for i in all_tools],
            "function_calling_schema": all_schema}


@router.post("/execute")
async def execute_sync(req: ExecuteReq, request: Request, user=Depends(require_user())):
    from server.tools.base import HarnessContext
    from server.infra.storage import StorageAsync
    storage = StorageAsync.singleton()
    eid = req.params.pop("__execution_id", None) or f"on_demand_{user['id']}_{int(__import__('time').time()*1000)}"
    await storage.update_execution_status if False else None
    # lightweight: create execution row for audit
    if not await storage.get_execution(eid):
        eid = await storage.new_execution(user_id=user["id"], intent=f"tool_direct:{req.tool_name}",
                                           workflow_stage=0, status="RUNNING",
                                           llm_provider=None, llm_model=None)
    ctx = HarnessContext(execution_id=eid, user_id=user["id"], user_role=user["role"],
                         session_token=user["token"], work_dir="")
    queue = shared.execution_queue
    try:
        res = await asyncio.wait_for(
            queue.submit(execution_id=eid, tool_name=req.tool_name, params=req.params, context=ctx),
            timeout=30,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="tool_timeout_use_execute_async_instead")
    await storage.update_execution_status(eid, "SUCCESS" if res.success else "FAILED",
                                          finished_at=int(__import__("time").time()*1000),
                                          total_ms=res.execution_ms, error_message=res.error)
    return res.model_dump()


@router.post("/execute-async")
async def execute_async(req: ExecuteAsyncReq, request: Request, user=Depends(require_user())):
    """Long-running tool dispatcher: immediately returns execution_id and runs in background task.
    Stream progress via GET /api/executions/stream/{execution_id} (handled in executions_router via shared SSE hub)."""
    from server.tools.base import HarnessContext
    storage = shared.storage
    eid = req.execution_id or await storage.new_execution(
        user_id=user["id"], intent=f"async_tool:{req.tool_name}", workflow_stage=0,
        status="PENDING", llm_provider=None, llm_model=None)
    if not await storage.get_execution(eid):
        # execution_id given but not exists → create
        eid2 = await storage.new_execution(user_id=user["id"], intent=f"async_tool:{req.tool_name}",
                                           workflow_stage=0, status="PENDING",
                                           llm_provider=None, llm_model=None)
        eid = eid2
    await storage.update_execution_status(eid, "RUNNING")
    ctx = HarnessContext(execution_id=eid, user_id=user["id"], user_role=user["role"],
                         session_token=user["token"], work_dir="")
    hub = shared.sse_hub

    async def _bg():
        async def _evt(evt):
            await hub.publish(eid, evt)
        try:
            res = await shared.execution_queue.submit(
                execution_id=eid, tool_name=req.tool_name, params=req.params,
                context=ctx, on_event=_evt)
            await hub.publish(eid, {"type": "HARNESS_EVENT", "content": f"Tool completed success={res.success}",
                                    "status": "success" if res.success else "error",
                                    "timestamp": __import__("datetime").datetime.now().strftime("%H:%M:%S")})
            await storage.update_execution_status(eid, "SUCCESS" if res.success else "FAILED",
                                                  finished_at=int(__import__("time").time()*1000),
                                                  total_ms=res.execution_ms, error_message=res.error)
            await hub.publish_done(eid, success=res.success, total_ms=res.execution_ms)
        except Exception as e:
            await storage.update_execution_status(eid, "FAILED", error_message=str(e))
            await hub.publish_done(eid, success=False, total_ms=0)

    asyncio.create_task(_bg())
    return {"ok": True, "execution_id": eid}


@router.post("/scan-testdata")
async def scan_testdata_files(req: ScanTestdataReq, user=Depends(require_user())):
    """Scan a folder for .testdata XML files and return their paths + basic info."""
    folder = Path(req.folder_path)
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Folder not found: {req.folder_path}")

    files = []
    for f in sorted(folder.glob("*.testdata")):
        stat = f.stat()
        files.append({
            "name": f.name,
            "path": str(f.resolve()),
            "size_kb": round(stat.st_size / 1024, 1),
            "modified": stat.st_mtime,
        })
    return {"folder": str(folder.resolve()), "count": len(files), "files": files}


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------

def _resolve_skills_dir() -> Path:
    """Return the project-level skills/ directory."""
    import sys
    if getattr(sys, 'frozen', False):
        # PyInstaller exe: skills/ is external, next to the exe
        return Path(sys.executable).parent / "skills"
    else:
        # Development: server/api/tools_router.py → project root is 3 levels up
        return Path(__file__).resolve().parent.parent.parent / "skills"


def _parse_skill_frontmatter(text: str) -> dict:
    """Extract title and first heading/description from a skill markdown file."""
    title = ""
    description = ""
    # Try to get title from "# SKILL: ..." or first "# ..." heading
    m = re.search(r"^#\s*SKILL:\s*(.+)$", text, re.MULTILINE)
    if m:
        title = m.group(1).strip()
    else:
        m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        if m:
            title = m.group(1).strip()
    # Get description from "## 1. 核心定位" or first paragraph after title
    m = re.search(r"##\s*\d+\.\s*核心定位\s*\n+(.+)", text)
    if m:
        description = m.group(1).strip()
    else:
        # Fallback: first non-empty line after title
        lines = text.split("\n")
        skip = True
        for line in lines:
            if skip and line.startswith("#"):
                skip = False
                continue
            if not skip and line.strip():
                description = line.strip()
                break
    return {"title": title, "description": description}


@router.get("/skills/list")
async def list_skills(user=Depends(require_user())):
    """List all skill markdown files in the skills/ directory."""
    skills_dir = _resolve_skills_dir()
    if not skills_dir.is_dir():
        return {"skills": []}

    skills = []
    for f in sorted(skills_dir.glob("*.md")):
        text = f.read_text(encoding="utf-8", errors="replace")
        info = _parse_skill_frontmatter(text)
        skills.append({
            "id": f.stem,
            "name": info["title"] or f.stem,
            "description": info["description"],
            "file": f.name,
            "size_kb": round(f.stat().st_size / 1024, 1),
        })
    return {"skills": skills}
