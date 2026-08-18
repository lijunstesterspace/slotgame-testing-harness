from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from server.config import ARTIFACTS_DIR
from server.infra.security import require_user
from server.infra.storage import StorageAsync
from server.main import shared

router = APIRouter(prefix="/api/records", tags=["Records"])


@router.get("/mine")
async def list_records(eid: str | None = Query(default=None),
                       user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    return {"items": await storage.list_test_records(execution_id=eid, user_id=user["id"])}


@router.post("/save-batch")
async def save_batch(records: list[dict], user=Depends(require_user())):
    storage: StorageAsync = shared.storage
    # enrich user_id if not set
    for r in records:
        r.setdefault("user_id", user["id"])
    await storage.insert_test_records(records)
    return {"ok": True, "count": len(records)}


@router.get("/{rid}/outcome.zip")
async def download_zip(rid: str, user=Depends(require_user())):
    """Try to find a zip matching execution_id -> artifacts; else fall back to build one on the fly."""
    storage: StorageAsync = shared.storage
    rows = await storage.list_test_records(execution_id=rid, user_id=user["id"])
    if not rows:
        # maybe rid is record id
        rows = await storage.list_test_records(user_id=user["id"])
        rows = [r for r in rows if r["id"] == rid or r.get("execution_id") == rid]
    if not rows:
        raise HTTPException(status_code=404, detail="records_not_found")
    # build fresh zip via ZipPackagerTool directly
    from server.tools.base import HarnessContext
    from server.tools.impl.zip_packager_tool import ZipPackagerTool
    from server.tools.impl.testdata_generator_tool import _write_xml
    from server.config import RUNS_DIR
    eid = rows[0].get("execution_id") or rid
    work_dir = RUNS_DIR / eid / "ondemand"
    work_dir.mkdir(parents=True, exist_ok=True)
    module_id = str(rows[0].get("module_id") or "105359")
    login_name = ""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r.get("file_name") or "generated.testdata", []).append(r)
    files = []
    for fn, recs in groups.items():
        files.append(_write_xml(recs, str(work_dir / fn), module_id, login_name))
    ctx = HarnessContext(execution_id=eid, user_id=user["id"], user_role=user["role"],
                         session_token=user["token"], work_dir=str(work_dir))
    zt = ZipPackagerTool()
    result = await zt.execute({"source_files": files, "login_name": login_name, "module_id": module_id}, ctx)
    if not result.success or not result.artifacts:
        raise HTTPException(status_code=500, detail=(result.error or "zip_build_failed"))
    return FileResponse(result.artifacts[0], filename=Path(result.artifacts[0]).name,
                        media_type="application/zip")


@router.get("/artifacts/{filename}")
async def download_artifact(filename: str, user=Depends(require_user())):
    """Only allow files in ARTIFACTS_DIR directory."""
    p = (ARTIFACTS_DIR / filename).resolve()
    try:
        p.relative_to(ARTIFACTS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_filename")
    if not p.exists():
        raise HTTPException(status_code=404, detail="file_not_found")
    return FileResponse(p)
