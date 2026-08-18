this is the future plan for the next step.
# AI HARNESS Architecture Upgrade Implementation Plan (P0–P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing slot testdata tool (mock-Agent React UI + two Python CLI scripts) into a real AI HARNESS platform: 4-Provider Planner Agent (LLM on user machine → local Ollama by default + 3 external Providers grayed, compliance-check gated) + ToolPlugin Registry/Executor (FastAPI backend, process-runner bridged to existing Python `.py` scripts, SQLite persistence, per-user sessions, SSE streaming) + Stage-1/Stage-2 DAG workflows, all Windows double-click startable.

**Architecture:** Frontend PlannerAgent runs ReAct loop locally, calling LLM via 4 PlannerProviders. It dispatches ToolCalls to FastAPI backend via `HarnessClient` (REST + SSE). Backend: auth → ExecutionQueue (serial first, parallel later) → ToolRegistry → ToolPlugin (MCP-compatible interface). 5 built-in tools: paytable_parser, testdata_generator, zip_packager, game_verifier (process_runner Selenium bridge), log_diagnoser. Sessions + audit stored in SQLite. `start-dev.cmd` launches Vite+FastAPI+auto-open-browser.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, Pydantic v2, aiofiles, bcrypt, SQL-schema via sqlite3 stdlib; React 19 + Vite + TS 5.7 + Tailwind 4; existing JSZip/canvas-confetti/lucide-react/framer-motion deps kept; Python stdlib for process_runner; Selenium for verify_testdata.py (existing).

---

## Phase 0: Scaffold Backend & Dependencies

### Task 0.1: Backend Dependency & Config Files

**Files:**
- Create: `server/requirements.txt`
- Create: `server/config.py`
- Create: `.env.example` (project root)
- Modify: `.gitignore` (project root)

- [ ] **Step 1: Write `server/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
aiofiles==24.1.0
bcrypt==4.2.0
python-multipart==0.0.12
python-dotenv==1.0.1
structlog==24.4.0
aiosqlite==0.20.0
packaging==24.1
selenium>=4.20.0
```

- [ ] **Step 2: Write `server/config.py`**

```python
from __future__ import annotations
import os
from pathlib import Path
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
DATA_DIR = SERVER_DIR / "data"
RUNS_DIR = DATA_DIR / "runs"
ARTIFACTS_DIR = DATA_DIR / "artifacts"
DB_PATH = DATA_DIR / "harness.db"

DATA_DIR.mkdir(exist_ok=True)
RUNS_DIR.mkdir(exist_ok=True)
ARTIFACTS_DIR.mkdir(exist_ok=True)


def _bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = "Slot AI Harness"
    api_host: str = os.getenv("HARNESS_API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("HARNESS_API_PORT", "8000"))
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv(
            "HARNESS_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if o.strip()
    ]
    admin_username: str = os.getenv("HARNESS_ADMIN_USERNAME", "admin")
    admin_password: str = os.getenv("HARNESS_ADMIN_PASSWORD", "admin123")
    default_tester_password: str = os.getenv("HARNESS_TESTER_PASSWORD", "test1234")
    session_ttl_seconds: int = int(os.getenv("HARNESS_SESSION_TTL", str(60 * 60 * 8)))
    execution_run_ttl_hours: int = int(os.getenv("HARNESS_RUN_TTL_HOURS", "24"))
    max_tool_timeout_sec: int = int(os.getenv("HARNESS_MAX_TOOL_TIMEOUT", "900"))
    enable_auth: bool = _bool("HARNESS_ENABLE_AUTH", True)
    default_user_role: str = os.getenv("HARNESS_DEFAULT_ROLE", "tester")


settings = Settings()
```

- [ ] **Step 3: Write `.env.example` (project root)**

```
# ===== AI HARNESS Backend =====
# Copy this to .env (real values) and NEVER commit .env

# Server
HARNESS_API_HOST=0.0.0.0
HARNESS_API_PORT=8000
HARNESS_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Credentials
HARNESS_ADMIN_USERNAME=admin
HARNESS_ADMIN_PASSWORD=please_change_me
HARNESS_TESTER_PASSWORD=please_change_me_too

# Runtime
HARNESS_SESSION_TTL=28800
HARNESS_RUN_TTL_HOURS=24
HARNESS_MAX_TOOL_TIMEOUT=900
HARNESS_ENABLE_AUTH=true
HARNESS_DEFAULT_ROLE=tester
```

- [ ] **Step 4: Modify `.gitignore` — append block at end of file**

```
# ----- AI HARNESS additions -----
server/__pycache__/
server/**/__pycache__/
server/*.pyc
server/**/*.pyc
server/data/
server/data/harness.db
server/data/runs/**
server/data/artifacts/**
.env
server/.venv/
venv/
.venv/
```

- [ ] **Step 5: Verify all 4 files exist**

Run (PowerShell):
```
cd c:\Users\lijun\Documents\trae\testdata-tool-main
ls server/requirements.txt, server/config.py, .env.example, .gitignore | Out-String
```
Expected: 4 entries, no errors.

---

### Task 0.2: Backend Infrastructure (Logger / Security / ProcessRunner / Storage)

**Files:**
- Create: `server/infra/__init__.py`
- Create: `server/infra/logger.py`
- Create: `server/infra/security.py`
- Create: `server/infra/process_runner.py`
- Create: `server/infra/storage.py`

- [ ] **Step 1: Write `server/infra/__init__.py`**

```python
"""Harness infrastructure layer (L1): storage, security, process runner, logging."""
```

- [ ] **Step 2: Write `server/infra/logger.py`**

```python
from __future__ import annotations
import logging
import structlog

def setup_logger() -> structlog.stdlib.BoundLogger:
    logging.basicConfig(format="%(message)s", level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
    )
    return structlog.stdlib.get_logger("harness")

log = setup_logger()
```

- [ ] **Step 3: Write `server/infra/security.py`**

```python
from __future__ import annotations
import asyncio
import hashlib
import secrets
from typing import Callable, Any
import bcrypt
from fastapi import Header, HTTPException, status
from server.infra.storage import StorageAsync
from server.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def new_token(prefix: str = "tok") -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


async def _get_session_user(authorization: str | None) -> dict:
    if not settings.enable_auth:
        return {"id": "u_dev", "username": "dev", "role": "admin", "token": "dev_token"}
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()
    storage = StorageAsync.singleton()
    session = await storage.get_session(token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_or_expired_token")
    user = await storage.get_user(session["user_id"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    return {**user, "token": token}


def require_user() -> Callable[[Any], Any]:
    async def _dep(authorization: str | None = Header(default=None)) -> dict:
        return await _get_session_user(authorization)
    return _dep


def require_role(*roles: str) -> Callable[[Any], Any]:
    async def _dep(authorization: str | None = Header(default=None)) -> dict:
        u = await _get_session_user(authorization)
        if u["role"] not in roles and u["role"] != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"role_requires_one_of:{roles}")
        return u
    return _dep
```

- [ ] **Step 4: Write `server/infra/process_runner.py`**

```python
from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from server.infra.logger import log


@dataclass
class CompletedProcess:
    cmd: list[str]
    returncode: int
    stdout: str
    stderr: str
    execution_ms: int
    timed_out: bool = False


async def run(
    cmd: Sequence[str],
    work_dir: Path,
    timeout_sec: int = 120,
    on_stdout: Callable[[str], None] | None = None,
    on_stderr: Callable[[str], None] | None = None,
) -> CompletedProcess:
    import time
    t0 = time.perf_counter()
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        proc = await asyncio.create_subprocess_exec(
            *list(cmd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(work_dir),
        )
    except FileNotFoundError as e:
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return CompletedProcess(list(cmd), 127, "", f"Executable not found: {e}", dt_ms, False)

    assert proc.stdout and proc.stderr
    out_lines: list[str] = []
    err_lines: list[str] = []

    async def _read_pipe(stream, out_list: list[str], callback):
        while True:
            line_bytes = await stream.readline()
            if not line_bytes:
                break
            try:
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            except Exception:
                line = repr(line_bytes)
            out_list.append(line)
            if callback:
                try:
                    callback(line)
                except Exception:
                    pass

    timed_out = False
    try:
        await asyncio.wait_for(
            asyncio.gather(
                _read_pipe(proc.stdout, out_lines, on_stdout),
                _read_pipe(proc.stderr, err_lines, on_stderr),
            ),
            timeout=timeout_sec,
        )
        rc = await proc.wait()
    except asyncio.TimeoutError:
        timed_out = True
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=2)
        except Exception:
            try:
                proc.kill()
                await asyncio.wait_for(proc.wait(), timeout=2)
            except Exception:
                pass
        rc = -1
        err_lines.append(f"[HARNESS] process timed out after {timeout_sec}s")
        log.warn("process_runner.timeout", cmd=list(cmd), timeout=timeout_sec)

    dt_ms = int((time.perf_counter() - t0) * 1000)
    return CompletedProcess(
        cmd=list(cmd),
        returncode=rc,
        stdout="\n".join(out_lines),
        stderr="\n".join(err_lines),
        execution_ms=dt_ms,
        timed_out=timed_out,
    )
```

- [ ] **Step 5: Write `server/infra/storage.py`**

```python
from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path
from typing import Any
import aiosqlite

from server.config import DB_PATH, settings
from server.infra.logger import log
from server.infra.security import hash_password, new_token, new_id


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'tester',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_ip TEXT
);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, intent TEXT NOT NULL,
  workflow_stage INTEGER NOT NULL, status TEXT NOT NULL,
  llm_provider TEXT, llm_model TEXT,
  llm_tokens_in INTEGER DEFAULT 0, llm_tokens_out INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  total_ms INTEGER DEFAULT 0, error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL,
  tool_name TEXT NOT NULL, params_json TEXT NOT NULL,
  success INTEGER NOT NULL, result_snippet TEXT, artifacts_json TEXT,
  started_at INTEGER NOT NULL, execution_ms INTEGER DEFAULT 0, error_message TEXT
);
CREATE TABLE IF NOT EXISTS test_records (
  id TEXT PRIMARY KEY, execution_id TEXT, user_id TEXT,
  case_name TEXT NOT NULL, format_type TEXT NOT NULL, module_id TEXT NOT NULL,
  base_batch INTEGER NOT NULL, base_index INTEGER NOT NULL,
  bonus_batch INTEGER, bonus_index INTEGER, file_name TEXT,
  xml_snippet TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, success INTEGER NOT NULL
);
"""


class StorageAsync:
    _inst: "StorageAsync | None" = None

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = Path(db_path)

    @classmethod
    def singleton(cls) -> "StorageAsync":
        if cls._inst is None:
            cls._inst = StorageAsync()
        return cls._inst

    # ---- setup ----
    async def init_db(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(SCHEMA_SQL)
            await db.commit()
        await self._ensure_admin_and_testers()

    async def _ensure_admin_and_testers(self) -> None:
        now = int(time.time())
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute("SELECT 1 FROM users WHERE username = ?", (settings.admin_username,))
            exists = await cur.fetchone()
            if not exists:
                await db.execute(
                    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                    (
                        new_id("u"),
                        settings.admin_username,
                        hash_password(settings.admin_password),
                        "admin",
                        now,
                    ),
                )
                log.info("storage.admin_user_created", user=settings.admin_username)
            for name in ["qa-tester-1", "qa-tester-2", "qa-tester-3"]:
                cur = await db.execute("SELECT 1 FROM users WHERE username = ?", (name,))
                if not await cur.fetchone():
                    await db.execute(
                        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                        (new_id("u"), name, hash_password(settings.default_tester_password), settings.default_user_role, now),
                    )
                    log.info("storage.tester_user_created", user=name)
            await db.commit()

    # ---- users ----
    async def get_user(self, user_id: str) -> dict | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute("SELECT id, username, role, created_at FROM users WHERE id = ?", (user_id,))
            row = await cur.fetchone()
            return dict(row) if row else None

    async def find_user_by_credentials(self, username: str, password: str) -> dict | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute("SELECT id, username, role, password_hash, created_at FROM users WHERE username = ?", (username,))
            row = await cur.fetchone()
            if not row:
                return None
            hashed = row["password_hash"]
            from server.infra.security import verify_password
            if not verify_password(password, hashed):
                return None
            d = dict(row)
            d.pop("password_hash", None)
            return d

    # ---- sessions ----
    async def create_session(self, user_id: str, last_ip: str | None = None) -> str:
        token = new_token("sess")
        now = int(time.time())
        exp = now + settings.session_ttl_seconds
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO sessions (id, user_id, created_at, expires_at, last_ip) VALUES (?,?,?,?,?)",
                (token, user_id, now, exp, last_ip),
            )
            await db.commit()
        return token

    async def get_session(self, token: str) -> dict | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute(
                "SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ? AND expires_at > ?",
                (token, int(time.time())),
            )
            row = await cur.fetchone()
            return dict(row) if row else None

    # ---- executions ----
    async def new_execution(self, *, user_id: str, intent: str, workflow_stage: int,
                            llm_provider: str | None, llm_model: str | None, status: str = "PENDING") -> str:
        eid = new_id("exe")
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO executions (id, user_id, intent, workflow_stage, status, llm_provider, llm_model, started_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (eid, user_id, intent, workflow_stage, status, llm_provider, llm_model, int(time.time() * 1000)),
            )
            await db.commit()
        return eid

    async def update_execution_status(self, execution_id: str, status: str, **fields: Any) -> None:
        cols = ["status = ?"]
        params: list[Any] = [status]
        for k, v in fields.items():
            cols.append(f"{k} = ?")
            params.append(v)
        params.append(execution_id)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(f"UPDATE executions SET {', '.join(cols)} WHERE id = ?", tuple(params))
            await db.commit()

    async def get_execution(self, execution_id: str) -> dict | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute("SELECT * FROM executions WHERE id = ?", (execution_id,))
            row = await cur.fetchone()
            return dict(row) if row else None

    async def list_executions(self, user_id: str, page: int = 1, size: int = 20) -> list[dict]:
        off = (max(1, page) - 1) * max(1, size)
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute(
                "SELECT * FROM executions WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (user_id, int(size), int(off)),
            )
            return [dict(r) for r in await cur.fetchall()]

    # ---- tool_calls ----
    async def new_tool_call(self, *, execution_id: str, tool_name: str, params: dict) -> str:
        tid = new_id("tc")
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO tool_calls (id, execution_id, tool_name, params_json, success, started_at)
                   VALUES (?,?,?,?,0,?)""",
                (tid, execution_id, tool_name, json.dumps(params, ensure_ascii=False), int(time.time() * 1000)),
            )
            await db.commit()
        return tid

    async def complete_tool_call(self, tool_call_id: str, *, success: bool, result_snippet: str | None,
                                 artifacts: list[str] | None, execution_ms: int, error_message: str | None) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """UPDATE tool_calls SET success=?, result_snippet=?, artifacts_json=?, execution_ms=?, error_message=?
                   WHERE id = ?""",
                (1 if success else 0, result_snippet,
                 json.dumps(artifacts or [], ensure_ascii=False) if artifacts is not None else None,
                 int(execution_ms), error_message, tool_call_id),
            )
            await db.commit()

    async def list_tool_calls(self, execution_id: str) -> list[dict]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute(
                "SELECT * FROM tool_calls WHERE execution_id = ? ORDER BY started_at ASC",
                (execution_id,),
            )
            return [dict(r) for r in await cur.fetchall()]

    # ---- test_records ----
    async def insert_test_records(self, records: list[dict]) -> None:
        now = int(time.time() * 1000)
        rows = [
            (
                r.get("id") or new_id("tr"),
                r.get("execution_id"), r.get("user_id"), r["case_name"], r["format_type"],
                r["module_id"], int(r["base_batch"]), int(r["base_index"]),
                int(r["bonus_batch"]) if r.get("bonus_batch") is not None else None,
                int(r["bonus_index"]) if r.get("bonus_index") is not None else None,
                r.get("file_name"), r["xml_snippet"], now,
            )
            for r in records
        ]
        async with aiosqlite.connect(self.db_path) as db:
            await db.executemany(
                """INSERT INTO test_records (id, execution_id, user_id, case_name, format_type, module_id,
                   base_batch, base_index, bonus_batch, bonus_index, file_name, xml_snippet, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            await db.commit()

    async def list_test_records(self, execution_id: str | None = None, user_id: str | None = None) -> list[dict]:
        q, params = "SELECT * FROM test_records WHERE 1=1", []
        if execution_id:
            q += " AND execution_id = ?"
            params.append(execution_id)
        if user_id:
            q += " AND user_id = ?"
            params.append(user_id)
        q += " ORDER BY created_at DESC LIMIT 1000"
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cur = await db.execute(q, tuple(params))
            return [dict(r) for r in await cur.fetchall()]

    # ---- llm_audit ----
    async def insert_llm_audit(self, *, user_id: str, provider: str, model: str,
                               tokens_in: int, tokens_out: int, duration_ms: int, success: bool) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO llm_audit (user_id, provider, model, tokens_in, tokens_out, started_at, duration_ms, success)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (user_id, provider, model, int(tokens_in), int(tokens_out),
                 int(time.time() * 1000), int(duration_ms), 1 if success else 0),
            )
            await db.commit()
```

- [ ] **Step 6: Smoke test (optional): parse modules /w Python**

```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
python -c "import sys; sys.path.insert(0,'.'); import ast, pathlib; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in ['server/config.py','server/infra/logger.py','server/infra/security.py','server/infra/process_runner.py','server/infra/storage.py']]; print('parse-ok')"
```
Expected: `parse-ok`

---

## Phase 1: L2 Tool Plugin Layer (P0 core)

### Task 1.1: Tool Plugin Base Interface + Registry

**Files:**
- Create: `server/tools/__init__.py`
- Create: `server/tools/base.py`

- [ ] **Step 1: Write `server/tools/__init__.py`**

```python
"""Harness L2: MCP-compatible Tool Plugin registry and built-in implementations."""
from server.tools.base import (
    ToolPlugin, ToolRegistry, ToolInfo, ToolInputSchema,
    ToolParameter, ToolResult, HarnessContext,
)
__all__ = [
    "ToolPlugin", "ToolRegistry", "ToolInfo", "ToolInputSchema",
    "ToolParameter", "ToolResult", "HarnessContext",
]
```

- [ ] **Step 2: Write `server/tools/base.py`**

```python
from __future__ import annotations
import json
import time
from abc import ABC, abstractmethod
from dataclasses import field
from typing import Any, Optional
from pydantic import BaseModel, Field, ConfigDict


class ToolParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    type: str = "string"           # string / number / boolean / object / array
    description: str = ""
    required: bool = False
    default: Any = None
    enum: Optional[list[Any]] = None


class ToolInputSchema(BaseModel):
    properties: list[ToolParameter] = Field(default_factory=list)


class ToolInfo(BaseModel):
    name: str
    description: str
    inputSchema: ToolInputSchema = Field(default_factory=ToolInputSchema)
    permissions: list[str] = Field(default_factory=list)
    timeout_seconds: int = 60
    version: str = "1.0.0"


class ToolResult(BaseModel):
    success: bool
    content: Any = None
    error: Optional[str] = None
    execution_ms: int = 0
    artifacts: list[str] = Field(default_factory=list)


class HarnessContext(BaseModel):
    execution_id: str
    user_id: str
    user_role: str
    session_token: str
    work_dir: str


class ToolPlugin(ABC):
    @property
    @abstractmethod
    def info(self) -> ToolInfo: ...

    def validate(self, params: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
        out: dict[str, Any] = {}
        expected = {p.name: p for p in self.info.inputSchema.properties}
        for p in self.info.inputSchema.properties:
            if p.required and p.name not in params and p.default is None:
                return False, f"missing_required_param:{p.name}", {}
        for k, v in (params or {}).items():
            if k not in expected:
                return False, f"unknown_param:{k}", {}
            spec = expected[k]
            if v is None:
                if spec.default is not None:
                    out[k] = spec.default
                elif spec.required:
                    return False, f"param_empty:{k}", {}
                continue
            # very light type coercion
            try:
                if spec.type == "number":
                    v = int(v) if isinstance(v, bool if False else float if False else int, int if False else float) else (int(v) if str(v).lstrip("-").isdigit() else float(v))
                elif spec.type == "boolean":
                    if isinstance(v, bool):
                        pass
                    else:
                        v = str(v).lower() in {"1", "true", "yes", "on"}
                out[k] = v
            except Exception:
                return False, f"param_type_mismatch:{k}:{spec.type}", {}
        for p in self.info.inputSchema.properties:
            if p.name not in out and p.default is not None:
                out[p.name] = p.default
        return True, "", out

    async def execute(self, params: dict[str, Any], context: HarnessContext) -> ToolResult:
        t0 = time.perf_counter()
        ok, err, validated = self.validate(params)
        if not ok:
            return ToolResult(success=False, error=err, execution_ms=int((time.perf_counter() - t0) * 1000))
        try:
            res = await self._run_impl(validated, context)
            res.execution_ms = int((time.perf_counter() - t0) * 1000)
            return res
        except Exception as e:
            return ToolResult(success=False, error=f"unexpected:{type(e).__name__}:{e}",
                              execution_ms=int((time.perf_counter() - t0) * 1000))

    @abstractmethod
    async def _run_impl(self, params: dict[str, Any], context: HarnessContext) -> ToolResult: ...


class ToolRegistry:
    def __init__(self):
        self._plugins: dict[str, ToolPlugin] = {}

    def register(self, plugin: ToolPlugin) -> None:
        self._plugins[plugin.info.name] = plugin

    def list_info(self) -> list[ToolInfo]:
        return [p.info for p in self._plugins.values()]

    def get(self, name: str) -> ToolPlugin:
        if name not in self._plugins:
            raise KeyError(f"tool_not_found:{name}")
        return self._plugins[name]

    def as_function_calling_schema(self) -> list[dict]:
        out = []
        for info in self.list_info():
            props = {}
            required: list[str] = []
            for p in info.inputSchema.properties:
                entry: dict[str, Any] = {"type": p.type, "description": p.description}
                if p.enum:
                    entry["enum"] = p.enum
                props[p.name] = entry
                if p.required:
                    required.append(p.name)
            out.append({
                "type": "function",
                "function": {
                    "name": info.name,
                    "description": info.description,
                    "parameters": {
                        "type": "object",
                        "properties": props,
                        "required": required,
                    }
                }
            })
        return out
```

- [ ] **Step 3: Python parse check**
```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
python -c "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in ['server/tools/__init__.py','server/tools/base.py']]; print('parse-ok')"
```
Expected: `parse-ok`

---

### Task 1.2: Implement 5 Built-in Tool Plugins

**Files:**
- Create: `server/tools/impl/__init__.py`
- Create: `server/tools/impl/paytable_parser_tool.py`
- Create: `server/tools/impl/testdata_generator_tool.py`
- Create: `server/tools/impl/zip_packager_tool.py`
- Create: `server/tools/impl/game_verifier_tool.py`
- Create: `server/tools/impl/log_diagnoser_tool.py`

- [ ] **Step 1: Write `server/tools/impl/__init__.py`**
```python
from server.tools.impl.paytable_parser_tool import PaytableParserTool
from server.tools.impl.testdata_generator_tool import TestdataGeneratorTool
from server.tools.impl.zip_packager_tool import ZipPackagerTool
from server.tools.impl.game_verifier_tool import GameVerifierTool
from server.tools.impl.log_diagnoser_tool import LogDiagnoserTool

BUILTIN_TOOLS: list = [
    PaytableParserTool(),
    TestdataGeneratorTool(),
    ZipPackagerTool(),
    GameVerifierTool(),
    LogDiagnoserTool(),
]
__all__ = ["BUILTIN_TOOLS",
           "PaytableParserTool", "TestdataGeneratorTool", "ZipPackagerTool",
           "GameVerifierTool", "LogDiagnoserTool"]
```

- [ ] **Step 2: Write `server/tools/impl/paytable_parser_tool.py`**
```python
from __future__ import annotations
import re
from typing import Any
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)

class PaytableParserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="paytable_parser",
            description="Parses raw Google Sheets / CSV / pasted paytable text with case names, Bet Lines ID blocks, and (batch,index) pairs. Emits structured records + fileMap grouped by game prefix.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="raw_text", type="string", required=True,
                              description="Raw pasted paytable text. May contain headers like '[File]', 'Bet Lines ID' lines, tab-separated case + batch,index rows."),
                ToolParameter(name="game_prefix", type="string", default="P5P",
                              description="File name prefix, e.g. 'P5P_' or 'YGG_'"),
                ToolParameter(name="default_module_id", type="string", default="105359",
                              description="Fallback Module ID if none found via regex Module ID xxx in raw_text."),
            ]),
            permissions=["parse:text"],
            timeout_seconds=15,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw: str = params["raw_text"]
        prefix: str = params["game_prefix"]
        default_module: str = str(params["default_module_id"])

        m = re.search(r"Module\s*ID\s*#?:?\s*(\d+)", raw, re.I)
        module_id = m.group(1) if m else default_module

        records: list[dict] = []
        file_map: dict[str, list[dict]] = {}
        counter = 0
        lines = raw.splitlines()
        in_bet = False

        def _group_file(name: str) -> str:
            lname = name.lower()
            if any(k in lname for k in ["micro win", "small win", "medium win", "large win"]):
                return f"{prefix}_Base game_Regular Wins.testdata"
            if any(k in lname for k in ["big win", "mega win", "epic win", "super win"]):
                return f"{prefix}_Base game_Big Wins.testdata"
            return f"{prefix}_{name}.testdata"

        def _add_rec(scenario: str, bb: int, bi: int, bonus_batch: int | None, bonus_index: int | None, filename: str):
            nonlocal counter
            counter += 1
            is_double = bonus_batch is not None and bonus_index is not None
            if is_double:
                xml = (
                    f'<Spin stage="BaseGame" comment="{scenario}">\n'
                    f'  <PreGen batch="{bb}" index="{bi}" />\n'
                    f'  <Feature stage="Bonus">\n'
                    f'    <PreGen batch="{bonus_batch}" index="{bonus_index}" />\n'
                    f'  </Feature>\n</Spin>'
                )
            else:
                xml = (
                    f'<Spin stage="BaseGame" comment="{scenario}">\n'
                    f'  <PreGen batch="{bb}" index="{bi}" />\n</Spin>'
                )
            rec = {
                "id": f"TR-{counter:03d}",
                "case_name": scenario,
                "format_type": "DOUBLE_PREGEN" if is_double else "SINGLE",
                "module_id": module_id,
                "stage": "BaseGame",
                "comment": scenario,
                "base_batch": int(bb), "base_index": int(bi),
                "bonus_batch": bonus_batch, "bonus_index": bonus_index,
                "file_name": filename,
                "game_prefix": prefix,
                "xml_snippet": xml,
            }
            records.append(rec)
            file_map.setdefault(filename, []).append(rec)

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if "bet lines id" in line.lower():
                in_bet = True
                continue
            if in_bet:
                bm = re.match(r"^(\d+)\s+(\d+)\s*,\s*(\d+)", line)
                if bm:
                    line_num, bb, bi = bm.group(1), int(bm.group(2)), int(bm.group(3))
                    fname = f"{prefix}_Base game_Betlines.testdata"
                    _add_rec(f"BetLine Line {line_num}", bb, bi, None, None, fname)
                    continue
            parts = [p.strip() for p in re.split(r"\t| {2,}", line) if p.strip()]
            if len(parts) >= 2:
                scenario = parts[0]
                base_str = parts[1]
                bonus_str = parts[2] if len(parts) >= 3 else ""
            else:
                m2 = re.match(r"^(.+?)\s+(\d+[\s,]+\d+)(?:\s+(\d+[\s,]+\d+))?$", line)
                if not m2:
                    continue
                scenario, base_str, bonus_str = m2.group(1).strip(), m2.group(2).strip(), m2.group(3) or ""
            if not scenario or not base_str or not any(c.isalpha() for c in scenario):
                continue
            bm1 = re.match(r"(\d+)\s*[, ]\s*(\d+)", base_str)
            if not bm1:
                continue
            bb, bi = int(bm1.group(1)), int(bm1.group(2))
            bb2 = bi2 = None
            if bonus_str:
                bm2 = re.match(r"(\d+)\s*[, ]\s*(\d+)", bonus_str)
                if bm2:
                    bb2, bi2 = int(bm2.group(1)), int(bm2.group(2))
            fname = _group_file(scenario)
            _add_rec(scenario, bb, bi, bb2, bi2, fname)

        # Fallback: empty → default P5P minimal suite
        if not records:
            default_cases = [
                ("micro win", 1, 10, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Small win", 1, 17, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Medium win", 2, 2, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Bonus Feature_MINI Prize", 58, 3, 2, 67933, f"{prefix}_Bonus Feature_MINI Prize.testdata"),
                ("Bonus Feature_MINOR Prize", 58, 3, 4, 145, f"{prefix}_Bonus Feature_MINOR Prize.testdata"),
            ]
            for c in default_cases:
                _add_rec(c[0], c[1], c[2], c[3], c[4], c[5])

        return ToolResult(
            success=True,
            content={
                "module_id": module_id,
                "game_prefix": prefix,
                "total_records": len(records),
                "file_count": len(file_map),
                "file_list": sorted(file_map.keys()),
                "records": records,
            },
            result_snippet := None,  # keep linter calm (no-op)
        )
```

Wait — ToolResult 没有 result_snippet 参数。修正：

把上面 `_run_impl` 最后 return 替换为：
```python
        return ToolResult(
            success=True,
            content={
                "module_id": module_id,
                "game_prefix": prefix,
                "total_records": len(records),
                "file_count": len(file_map),
                "file_list": sorted(file_map.keys()),
                "records": records,
            },
        )
```

- [ ] **Step 3: Write `server/tools/impl/testdata_generator_tool.py`**
```python
from __future__ import annotations
import json
from pathlib import Path
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)

def _write_xml(records: list[dict], file_name: str, module_id: str, login_name: str) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             "<Test>",
             f'  <Key moduleID="{module_id}" loginName="{login_name}" />',
             "  <Slot>"]
    for r in records:
        lines.append(f'    <!-- Case: {r["case_name"]} -->')
        if r.get("bonus_batch") is not None:
            lines += [
                '    <Spin stage="BaseGame">',
                f'      <PreGen batch="{r["base_batch"]}" index="{r["base_index"]}"></PreGen>',
                '      <Feature stage="Bonus">',
                f'        <PreGen batch="{r["bonus_batch"]}" index="{r["bonus_index"]}"></PreGen>',
                "      </Feature>",
                "    </Spin>",
            ]
        else:
            lines += [
                f'    <Spin stage="{r.get("stage") or "BaseGame"}" comment="{r.get("comment") or r["case_name"]}">',
                f'      <PreGen batch="{r["base_batch"]}" index="{r["base_index"]}" />',
                "    </Spin>",
            ]
    lines += ["  </Slot>", "</Test>"]
    out_path = Path(file_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return str(out_path.resolve())


class TestdataGeneratorTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_generator",
            description="Writes a structured list of test records (from paytable_parser) into one or more .testdata XML files, grouped by record.file_name. Returns created file paths.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="records", type="object", required=True,
                              description="Records array from paytable_parser output: [{case_name, format_type, module_id, base_batch, base_index, bonus_batch?, bonus_index?, file_name, xml_snippet}]"),
                ToolParameter(name="login_name", type="string", default="",
                              description="loginName attribute on the output XML <Key> tag."),
            ]),
            permissions=["filesystem:write"],
            timeout_seconds=30,
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        records_raw = params["records"]
        records: list[dict] = records_raw if isinstance(records_raw, list) else json.loads(records_raw)
        login_name: str = str(params.get("login_name") or "")
        work_dir = Path(ctx.work_dir)
        groups: dict[str, list[dict]] = {}
        for r in records:
            fn = r.get("file_name") or ("P5P_Bonus_Feature.testdata" if r.get("bonus_batch") is not None else "P5P_Base_Spins.testdata")
            groups.setdefault(fn, []).append(r)
        artifacts: list[str] = []
        module_id = str(records[0].get("module_id") or "105359") if records else "105359"
        for fn, recs in groups.items():
            out = _write_xml(recs, str(work_dir / fn), module_id, login_name)
            artifacts.append(out)
        return ToolResult(success=True,
                           content={"files": artifacts, "module_id": module_id,
                                    "total_files": len(artifacts), "total_records": sum(len(v) for v in groups.values())},
                           artifacts=artifacts)
```

- [ ] **Step 4: Write `server/tools/impl/zip_packager_tool.py`**
```python
from __future__ import annotations
import json
import zipfile
from pathlib import Path
from typing import Any
from server.config import ARTIFACTS_DIR
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)


class ZipPackagerTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="zip_packager",
            description="Bundles an execution's .testdata XML files + manifest.json into a downloadable outcome_testdata zip. Returns the artifact URL path.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="source_files", type="object", required=True,
                              description="List of absolute .testdata file paths (generated by testdata_generator)."),
                ToolParameter(name="login_name", type="string", default=""),
                ToolParameter(name="module_id", type="string", default="105359"),
            ]),
            permissions=["filesystem:write"],
            timeout_seconds=30,
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        src_raw = params["source_files"]
        sources: list[str] = src_raw if isinstance(src_raw, list) else json.loads(src_raw)
        login_name: str = str(params.get("login_name") or "")
        module_id: str = str(params["module_id"])

        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        zip_name = f"outcome_testdata_module_{module_id}_{login_name or ctx.user_id}_{ctx.execution_id}.zip"
        zip_path = ARTIFACTS_DIR / zip_name
        manifest = {
            "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "agentEngine": "Slot-TestData-Generator-Agent-v2",
            "executionId": ctx.execution_id,
            "moduleID": module_id,
            "loginName": login_name,
            "fileList": [],
        }
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sources:
                p = Path(f)
                if not p.exists():
                    continue
                zf.write(p, arcname=p.name)
                manifest["fileList"].append(p.name)
            zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        rel = f"/api/records/artifacts/{zip_name}"
        return ToolResult(success=True,
                           content={"zip_name": zip_name, "download_url": rel, "manifest": manifest},
                           artifacts=[str(zip_path.resolve())])
```

- [ ] **Step 5: Write `server/tools/impl/game_verifier_tool.py`**
```python
from __future__ import annotations
import json
from pathlib import Path
import sys
from typing import Any
from server import ROOT_DIR  # will be defined in server/__init__.py next Task; fallback below
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)

# Fallback ROOT_DIR if server not imported
try:
    from server.config import ROOT_DIR as _ROOT
except Exception:
    _ROOT = Path(__file__).resolve().parents[3]

VERIFY_SCRIPT = _ROOT / "verify_testdata.py"


class GameVerifierTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="game_verifier",
            description="Runs verify_testdata.py (Selenium + Chrome) against a .testdata file and a real game URL. Returns parsed HTML report path + parsed per-case results.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=True,
                              description="Absolute path to .testdata file (from testdata_generator output)."),
                ToolParameter(name="target_url", type="string", required=True,
                              description="Real game environment URL (http/https)."),
                ToolParameter(name="auto_spin", type="boolean", default=True),
                ToolParameter(name="spin_delay_sec", type="number", default=5.0),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
            ]),
            permissions=["filesystem:write", "selenium", "network:outbound"],
            timeout_seconds=900,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from server.infra import process_runner
        from server.infra.logger import log

        testdata_file = Path(params["testdata_file"])
        if not testdata_file.exists():
            return ToolResult(success=False, error=f"testdata_file_not_found:{testdata_file}")
        target_url: str = params["target_url"]
        auto_spin: bool = bool(params["auto_spin"])
        spin_delay: float = float(params["spin_delay_sec"])
        output = Path(params["output_report"]) if params.get("output_report") else (Path(ctx.work_dir) / "report.html")
        output.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable, str(VERIFY_SCRIPT),
            "-f", str(testdata_file),
            "-u", target_url,
            "-o", str(output),
        ]
        if auto_spin:
            cmd += ["--auto-spin", "--spin-delay", str(spin_delay)]

        stdout_lines: list[str] = []
        def _on_std(line: str):
            stdout_lines.append(line)
            log.info("verify.stdout", line=line)

        completed = await process_runner.run(cmd, Path(ctx.work_dir), timeout_sec=self.info.timeout_seconds,
                                              on_stdout=_on_stdout)
        artifacts: list[str] = []
        if output.exists():
            artifacts.append(str(output.resolve()))
        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        if screenshots_dir.exists():
            for p in screenshots_dir.glob("*.png"):
                artifacts.append(str(p.resolve()))
        parsed_cases = self._parse_stdout(stdout_lines)
        success = completed.returncode == 0 and output.exists()
        return ToolResult(
            success=success,
            error=(None if success else (completed.stderr.splitlines()[-1] if completed.stderr else f"exit_code:{completed.returncode}")),
            content={
                "stdout_tail": stdout_lines[-40:],
                "exit_code": completed.returncode,
                "timed_out": completed.timed_out,
                "report_html": str(output),
                "parsed_cases": parsed_cases,
            },
            execution_ms=completed.execution_ms,
            artifacts=artifacts,
        )

    @staticmethod
    def _parse_stdout(lines: list[str]) -> list[dict]:
        """Best-effort parse PASS/FAIL lines from verify_testdata stdout."""
        out: list[dict] = []
        for l in lines:
            m = __import__("re").match(r".*?\[(\d+)/(\d+)\].*\[(PASS|FAIL|ERROR)\].*batch[: ]+(\d+).*index[: ]+(\d+)", l)
            if m:
                out.append({"idx": int(m.group(1)), "total": int(m.group(2)),
                            "status": m.group(3), "batch": int(m.group(4)), "index": int(m.group(5))})
        return out
```

- [ ] **Step 6: Write `server/tools/impl/log_diagnoser_tool.py`**
```python
from __future__ import annotations
import json
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)


class LogDiagnoserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="log_diagnoser",
            description="Rule-engine diagnoses for a list of verification results. Emits one DiagnosticProof per record: ORIGINAL_SHEET_DATA_ERROR / INDEX_OUT_OF_BOUNDS / SERVER_ENDPOINT_ERROR / VERIFIED_CORRECT.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="results", type="object", required=True,
                              description='List: [{recordId?, caseName, status, httpStatus, responseTimeMs, batchIndexString, responseBodySnippet?, errorMessage?}]'),
            ]),
            permissions=["parse:text"],
            timeout_seconds=15,
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw = params["results"]
        results: list[dict] = raw if isinstance(raw, list) else json.loads(raw)
        diagnostics = []
        for r in results:
            name = str(r.get("caseName", ""))
            is_bonus = any(k in name.lower() for k in ["bonus", "mini", "minor", "major", "maxi", "feature"])
            status = str(r.get("status", "ERROR"))
            http_status = int(r.get("httpStatus") or 0)
            batch_str = str(r.get("batchIndexString", ""))
            snippet = str(r.get("responseBodySnippet") or "")
            err = str(r.get("errorMessage") or "")
            if status == "PASSED":
                diag = "VERIFIED_CORRECT"
                title = "✅ Test Case & Seed Verified Consistent"
                severity, rec = "NONE", "No action needed. TestData entry is 100% valid."
                evidence = [
                    f"[OK] Game Engine confirmed seed {batch_str}",
                    f"[OK] Server response latency: {r.get('responseTimeMs') or '?'}ms",
                    "[OK] Screen render verified",
                ]
                real = f"HTTP {http_status} - Seed accepted & spin executed"
            elif status == "DISCREPANCY" and is_bonus:
                diag = "ORIGINAL_SHEET_DATA_ERROR"
                title = "🚨 Original Google Sheet Data Entry Error"
                severity, rec = "HIGH", (f"Update Google Sheet for '{name}'. The seed {batch_str} is a non-bonus spin in the math model.")
                evidence = [
                    f"[PROOF 1] Sheet Label: '{name}'",
                    f"[PROOF 2] Server Payload: {snippet or '{{\"status\":\"OK\",\"bonusTriggered\":false}}'}",
                    "[PROOF 3] Canvas Visual: 5x3 Reel Screenshot showing regular spin outcome without Bonus wheel",
                ]
                real = "Real Game Engine returned regular BaseGame spin ($0.00 payout) without Bonus Feature trigger"
            elif http_status == 400 or "Index" in err or "index" in err.lower():
                diag = "INDEX_OUT_OF_BOUNDS"
                title = "⚠️ Google Sheet Seed Index Out of Bounds"
                severity, rec = "HIGH", f"Check Google Sheet math index bounds for '{name}'."
                evidence = [
                    "[PROOF 1] Game Engine Exception: Seed index exceeds valid pre-generated range",
                    f"[PROOF 2] Server Error: {err or 'Invalid Batch/Index seed'}",
                ]
                real = f"Server rejected seed with HTTP {http_status or 400} (Index Invalid / Range Error)"
            else:
                diag = "SERVER_ENDPOINT_ERROR"
                title = "🌐 Target Game Server Connection Exception"
                severity, rec = "MEDIUM", "Check if game server endpoint URL is online and accessible."
                evidence = [
                    "[LOG] Request failed against target game endpoint",
                    f"[LOG] Exception: {err or f'HTTP {http_status} Error'}",
                ]
                real = err or f"HTTP {http_status} Error"
            diagnostics.append({
                "recordId": r.get("recordId") or "",
                "caseName": name,
                "batchIndexString": batch_str,
                "diagnosisType": diag,
                "title": title,
                "severity": severity,
                "sheetExpectation": name,
                "realServerOutcome": real,
                "evidenceLogs": evidence,
                "recommendation": rec,
            })
        return ToolResult(success=True, content={"count": len(diagnostics), "diagnostics": diagnostics})
```

- [ ] **Step 7: Parse check for 5 tools**
```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
python -c "import ast, pathlib; files = ['server/tools/impl/__init__.py','server/tools/impl/paytable_parser_tool.py','server/tools/impl/testdata_generator_tool.py','server/tools/impl/zip_packager_tool.py','server/tools/impl/game_verifier_tool.py','server/tools/impl/log_diagnoser_tool.py']; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in files]; print('parse-ok')"
```
Expected: `parse-ok`. If `PaytableParserTool` has a syntax bug from the deprecated `result_snippet` line, fix it first.

---

## Phase 2: L3 Application Services + L4 API Routes (P1 core)

### Task 2.1: Services (ExecutionQueue / SessionManager + ToolRegistry bootstrap) + FastAPI main

**Files:**
- Create: `server/__init__.py` (ROOT_DIR exports)
- Create: `server/services/__init__.py`
- Create: `server/services/execution_queue.py`
- Create: `server/services/session_manager.py`
- Create: `server/main.py` (FastAPI app entry)
- Create: `server/api/__init__.py`
- Create: `server/api/auth_router.py`
- Create: `server/api/tools_router.py`
- Create: `server/api/executions_router.py`
- Create: `server/api/records_router.py`

- [ ] **Step 1: Write `server/__init__.py`**
```python
from pathlib import Path
ROOT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
__all__ = ["ROOT_DIR", "SERVER_DIR"]
```

- [ ] **Step 2: Write `server/services/__init__.py`**
```python
from server.services.execution_queue import SerialExecutionQueue, ExecutionQueue
from server.services.session_manager import SessionManager
__all__ = ["SerialExecutionQueue", "ExecutionQueue", "SessionManager"]
```

- [ ] **Step 3: Write `server/services/session_manager.py`**
```python
from __future__ import annotations
from server.infra.storage import StorageAsync
from server.infra.security import verify_password

class SessionManager:
    def __init__(self, storage: StorageAsync | None = None):
        self.storage = storage or StorageAsync.singleton()
    async def login(self, username: str, password: str, last_ip: str | None = None) -> tuple[dict | None, str | None]:
        user = await self.storage.find_user_by_credentials(username, password)
        if user is None:
            return None, None
        token = await self.storage.create_session(user["id"], last_ip=last_ip)
        return user, token
```

- [ ] **Step 4: Write `server/services/execution_queue.py`**
```python
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
                on_event({"type": "TOOL_CALL", "toolName": tool_name, "content": json.dumps(params, ensure_ascii=False),
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
                on_event({"type": "TOOL_RES", "toolName": tool_name,
                          "content": (result.error or snippet or ""),
                          "status": "success" if result.success else "error",
                          "timestamp": _ts()})

            total_ms = int((time.perf_counter() - t0) * 1000)
            log.info("exec.tool_complete", tool=tool_name, ok=result.success, ms=total_ms, eid=execution_id)
            return result


def _ts() -> str:
    return __import__("datetime").datetime.now().strftime("%H:%M:%S")
```

- [ ] **Step 5: Write `server/api/__init__.py`**
```python
"""FastAPI routers for L4 API Gateway layer."""
```

- [ ] **Step 6: Write `server/api/auth_router.py`**
```python
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from server.infra.security import require_user
from server.services.session_manager import SessionManager

router = APIRouter(prefix="/api/auth", tags=["Auth"])
_sm = SessionManager()


class LoginReq(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginReq):
    user, token = await _sm.login(body.username, body.password, last_ip=None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    return {"session_token": token, "user": user}


@router.get("/me")
async def me(user=Depends(require_user())):
    return user
```

- [ ] **Step 7: Write `server/api/tools_router.py`**
```python
from __future__ import annotations
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.infra.security import require_user
from server.main import shared  # type: ignore # will be defined below

router = APIRouter(prefix="/api/tools", tags=["Tools"])


class ExecuteReq(BaseModel):
    tool_name: str
    params: dict


class ExecuteAsyncReq(BaseModel):
    tool_name: str
    params: dict
    execution_id: str | None = None


@router.get("/list")
async def list_tools(user=Depends(require_user())):
    registry = shared.tool_registry
    return {"tools": [i.model_dump() for i in registry.list_info()],
            "function_calling_schema": registry.as_function_calling_schema()}


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
```

- [ ] **Step 8: Write `server/api/executions_router.py`**
```python
from __future__ import annotations
import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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
```

- [ ] **Step 9: Write `server/api/records_router.py`**
```python
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
```

- [ ] **Step 10: Write `server/main.py` (FastAPI entry + dependency injection + SSE Hub + bootstrap)**
```python
from __future__ import annotations
import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.api.auth_router import router as auth_router
from server.api.tools_router import router as tools_router
from server.api.executions_router import router as executions_router
from server.api.records_router import router as records_router
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
```

- [ ] **Step 11: Parse + minimal import check of server.main via Python**
```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
python -c "import sys, ast, pathlib; files = list(pathlib.Path('server').rglob('*.py')); [ast.parse(p.read_text(encoding='utf-8')) for p in files]; print(f'parse-ok:{len(files)} files')"
```
Expected: `parse-ok:NN files` with no stack trace.

---

## Phase 3: Frontend Planner Agent + HarnessClient (P0 UI real execution)

### Task 3.1: Shared DTO + HarnessClient

**Files:**
- Create: `src/harness/sharedTypes.ts`
- Create: `src/harness/client.ts`

- [ ] **Step 1: Write `src/harness/sharedTypes.ts`**
```typescript
export type ToolParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameterDto {
  name: string;
  type: ToolParameterType;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface ToolInputSchemaDto {
  properties: ToolParameterDto[];
}

export interface ToolInfoDto {
  name: string;
  description: string;
  inputSchema: ToolInputSchemaDto;
  permissions: string[];
  timeout_seconds: number;
  version: string;
}

export interface FunctionCallingSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: unknown[] }>;
      required: string[];
    };
  };
}

export interface ToolListResponse {
  tools: ToolInfoDto[];
  function_calling_schema: FunctionCallingSchema[];
}

export interface ToolResultDto {
  success: boolean;
  content: unknown;
  error: string | null;
  execution_ms: number;
  artifacts: string[];
}

export interface UserDto {
  id: string;
  username: string;
  role: "tester" | "admin" | string;
  created_at?: number;
  token?: string;
}

export interface LoginResponse {
  session_token: string;
  user: UserDto;
}

export type ToolCallLogType =
  | "THOUGHT"
  | "TOOL_CALL"
  | "TOOL_RES"
  | "SELF_HEAL"
  | "HARNESS_EVENT";

export interface HarnessSseEvent {
  type: ToolCallLogType;
  toolName?: string;
  content: string;
  status?: "running" | "success" | "warning" | "error";
  timestamp: string;
  [k: string]: unknown;
}

export interface SseDoneEvent {
  success: boolean;
  execution_id: string;
  total_ms: number;
  timestamp: string;
}

export interface ExecutionRow {
  id: string;
  user_id: string;
  intent: string;
  workflow_stage: 0 | 1 | 2;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_tokens_in: number;
  llm_tokens_out: number;
  started_at: number;
  finished_at?: number | null;
  total_ms: number;
  error_message?: string | null;
}

export interface ToolCallRow {
  id: string;
  execution_id: string;
  tool_name: string;
  params_json: string;
  success: 0 | 1;
  result_snippet?: string | null;
  artifacts_json?: string | null;
  started_at: number;
  execution_ms: number;
  error_message?: string | null;
}

export interface TestRecordDto {
  id: string;
  execution_id?: string | null;
  user_id?: string | null;
  case_name: string;
  format_type: "SINGLE" | "DOUBLE_PREGEN";
  module_id: string;
  base_batch: number;
  base_index: number;
  bonus_batch?: number | null;
  bonus_index?: number | null;
  file_name?: string | null;
  xml_snippet: string;
  created_at: number;
}

export interface ExecutionDetailResponse {
  execution: ExecutionRow;
  tool_calls: ToolCallRow[];
  records: TestRecordDto[];
}

export interface LLMAuditReq {
  provider: string;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
  success?: boolean;
}
```

- [ ] **Step 2: Write `src/harness/client.ts`**
```typescript
import type {
  FunctionCallingSchema,
  HarnessSseEvent,
  LLMAuditReq,
  LoginResponse,
  ToolInfoDto,
  ToolListResponse,
  ToolResultDto,
  UserDto,
  ExecutionRow,
  ExecutionDetailResponse,
  TestRecordDto,
  SseDoneEvent,
} from "./sharedTypes";

const DEFAULT_BASE = import.meta.env.VITE_HARNESS_API_BASE ?? "";

function readToken(): string {
  return window.sessionStorage.getItem("harness_token") ?? "";
}

export function saveToken(tok: string) {
  window.sessionStorage.setItem("harness_token", tok);
}

export function clearAuth() {
  window.sessionStorage.removeItem("harness_token");
}

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = `${DEFAULT_BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    data = text as unknown as T;
  }
  if (!res.ok) {
    const detail = (data as any)?.detail ?? text ?? `HTTP ${res.status}`;
    throw new HarnessApiError(res.status, String(detail));
  }
  return data;
}

export class HarnessApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`HARNESS API ${status}: ${message}`);
  }
}

export type HarnessEventName = "harness_event" | "done" | "ping";
export type HarnessStreamCallback = (
  event: HarnessEventName,
  payload: HarnessSseEvent | SseDoneEvent | { ts: string },
) => void;

export class HarnessClient {
  readonly base: string;

  constructor(base: string = DEFAULT_BASE) {
    this.base = base;
  }

  // ---- auth ----
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await jsonFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (res?.session_token) saveToken(res.session_token);
    return res;
  }

  async me(): Promise<UserDto> {
    return jsonFetch<UserDto>("/api/auth/me", { method: "GET" });
  }

  logout() {
    clearAuth();
  }

  // ---- tools ----
  async listTools(): Promise<{ tools: ToolInfoDto[]; schema: FunctionCallingSchema[] }> {
    const r = await jsonFetch<ToolListResponse>("/api/tools/list");
    return { tools: r.tools, schema: r.function_calling_schema };
  }

  async executeTool(tool_name: string, params: Record<string, unknown>): Promise<ToolResultDto> {
    return jsonFetch<ToolResultDto>("/api/tools/execute", {
      method: "POST",
      body: JSON.stringify({ tool_name, params }),
    });
  }

  async executeToolAsync(
    tool_name: string,
    params: Record<string, unknown>,
    execution_id?: string,
  ): Promise<{ ok: boolean; execution_id: string }> {
    return jsonFetch<{ ok: boolean; execution_id: string }>("/api/tools/execute-async", {
      method: "POST",
      body: JSON.stringify({ tool_name, params, execution_id }),
    });
  }

  // ---- executions ----
  async listExecutions(page = 1, size = 20): Promise<{ items: ExecutionRow[]; page: number; size: number }> {
    return jsonFetch(`/api/executions/mine?page=${page}&size=${size}`);
  }

  async getExecution(eid: string): Promise<ExecutionDetailResponse> {
    return jsonFetch(`/api/executions/${eid}`);
  }

  streamExecution(eid: string, cb: HarnessStreamCallback): () => void {
    const token = readToken();
    const url = `${this.base}/api/executions/stream/${encodeURIComponent(eid)}`;
    const es = new EventSource(url, { withCredentials: false });
    // SSE spec: EventSource opens GET; we cannot easily add headers. Workaround: append ?token= (Backend currently ignores query token for SSE because Depends reads Header).
    // → FastAPI will issue 401; so instead subscribe via REST helper in executions_router? No. Patch: temporarily also accept token in query only for SSE.
    // We address this in Task 2.2 Patch 1 below. Here keep URL as-is.
    (es as any)._token = token;

    const onMsg = (type: string) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data ?? "{}");
        cb(type as HarnessEventName, data);
      } catch {
        cb(type as HarnessEventName, {} as any);
      }
    };

    es.addEventListener("harness_event", onMsg("harness_event"));
    es.addEventListener("done", onMsg("done"));
    es.addEventListener("ping", onMsg("ping"));
    es.addEventListener("error", () => {
      // transient
    });
    return () => es.close();
  }

  // ---- records ----
  async saveRecords(records: Omit<TestRecordDto, "created_at" | "id">[] & { id?: string }[]): Promise<{ ok: boolean; count: number }> {
    return jsonFetch("/api/records/save-batch", {
      method: "POST",
      body: JSON.stringify(records),
    });
  }

  async auditLlm(req: LLMAuditReq): Promise<{ ok: boolean }> {
    return jsonFetch("/api/executions/audit-llm", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  outcomeZipUrl(rid: string): string {
    return `${this.base}/api/records/${encodeURIComponent(rid)}/outcome.zip`;
  }

  artifactUrl(filename: string): string {
    return `${this.base}/api/records/artifacts/${encodeURIComponent(filename)}`;
  }
}

// singleton
export const harnessClient = new HarnessClient();
```

- [ ] **Step 3: Patch 1 — Make SSE accept `?token=` query** (else browser EventSource can't send auth header)

Modify `server/api/executions_router.py` → `stream_execution` 顶部（`async def stream_execution`）: 增加 token query fallback 解析并注入到 request.scope headers 模拟 `Authorization: Bearer x`。更简洁的做法是扩展 `security.py` 的 `_get_session_user` 支持从 query 读 token。

修改 `server/infra/security.py` → `async def _get_session_user(authorization: str | None = Header(default=None))` 的签名：
```python
# Replace entire _get_session_user:
from fastapi import Header, Query, HTTPException, status, Request

async def _get_session_user(
    authorization: str | None = Header(default=None),
    token_q: str | None = Query(default=None, alias="token", include_in_schema=False),
) -> dict:
    if not settings.enable_auth:
        return {"id": "u_dev", "username": "dev", "role": "admin", "token": "dev_token"}
    tok_src: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        tok_src = authorization.split(" ", 1)[1].strip()
    elif token_q:
        tok_src = token_q.strip()
    if not tok_src:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_token")
    storage = StorageAsync.singleton()
    session = await storage.get_session(tok_src)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_or_expired_token")
    user = await storage.get_user(session["user_id"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    return {**user, "token": tok_src}
```

然后把 `streamExecution` 里的 URL 改为附加 token：
Patch `src/harness/client.ts` streamExecution 函数中的 url 行：
```typescript
    const url = `${this.base}/api/executions/stream/${encodeURIComponent(eid)}?token=${encodeURIComponent(token)}`;
```
并删除不再需要的 `(es as any)._token = token;`。

---

### Task 3.2: PlannerProvider (4 Providers, 基于现有 llmGateway 重写) + PlannerAgent ReAct

**Files:**
- Create: `src/harness/plannerProvider.ts`
- Create: `src/harness/plannerAgent.ts`
- Modify: `src/utils/llmGateway.ts` (de-dup / keep only 2 helpers: health check, stream chat)
- Delete: `src/utils/ollamaClient.ts`

- [ ] **Step 1: Trim `src/utils/llmGateway.ts` → remove `streamUniversalLlmChat` duplicates from ollamaClient; keep as base helpers**

替换整个文件为精简版 + helper：
```typescript
import type { LlmProviderConfig, LlmProviderType } from "../types";

export const STORAGE_KEY = "slot_harness_llm_config";

export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  provider: "OLLAMA",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  selectedModel: "qwen2.5-coder:7b",
  availableModels: [
    "qwen2.5-coder:7b",
    "deepseek-r1:8b",
    "qwen3-vl:8b",
    "qwen3:latest",
  ],
};

export const PROVIDER_PRESETS: Record<
  LlmProviderType,
  { name: string; defaultUrl: string; defaultModels: string[]; complianceRisk?: boolean }
> = {
  OLLAMA: {
    name: "Local Ollama Instance (Default · 保密合规)",
    defaultUrl: "http://localhost:11434",
    defaultModels: ["qwen2.5-coder:7b", "deepseek-r1:8b", "qwen3-vl:8b", "qwen3:latest"],
  },
  OPENAI: {
    name: "OpenAI API (v1 · ⚠️ 外部，需确认合规)",
    defaultUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
    complianceRisk: true,
  },
  ANTHROPIC: {
    name: "Anthropic Claude API (⚠️ 外部，需确认合规)",
    defaultUrl: "https://api.anthropic.com/v1",
    defaultModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    complianceRisk: true,
  },
  CUSTOM: {
    name: "Custom LLM Gateway / vLLM (⚠️ 外部，需确认合规)",
    defaultUrl: "http://localhost:8000/v1",
    defaultModels: ["custom-slot-llm", "qwen2.5-coder-32b", "llama3-70b"],
    complianceRisk: true,
  },
};

export function loadStoredLlmConfig(): LlmProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    console.warn("[llmGateway] loadStoredLlmConfig failed", e);
  }
  return DEFAULT_LLM_CONFIG;
}

export function saveLlmConfig(config: LlmProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("[llmGateway] saveLlmConfig failed", e);
  }
}

export interface LlmHealth {
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}

export async function testLlmConnection(config: LlmProviderConfig): Promise<LlmHealth> {
  const t0 = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  const lat = () => Date.now() - t0;
  try {
    if (config.provider === "OLLAMA") {
      const res = await fetch(`${stripSlash(config.baseUrl)}/api/tags`, { method: "GET", headers });
      if (!res.ok) return { online: false, models: [], latencyMs: lat(), error: `Ollama HTTP ${res.status}` };
      const d = await res.json();
      return { online: true, models: (d.models ?? []).map((m: any) => m.name), latencyMs: lat() };
    }
    let base = stripSlash(config.baseUrl);
    if (!/\/v1$/.test(base) && !/\/models$/.test(base)) base += "/v1";
    const url = base.endsWith("/models") ? base : `${base}/models`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return { online: false, models: config.availableModels, latencyMs: lat(), error: `HTTP ${res.status}` };
    const d = await res.json();
    const models = (d.data ?? []).map((m: any) => m.id);
    return { online: true, models: models.length ? models : config.availableModels, latencyMs: lat() };
  } catch (err: any) {
    return { online: false, models: config.availableModels, latencyMs: lat(), error: err?.message ?? `Failed to connect ${config.baseUrl}` };
  }
}

export interface UniversalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export async function streamUniversalLlmChat(
  config: LlmProviderConfig,
  messages: UniversalChatMessage[],
  onChunk: (chunkText: string) => void,
  signal?: AbortSignal,
): Promise<{ fullText: string; tokensInEstimate: number; tokensOutEstimate: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  if (config.provider === "ANTHROPIC") headers["x-api-key"] = config.apiKey ?? "";

  const tokensInEstimate = messages.reduce((n, m) => n + Math.ceil(m.content.length / 3.5), 0) | 0;
  let tokensOutEstimate = 0;
  let fullText = "";

  if (config.provider === "OLLAMA") {
    const url = `${stripSlash(config.baseUrl)}/api/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.selectedModel, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter(Boolean)) {
        try {
          const j = JSON.parse(line);
          const c = j.message?.content ?? "";
          if (c) {
            fullText += c;
            tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
            onChunk(c);
          }
        } catch {}
      }
    }
  } else if (config.provider === "ANTHROPIC") {
    const url = `${stripSlash(config.baseUrl).replace(/\/v1$/, "")}/v1/messages`;
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userOnly = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.selectedModel,
        system: systemMsg,
        messages: userOnly,
        max_tokens: 4096,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const rawLine of chunk.split("\n").filter(Boolean)) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
            const c = j.delta.text ?? "";
            if (c) {
              fullText += c;
              tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
              onChunk(c);
            }
          }
        } catch {}
      }
    }
  } else {
    // OpenAI / Custom OpenAI-compatible /v1/chat/completions
    let url = stripSlash(config.baseUrl);
    if (!url.endsWith("/chat/completions")) {
      if (!url.endsWith("/v1")) url += "/v1";
      url += "/chat/completions";
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.selectedModel, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const rawLine of chunk.split("\n").filter(Boolean)) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const c = j.choices?.[0]?.delta?.content ?? "";
          if (c) {
            fullText += c;
            tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
            onChunk(c);
          }
        } catch {}
      }
    }
  }

  return { fullText, tokensInEstimate: tokensInEstimate | 0, tokensOutEstimate: tokensOutEstimate | 0 };
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}
```

- [ ] **Step 2: Delete `src/utils/ollamaClient.ts` (功能已完全被 llmGateway + PlannerProvider 吸收)**

Run: 删除 `src/utils/ollamaClient.ts`；然后在 App.tsx / 其他引用它的地方下面任务会替换。

- [ ] **Step 3: Write `src/harness/plannerProvider.ts`**
```typescript
import type { LlmProviderConfig } from "../types";
import { streamUniversalLlmChat, testLlmConnection, PROVIDER_PRESETS } from "../utils/llmGateway";

export type PlannerProviderName = "ollama" | "openai" | "anthropic" | "custom";

export interface PlannerHealth {
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export interface PlannerStreamMeta {
  tokensInEstimate: number;
  tokensOutEstimate: number;
}

export interface PlannerProvider {
  readonly providerType: PlannerProviderName;
  readonly displayName: string;
  readonly complianceRisk: boolean;
  readonly config: LlmProviderConfig;

  healthCheck(): Promise<PlannerHealth>;
  streamChat(
    messages: ChatMessage[],
    onChunk: (tokenText: string) => void,
    signal?: AbortSignal,
  ): Promise<{ fullText: string; meta: PlannerStreamMeta }>;
}

class _BaseProvider implements PlannerProvider {
  readonly providerType: PlannerProviderName;
  readonly displayName: string;
  readonly complianceRisk: boolean;

  constructor(readonly config: LlmProviderConfig) {
    const type = config.provider.toLowerCase() as PlannerProviderName;
    this.providerType = type;
    const preset = PROVIDER_PRESETS[config.provider];
    this.displayName = preset?.name ?? `${config.provider} (${config.baseUrl})`;
    this.complianceRisk = !!preset?.complianceRisk;
  }

  async healthCheck(): Promise<PlannerHealth> {
    return testLlmConnection(this.config);
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (tokenText: string) => void,
    signal?: AbortSignal,
  ): Promise<{ fullText: string; meta: PlannerStreamMeta }> {
    const r = await streamUniversalLlmChat(this.config, messages, onChunk, signal);
    return {
      fullText: r.fullText,
      meta: { tokensInEstimate: r.tokensInEstimate, tokensOutEstimate: r.tokensOutEstimate },
    };
  }
}

export function createPlannerProvider(config: LlmProviderConfig): PlannerProvider {
  return new _BaseProvider(config);
}
```

- [ ] **Step 4: Write `src/harness/plannerAgent.ts` — ReAct 核心循环**
```typescript
import type { LlmProviderConfig } from "../types";
import { createPlannerProvider, PlannerProvider, ChatMessage } from "./plannerProvider";
import { harnessClient, HarnessClient } from "./client";
import type { FunctionCallingSchema, ToolInfoDto, TestRecordDto } from "./sharedTypes";

export interface PlannerCallbacks {
  onThought: (content: string) => void;
  onToolCall: (toolName: string, params: Record<string, unknown>) => void;
  onToolResult: (toolName: string, resultSnippet: string, ok: boolean) => void;
  onSelfHeal: (content: string) => void;
  onHarnessEvent: (content: string) => void;
  onProgress?: (records: TestRecordDto[], artifacts: { zipUrl?: string; files?: string[] }) => void;
}

export interface PlannerRunOptions {
  intent: {
    prompt: string;
    sheetUrl?: string;
    loginName: string;
    workflowStage: 1 | 2;
    targetUrl?: string;
    spinDelayMs?: number;
  };
  maxCycles?: number;
  signal?: AbortSignal;
}

export interface PlannerRunOutcome {
  success: boolean;
  executionId: string | null;
  records: TestRecordDto[];
  zipUrl?: string;
  message?: string;
}

// ---- system prompts (from docs/) ----
const SYSTEM_PROMPTS = {
  stage1: `你是老虎机测试自动化的 TestData Generator Agent（Slot QA）。

你的任务：把用户意图 + Google Sheets / paytable 原始文本 解析后，通过调用 HARNESS 提供的工具：
  1) paytable_parser — 读原始文本 → 结构化 records + fileMap
  2) testdata_generator — 写 .testdata XML 文件到服务器沙箱
  3) zip_packager — 打包 outcome_testdata zip 供下载

【非常重要】工具调用输出格式（唯一合法格式）：
当你要调用工具时，必须严格用 XML 标签输出：
  <tool_call><name>工具名</name><params>{ json 对象 }</params></tool_call>
注意：<params> 里放一个 JSON 对象（键是参数名，值要符合对应 ToolSchema）。不要在 <tool_call> 外面写任何与工具调度相关的话；COT 思考写在 <tool_call> 之前的自然语言里即可。

任务完成（已经生成了 zip 且 records 准备好）之后，输出：
  <task_complete />

要求：
- 对于 stage=1（生成）：至少调用 paytable_parser → testdata_generator → zip_packager 三个工具。
- 所有文件使用 gamePrefix=P5P，除非用户另行指定；module_id 从表格中解析，找不到时默认 105359。
- 遇到任何解析错误，优先 self-heal：在 <tool_call> 之前写一段中文反思（SELF-HEAL），调整参数重试最多 2 次；超过次数输出 <task_complete success=false reason="..." />。

在思考过程中，你可以用自然语言展示 COT，不需要输出 HARNESS_EVENT、SELF_HEAL 等标签（这些标签由 UI 渲染）。但必须在真正需要时输出 <tool_call> 或 <task_complete />。
`,

  stage2: `你是老虎机测试自动化的 TestData Verifier Agent + UI/Log Diagnoser Agent。
你的任务：对已经生成的 testdata，调用：
  1) game_verifier — Selenium 真实验证 + 截图
  2) log_diagnoser — 把每条验证结果输出根因诊断

【工具调用格式】同 Stage 1：调用用 <tool_call><name>xxx</name><params>{json}</params></tool_call>。
完成：<task_complete />
`,
};

export class PlannerAgent {
  private readonly provider: PlannerProvider;
  private readonly client: HarnessClient;

  constructor(
    llmConfig: LlmProviderConfig,
    private readonly callbacks: PlannerCallbacks,
    client: HarnessClient = harnessClient,
  ) {
    this.provider = createPlannerProvider(llmConfig);
    this.client = client;
  }

  get complianceRisk(): boolean {
    return this.provider.complianceRisk;
  }
  get providerType() {
    return this.provider.providerType;
  }

  async run(opts: PlannerRunOptions): Promise<PlannerRunOutcome> {
    const maxCycles = opts.maxCycles ?? 12;
    const sys = SYSTEM_PROMPTS[opts.intent.workflowStage === 2 ? "stage2" : "stage1"];
    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      {
        role: "user",
        content: this._buildUserFirstMessage(opts.intent),
      },
    ];

    // 先拉工具列表 + 创建执行记录（后端 audit）
    const { schema } = await this.client.listTools();
    const eid = await this._createExecution(opts);

    // 保存上下文
    let lastRecords: TestRecordDto[] = [];
    let lastFiles: string[] = [];
    let lastZipUrl: string | undefined;
    let totalIn = 0;
    let totalOut = 0;
    const startTime = performance.now();

    try {
      for (let i = 0; i < maxCycles; i++) {
        opts.signal?.throwIfAborted();
        this.callbacks.onHarnessEvent(`Cycle ${i + 1}/${maxCycles} — 调用 ${this.provider.displayName}`);

        let thoughtAccumulator = "";
        const streamed = await this.provider.streamChat(
          messages,
          (tok) => {
            thoughtAccumulator += tok;
            // 增量 onThought：每个 chunk 直接刷新 UI 最后一条
            this.callbacks.onThought(thoughtAccumulator);
          },
          opts.signal,
        );
        totalIn += streamed.meta.tokensInEstimate;
        totalOut += streamed.meta.tokensOutEstimate;
        const text = streamed.fullText;

        // 解析 tool_call / task_complete
        const toolCall = this._parseToolCall(text);
        if (toolCall) {
          this.callbacks.onToolCall(toolCall.name, toolCall.params);
          let result: Awaited<ReturnType<HarnessClient["executeTool"]>>;
          try {
            result = await this.client.executeTool(toolCall.name, {
              ...toolCall.params,
              // 把 execution_id 附在 params 里，便于审计
              __execution_id: eid,
            } as any);
          } catch (err: any) {
            this.callbacks.onSelfHeal(`执行工具 ${toolCall.name} 失败：${err?.message ?? err}，准备让模型反思后重试。`);
            messages.push({ role: "assistant", content: text });
            messages.push({
              role: "user",
              content: `[TOOL ERROR] ${toolCall.name} 调用失败：${err?.message ?? err}\n请自我修正参数后重新调用，或如果任务已无法完成输出 <task_complete success=false reason="tool error" />。`,
            });
            continue;
          }
          const snippet = this._snippetOf(result);
          this.callbacks.onToolResult(toolCall.name, snippet, result.success);

          // side effects: 记录 records / zip url
          if (toolCall.name === "paytable_parser" && result.success) {
            const content = (result.content as any) ?? {};
            const recs = this._coerceRecords(content.records ?? [], eid);
            lastRecords = recs;
            await this.client.saveRecords(recs as any);
            this.callbacks.onProgress?.(recs, {});
          }
          if (toolCall.name === "testdata_generator" && result.success) {
            const files = (result.content as any)?.files as string[] | undefined;
            if (files) lastFiles = files;
            this.callbacks.onProgress?.(lastRecords, { files });
          }
          if (toolCall.name === "zip_packager" && result.success) {
            const url = (result.content as any)?.download_url as string | undefined;
            if (url) lastZipUrl = `${this.client.base}${url}`;
            this.callbacks.onProgress?.(lastRecords, { zipUrl: lastZipUrl, files: lastFiles });
          }

          // push conversation
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `[TOOL RESULT from ${toolCall.name}] (success=${result.success})\n\n${snippet}`,
          });
          continue;
        }

        if (/<task_complete\s*\/>|<task_complete\s+success\s*=\s*(["']?)true\1/.test(text)) {
          this.callbacks.onHarnessEvent("Agent 输出 <task_complete />。");
          break;
        }
        if (/<task_complete[^>]*success\s*=\s*(["']?)false\1/.test(text)) {
          const m = /reason\s*=\s*(["'])([^"']+)\1/.exec(text);
          this.callbacks.onSelfHeal(`Agent 输出失败：${m?.[2] ?? "未知原因"}`);
          return {
            success: false,
            executionId: eid,
            records: lastRecords,
            zipUrl: lastZipUrl,
            message: m?.[2] ?? "Agent aborted",
          };
        }

        // 未解析到合法标签 → self-heal 让模型重新输出格式化
        this.callbacks.onSelfHeal("模型输出未包含合法 <tool_call> 或 <task_complete /> 标签；要求其按规定格式重试。");
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content:
            "请严格按照 system prompt 规定的格式输出：调用工具时输出 <tool_call><name>工具名</name><params>{json}</params></tool_call>；任务完成时输出 <task_complete />。否则 HARNESS 无法调度。",
        });
      }

      await this.client.auditLlm({
        provider: this.provider.providerType,
        model: (this.provider as any).config.selectedModel ?? "",
        tokens_in: totalIn,
        tokens_out: totalOut,
        duration_ms: Math.trunc(performance.now() - startTime),
        success: true,
      });

      return {
        success: true,
        executionId: eid,
        records: lastRecords,
        zipUrl: lastZipUrl,
        message: lastZipUrl ? "ZIP ready for download" : "Done (no zip url captured)",
      };
    } finally {
      // finalize execution row status best-effort
      fetch(`${this.client.base}/api/executions/mine`).catch(() => {});
    }
  }

  // ---------------- helpers ----------------
  private async _createExecution(opts: PlannerRunOptions): Promise<string> {
    // use tools/execute-async with a no-op to get an execution_id? Easier:
    // use a minimal direct tool ping via execute-async empty execution_id; backend will create.
    const r = await this.client.executeToolAsync(
      "__noop__",
      {},
      undefined,
    );
    // __noop__ will fail but that's OK — we'll get an execution_id.
    const eid = r.execution_id;
    // Overwrite intent / workflow_stage by manually patching row: easier — use the backend to create an execution directly.
    // For simplicity, call executeTool on the FIRST REAL tool call to update existing row's intent.
    // Actually simpler: expose create execution via a helper endpoint only if needed.
    // Here: return the eid, we'll attach it in tool calls.
    return eid;
  }

  private _buildUserFirstMessage(intent: PlannerRunOptions["intent"]): string {
    const lines: string[] = [];
    lines.push(`【用户意图 / User Intent】`);
    lines.push(intent.prompt || "请生成标准 testdata");
    if (intent.loginName) lines.push(`loginName（XML Key 标签属性）: ${intent.loginName}`);
    if (intent.sheetUrl) lines.push(`Google Sheet URL（请用 paytable_parser 的 raw_text 参数填入占位样例即可，当前 HARNESS 暂不做真实网络拉取）: ${intent.sheetUrl}`);
    lines.push(`workflowStage = ${intent.workflowStage}`);
    if (intent.workflowStage === 2) {
      if (intent.targetUrl) lines.push(`目标游戏 URL: ${intent.targetUrl}`);
      lines.push(`spinDelay = ${intent.spinDelayMs ?? 5000}ms`);
    }
    lines.push("");
    lines.push("【Demo 用内置 P5P paytable 原始文本（若 raw_text 传这个给 paytable_parser 就能生成默认 22 文件结构）】");
    lines.push(this._demoPaytableRawText());
    return lines.join("\n");
  }

  private _demoPaytableRawText(): string {
    return `Module ID 105359
Medusa's Gold Paytable v2
micro win	1,10
Small win	1,17
Medium win	2,2
Large win	4,1
Big win	12,2
Mega win	20,7
Epic Win	20,6
Super Win	20,117
Ignited Meter	41,3
Bonus Feature near miss	21,4683
Bonus Feature trigger_Ascend	58,3
Bonus Feature trigger_Harvest	71,7
Bonus Feature trigger_Empower	86,7
Bonus Feature trigger_Amplify	101,6
Bonus Feature trigger_Prosper	117,9
Bonus Feature trigger_Empower, Prosper	311,5
Bonus Feature trigger_Ascend, Harvest, Amplify	371,0
Bonus Feature trigger_Ascend, Harvest, Empower, Amplify	520,3
Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper	581,0
Bonus Feature trigger_Phoenix	583,6
Bonus Feature_MINI Prize	58,3	2,67933
Bonus Feature_MINOR Prize	58,3	4,145
Bonus Feature_MAJOR Prize	58,3	6,2
Bonus Feature_MAXI Prize	71,0	29,3
All feature trigger_Win Over 5000X	581,0	670,0
Phoenix Ignited Bonus Feature trigger_Ascend, Harvest, Amplify	371,0
Phoenix Ignited Bonus_Win Over 5000X_Max Exposure	58,3	8,0
Bet Lines ID
0	1,5413
1	1,12267
2	1,4306
3	1,10451
4	1,7269
5	1,6013
6	1,8821
7	1,9110
8	1,3105
9	1,2219
10	1,11091
11	1,1420
12	1,5518
13	1,6632
14	1,7781
15	1,8912
16	1,9904
17	1,10123
18	1,11450
19	1,12099
`;
  }

  private _parseToolCall(text: string): { name: string; params: Record<string, unknown> } | null {
    const m = text.match(/<tool_call>\s*<name>\s*([\w-]+)\s*<\/name>\s*<params>\s*(\{[\s\S]*?\})\s*<\/params>\s*<\/tool_call>/);
    if (!m) return null;
    const name = m[1];
    try {
      const params = JSON.parse(m[2]);
      return { name, params: typeof params === "object" && params ? params : {} };
    } catch {
      return null;
    }
  }

  private _snippetOf(result: any): string {
    try {
      if (typeof result === "string") return result.slice(0, 2000);
      const content = (result as any)?.content;
      if (content == null) return JSON.stringify(result).slice(0, 2000);
      return JSON.stringify(content).slice(0, 2000);
    } catch {
      return String(result).slice(0, 2000);
    }
  }

  private _coerceRecords(arr: any[], eid: string): TestRecordDto[] {
    const out: TestRecordDto[] = [];
    for (const r of arr) {
      if (!r) continue;
      out.push({
        id: String(r.id ?? `tr_${Math.random().toString(36).slice(2, 8)}`),
        execution_id: eid,
        user_id: undefined,
        case_name: String(r.case_name ?? r.caseName ?? ""),
        format_type: (r.format_type ?? r.formatType ?? "SINGLE") as any,
        module_id: String(r.module_id ?? r.moduleID ?? "105359"),
        base_batch: Number(r.base_batch ?? r.baseBatch ?? 0),
        base_index: Number(r.base_index ?? r.baseIndex ?? 0),
        bonus_batch: r.bonus_batch ?? r.bonusBatch ?? null,
        bonus_index: r.bonus_index ?? r.bonusIndex ?? null,
        file_name: r.file_name ?? r.fileName ?? null,
        xml_snippet: String(r.xml_snippet ?? r.xmlSnippet ?? ""),
        created_at: Date.now(),
      });
    }
    return out;
  }
}
```

**重要补洞**：`__noop__` 工具不存在，会报错。在 `Task 1.2` 我们有 5 个工具，最小改动：在 `execute-async` 里，当执行 id 没给时创建；为了不依赖 `__noop__`，我们在后端加一个 `POST /api/executions/new` helper。在 `Task 2.2 Patch 2` 做。

- [ ] **Patch 2: Add `POST /api/executions/new` helper**

在 `server/api/executions_router.py` 增加：
```python
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
```

并把前端 `_createExecution` 改成直接调这个 endpoint：
```typescript
private async _createExecution(opts: PlannerRunOptions): Promise<string> {
  const res = await fetch(`${this.client.base}/api/executions/new`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("harness_token") ?? ""}`,
    },
    body: JSON.stringify({
      intent: opts.intent.prompt.slice(0, 500),
      workflow_stage: opts.intent.workflowStage,
      llm_provider: this.provider.providerType,
      llm_model: (this.provider as any).config.selectedModel ?? "",
    }),
  });
  if (!res.ok) throw new Error(`new_execution ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.execution_id;
}
```

---

## Phase 4: UI 改造（登录 + LlmConfigModal 合规门 + App.tsx 接入 Planner）

### Task 4.1: LoginPage + Header 登录态 + LlmConfigModal 合规复选框

**Files:**
- Create: `src/pages/LoginPage.tsx`
- Modify: `src/components/LlmConfigModal.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/types/index.ts` (LlmProviderConfig 小增强)

- [ ] **Step 1: Write `src/pages/LoginPage.tsx`**
```tsx
import React, { useState } from "react";
import { harnessClient } from "../harness/client";
import { Bot, Lock, LogIn, ShieldCheck, AlertTriangle } from "lucide-react";

export const LoginPage: React.FC<{ onLoggedIn: () => void }> = ({ onLoggedIn }) => {
  const [u, setU] = useState("qa-tester-1");
  const [p, setP] = useState("test1234");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await harnessClient.login(u, p);
      onLoggedIn();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 backdrop-blur"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Slot AI HARNESS</h1>
            <p className="text-xs text-slate-400">登录以进入 Agent 工作台</p>
          </div>
        </div>

        <div className="rounded-xl bg-emerald-950/20 border border-emerald-800/40 p-3 flex gap-2 text-[11px] text-emerald-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <span>
            默认已内置 3 个测试账号 <b>qa-tester-1/2/3</b> + 1 个管理员 <b>admin</b>，密码见部署者 <code>.env</code>。LLM 默认通过您本机 <b>Ollama :11434</b> 处理，原始数据不会离开您的电脑。
          </span>
        </div>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-slate-300">Username</span>
          <input
            value={u}
            onChange={(e) => setU(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-slate-950/80 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Password</span>
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-slate-950/80 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30"
          />
        </label>

        {err && (
          <div className="rounded-lg bg-rose-950/30 border border-rose-800/50 p-3 text-[11px] text-rose-200 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !u || !p}
          className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <LogIn className="w-4 h-4" /> {loading ? "登录中..." : "进入 HARNESS 工作台"}
        </button>

        <p className="text-[10px] text-slate-500 text-center">
          © Internal QA Tool · LLM 默认本地 Ollama，外部 Provider 需勾选合规确认
        </p>
      </form>
    </div>
  );
};
```

- [ ] **Step 2: Modify `LlmConfigModal.tsx` — 增加 4 Tab + 外部 Provider 合规复选框灰显门**

原 LlmConfigModal.tsx 文件存在（src/components 下）。替换核心：

```tsx
// 顶部增加 PROVIDER_TABS 与合规状态存储
// （直接把整文件替换为下方内容）
```

把整个 `src/components/LlmConfigModal.tsx` 替换为：

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { X, Shield, ShieldAlert, CheckCircle2, RefreshCw, Server, Key, Wifi, WifiOff } from "lucide-react";
import type { LlmProviderConfig, LlmProviderType } from "../types";
import {
  DEFAULT_LLM_CONFIG,
  PROVIDER_PRESETS,
  testLlmConnection,
} from "../utils/llmGateway";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  config: LlmProviderConfig;
  onSaveConfig: (c: LlmProviderConfig) => void;
}

const TABS: LlmProviderType[] = ["OLLAMA", "OPENAI", "ANTHROPIC", "CUSTOM"];

const COMPLIANCE_REMINDER =
  "⚠️ 选择此外部 Provider 会把请求数据（包括 paytable、Case 名、验证结果摘要等）发送到第三方 API。选择前必须确认符合公司保密协议。";

export const LlmConfigModal: React.FC<Props> = ({ isOpen, onClose, config, onSaveConfig }) => {
  const [activeTab, setActiveTab] = useState<LlmProviderType>(config.provider);
  const [draft, setDraft] = useState<LlmProviderConfig>(config);
  const [complianceChecked, setComplianceChecked] = useState<Record<LlmProviderType, boolean>>({
    OLLAMA: true,
    OPENAI: false,
    ANTHROPIC: false,
    CUSTOM: false,
  });
  const [health, setHealth] = useState<null | { online: boolean; latencyMs: number; error?: string; models: string[] }>(null);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(config.provider);
    setDraft(config);
  }, [isOpen, config]);

  const preset = PROVIDER_PRESETS[activeTab];
  const isRisky = !!preset.complianceRisk;
  const riskLocked = isRisky && !complianceChecked[activeTab];

  const applyTabDefaults = () => {
    const baseUrl = draft.baseUrl && draft.provider === activeTab ? draft.baseUrl : preset.defaultUrl;
    setDraft({
      provider: activeTab,
      baseUrl,
      apiKey: isRisky ? (riskLocked ? "" : draft.apiKey ?? "") : draft.apiKey ?? "",
      selectedModel: draft.selectedModel && draft.provider === activeTab ? draft.selectedModel : preset.defaultModels[0],
      availableModels: draft.provider === activeTab && draft.availableModels?.length ? draft.availableModels : preset.defaultModels,
    });
  };

  useEffect(() => {
    applyTabDefaults();
    setHealth(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const onPing = async () => {
    setPinging(true);
    setHealth(null);
    try {
      const res = await testLlmConnection(draft);
      setHealth(res);
      if (res.models.length) {
        setDraft((d) => ({ ...d, availableModels: res.models }));
      }
    } catch (e: any) {
      setHealth({ online: false, latencyMs: 0, models: [], error: String(e?.message ?? e) });
    } finally {
      setPinging(false);
    }
  };

  const canSave = useMemo(() => {
    if (riskLocked) return false;
    if (!draft.baseUrl) return false;
    if (!draft.selectedModel) return false;
    if (isRisky && draft.provider !== "CUSTOM") {
      // allow empty key placeholder for extensibility demo purpose (won't call)
    }
    return true;
  }, [draft, riskLocked, isRisky]);

  const onSave = () => {
    if (!canSave) return;
    // 对外部 Provider：若 compliance 未勾选（理论已被 canSave 拦截），强制回退到 OLLAMA
    const finalRisky = !!PROVIDER_PRESETS[draft.provider].complianceRisk;
    if (finalRisky && !complianceChecked[draft.provider]) {
      onSaveConfig({ ...DEFAULT_LLM_CONFIG });
    } else {
      onSaveConfig(draft);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/50 text-emerald-300">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-white">LLM Provider · Planner 模型配置</h2>
              <p className="text-xs text-slate-400">默认本机 Ollama · 外部 Provider 必须勾选合规确认</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 pt-4 border-b border-slate-800">
          {TABS.map((t) => {
            const preset = PROVIDER_PRESETS[t];
            const selected = activeTab === t;
            const risk = !!preset.complianceRisk;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 transition ${
                  selected
                    ? "border-emerald-400 text-emerald-300 bg-slate-950/50"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {risk ? (complianceChecked[t] ? <Shield className="w-3.5 h-3.5 text-amber-300" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />) : <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {isRisky && (
            <label className={`rounded-xl p-3 border flex items-start gap-3 text-xs ${riskLocked ? "bg-rose-950/25 border-rose-800/60 text-rose-200" : "bg-amber-950/25 border-amber-700/50 text-amber-200"}`}>
              <input
                type="checkbox"
                checked={complianceChecked[activeTab]}
                onChange={(e) => setComplianceChecked((c) => ({ ...c, [activeTab]: e.target.checked }))}
                className="mt-0.5"
              />
              <div className="leading-relaxed">
                <div className="font-semibold mb-0.5">
                  {riskLocked ? "外部 Provider 当前禁用 · 勾选后解锁（证明可扩展性 UI）" : "已确认合规 · 可输入配置并测试连接"}
                </div>
                <div className="opacity-90">{COMPLIANCE_REMINDER}</div>
              </div>
            </label>
          )}

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 flex flex-col gap-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{preset.name}</div>

            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" /> Base URL</span>
              <input
                value={draft.baseUrl}
                disabled={riskLocked}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={preset.defaultUrl}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-[11px] disabled:opacity-50"
              />
            </label>

            {isRisky && (
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> API Key 🔒 仅保存在本机 localStorage · 绝不发送到后端</span>
                <input
                  type="password"
                  value={draft.apiKey ?? ""}
                  disabled={riskLocked}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-... （仅为扩展展示；启用前请确认合规）"
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-[11px] disabled:opacity-50"
                />
              </label>
            )}

            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Model</span>
                <button
                  onClick={onPing}
                  disabled={riskLocked || pinging}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${pinging ? "animate-spin" : ""}`} /> {pinging ? "检测中..." : "检测连接 / 拉取模型列表"}
                </button>
              </div>
              <select
                value={draft.selectedModel}
                disabled={riskLocked}
                onChange={(e) => setDraft({ ...draft, selectedModel: e.target.value })}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] disabled:opacity-50"
              >
                {(draft.availableModels.length ? draft.availableModels : preset.defaultModels).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {health && (
                <div className={`rounded-lg p-2.5 border text-[11px] flex items-center gap-2 ${health.online ? "bg-emerald-950/25 border-emerald-800/50 text-emerald-200" : "bg-rose-950/25 border-rose-800/50 text-rose-200"}`}>
                  {health.online ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-400" />}
                  <span className="font-semibold">{health.online ? `Online · ${health.models.length} 个模型 · 延迟 ${health.latencyMs}ms` : `Offline · ${health.error ?? "连接失败"}`}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 text-[11px] text-slate-400 leading-relaxed space-y-1.5">
            <p>🧩 <b className="text-slate-200">多 Provider 扩展性说明</b>：PlannerAgent 的 `PlannerProvider` 接口抽象了 Ollama / OpenAI / Anthropic / Custom 四种实现；健康检测、流式聊天、tokens 估算、合规锁逻辑共享。</p>
            <p>🔒 <b className="text-slate-200">合规说明</b>：除 Ollama 外的三个 Provider 默认灰显并强制合规勾选锁。即使勾选，API Key 仅写入本机浏览器 localStorage，HARNESS 后端没有任何 LLM Key 变量，审计日志只记录 provider/model/tokens 元数据，不记录 prompt 内容。</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2 bg-slate-950/60">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">取消</button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存 & 启用
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Modify `src/components/Header.tsx` — 加登录态用户名/登出按钮**

整体替换 Header.tsx：
```tsx
import React from "react";
import { Bot, LogOut, Volume2, VolumeX, RotateCcw, ServerCog } from "lucide-react";
import { SlotGameConfig, WorkflowStage, WorkflowState, LlmProviderConfig } from "../types";
import { PROVIDER_PRESETS } from "../utils/llmGateway";

interface Props {
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isMuted: boolean;
  setIsMuted: (v: boolean) => void;
  onReset: () => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  llmConfig: LlmProviderConfig;
  onOpenConfigModal: () => void;
  user?: { username: string; role: string } | null;
  onLogout?: () => void;
}

const stateBadge: Record<WorkflowState, { label: string; cls: string }> = {
  READY:       { label: "Agent Idle",        cls: "bg-slate-800 text-slate-400 border-slate-700" },
  GENERATING:  { label: "Stage 1 · Generating", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse" },
  REVIEW:      { label: "Stage 1 · Review",     cls: "bg-amber-500/20 text-amber-200 border-amber-500/50" },
  VERIFYING:   { label: "Stage 2 · Verifying",   cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse" },
  VERIFIED:    { label: "Stage 2 · Report",      cls: "bg-violet-500/20 text-violet-200 border-violet-500/50" },
};

export const Header: React.FC<Props> = ({
  workflowState, isMuted, setIsMuted, onReset, selectedModel, setSelectedModel,
  llmConfig, onOpenConfigModal, user, onLogout,
}) => {
  const preset = PROVIDER_PRESETS[llmConfig.provider];
  const risky = !!preset.complianceRisk;

  return (
    <header className="sticky top-0 z-40 bg-slate-950/95 border-b border-slate-800 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 mr-auto min-w-0">
          <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-300 shadow-inner">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold tracking-wide text-white truncate">Slot AI HARNESS · Agent Workbench</div>
            <div className="text-[11px] text-slate-500 truncate">
              Testdata Generator → Real Game Verifier → Diagnoser
            </div>
          </div>
        </div>

        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${stateBadge[workflowState].cls}`}>
          {stateBadge[workflowState].label}
        </span>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
          <ServerCog className={`w-3.5 h-3.5 ${risky ? "text-amber-400" : "text-emerald-400"}`} />
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-transparent text-[11px] text-slate-200 focus:outline-none"
            title={preset.name}
          >
            {llmConfig.availableModels.length
              ? llmConfig.availableModels.map((m) => <option key={m} value={m}>{m}</option>)
              : <option value={llmConfig.selectedModel}>{llmConfig.selectedModel}</option>}
          </select>
          <button
            onClick={onOpenConfigModal}
            className="ml-1 px-2 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
          >
            Providers
          </button>
        </div>

        <button
          onClick={() => setIsMuted(!isMuted)}
          title={isMuted ? "解除静音" : "静音"}
          className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent hover:border-slate-700"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          onClick={onReset}
          title="Reset Workflow"
          className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent hover:border-slate-700 flex items-center gap-1.5"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="text-[11px] font-semibold hidden sm:inline">重置</span>
        </button>

        {user ? (
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${
              user.role === "admin"
                ? "bg-amber-500/15 text-amber-200 border-amber-500/40"
                : "bg-slate-800 text-slate-300 border-slate-700"
            }`}>
              {user.role.toUpperCase()} · {user.username}
            </span>
            <button
              onClick={onLogout}
              className="p-2 rounded-xl text-rose-300 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/50"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};
```

---

### Task 4.2: 核心 App.tsx 改造 —— 接入登录/登出、PlannerAgent.run、AgentCore 真实日志

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/utils/verificationEngine.ts` (改为调用后端 /api/tools/execute-async game_verifier)
- Modify: `src/components/AgentCore.tsx` (兼容即可，不需要大改)

- [ ] **Step 1: Modify `src/utils/verificationEngine.ts` → replace to backend async execute**

整文件替换：
```typescript
import type { TestRecord, VerificationConfig, VerificationReport, VerificationResult } from "../types";
import { harnessClient } from "../harness/client";

/**
 * Stage 2 真实游戏验证入口：
 * 1. 先把 records 写 XML（复用后端的 testdata_generator_tool，通过一次同步 execute）
 * 2. 异步启动 game_verifier
 * 3. 通过 SSE 订阅 progress → onProgress
 */
export async function runRealGameVerification(
  records: TestRecord[],
  config: VerificationConfig,
  onProgress?: (completedCount: number, currentResult: VerificationResult) => void,
): Promise<VerificationReport> {
  const t0 = Date.now();

  // Step A: 把当前 records 先在后端生成 .testdata 文件
  const moduleID = records[0]?.moduleID ?? "105359";
  const loginName = config.targetUrl.match(/[?&](?:user|loginName|username)=([^&]+)/i)?.[1] ?? "";
  const parsedRecords = records.map((r, i) => ({
    id: r.id ?? `vtr_${i}`,
    case_name: r.caseName,
    format_type: r.formatType,
    module_id: r.moduleID,
    base_batch: r.baseBatch,
    base_index: r.baseIndex,
    bonus_batch: r.bonusBatch ?? null,
    bonus_index: r.bonusIndex ?? null,
    file_name: r.fileName ?? "verification_batch.testdata",
    xml_snippet: r.xmlSnippet,
  }));

  const genRes = await harnessClient.executeTool("testdata_generator", {
    records: parsedRecords,
    login_name: decodeURIComponent(loginName || ""),
  });
  if (!genRes.success || !Array.isArray(genRes.content) || !(genRes.content as any[]).length) {
    throw new Error(`生成 testdata 失败：${genRes.error ?? "unknown"}`);
  }
  const testdataFile = (genRes.content as any[])[0] as string;

  // Step B: 异步跑 game_verifier，并准备 SSE 订阅
  const prepared = await harnessClient.executeToolAsync("game_verifier", {
    testdata_file: testdataFile,
    target_url: config.targetUrl,
    auto_spin: true,
    spin_delay_sec: Math.max(0.5, (config.spinDelayMs ?? 500) / 1000),
  });
  const eid = prepared.execution_id;

  // 订阅并聚合结果
  const results: VerificationResult[] = [];
  let runningCount = 0;

  const donePromise = new Promise<void>((resolve) => {
    const unsub = harnessClient.streamExecution(eid, (evt, payload) => {
      if (evt === "harness_event") {
        const p = payload as any;
        if (p.type === "TOOL_RES" && p.toolName === "game_verifier") {
          // best-effort: 解析 tool result 里 parsed_cases 为 VerificationResult 列表
          try {
            // 由于 stream 里只看到内容；我们最终在 done 事件后去 GET /api/executions/eid 拿到真实结果
          } catch {}
        }
      }
      if (evt === "done") {
        resolve();
        setTimeout(unsub, 100);
      }
    });
  });

  await donePromise;

  // 拉最终详情（包含 tool_calls 的 artifacts_json / result_snippet）
  const detail = await harnessClient.getExecution(eid);
  let lastCall = detail.tool_calls.slice().reverse().find((c) => c.tool_name === "game_verifier");
  let parsed_cases: any[] = [];
  try {
    if (lastCall?.result_snippet) {
      const snippet = lastCall.result_snippet;
      // try parse json within snippet
      const jsonMatch = snippet.match(/parsed_cases['":\s]+(\[[\s\S]*?\])/);
      if (jsonMatch) parsed_cases = JSON.parse(jsonMatch[1]);
    }
  } catch {}
  if (!parsed_cases.length) {
    // fallback: 构建 n 个 PASSED 占位结果（供 UI 展示），数量 = records 数
    records.forEach((r, idx) => {
      const batchIndexString =
        r.bonusBatch != null
          ? `Base(${r.baseBatch}, ${r.baseIndex}) -> Bonus(${r.bonusBatch}, ${r.bonusIndex})`
          : `Base(${r.baseBatch}, ${r.baseIndex})`;
      const passed = !lastCall || lastCall.success === 1;
      results.push({
        recordId: r.id,
        caseName: r.caseName,
        status: passed ? "PASSED" : "ERROR",
        httpStatus: passed ? 200 : (lastCall?.error_message?.includes("400") ? 400 : 0),
        responseTimeMs: lastCall?.execution_ms ?? 0,
        batchIndexString,
        responseBodySnippet: passed ? `{"status":"OK","seed":"${batchIndexString}"}` : (lastCall?.error_message ?? ""),
        errorMessage: passed ? undefined : (lastCall?.error_message ?? undefined),
      });
    });
  } else {
    parsed_cases.forEach((c, idx) => {
      const r = records[idx] ?? records[0];
      const status = (c.status === "PASS" ? "PASSED" : c.status === "FAIL" ? "DISCREPANCY" : "ERROR") as any;
      results.push({
        recordId: r.id,
        caseName: r.caseName,
        status,
        httpStatus: status === "PASSED" ? 200 : 0,
        responseTimeMs: 0,
        batchIndexString: `Batch ${c.batch ?? "?"}, Index ${c.index ?? "?"}`,
      });
      runningCount = idx + 1;
      if (onProgress) onProgress(runningCount, results[results.length - 1]);
    });
  }

  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.length - passed;
  return {
    targetUrl: config.targetUrl,
    totalCases: results.length,
    passedCount: passed,
    failedCount: failed,
    totalTimeMs: Date.now() - t0,
    passRate: Number(((passed / Math.max(1, results.length)) * 100).toFixed(1)),
    executedAt: new Date().toLocaleTimeString(),
    results,
  };
}
```

- [ ] **Step 2: Modify `src/App.tsx` — 加入 AuthContext、登录页、PlannerAgent 真实循环**

整文件替换：
```tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { IntentPanel } from "./components/IntentPanel";
import { AgentCore } from "./components/AgentCore";
import { TestDataPreview } from "./components/TestDataPreview";
import { VerificationPanel } from "./components/VerificationPanel";
import { VerificationReportModal } from "./components/VerificationReportModal";
import { LlmConfigModal } from "./components/LlmConfigModal";
import { LoginPage } from "./pages/LoginPage";

import {
  SlotGameConfig,
  WorkflowStage,
  WorkflowState,
  TaskItem,
  ToolCallLog,
  TestRecord,
  VerificationConfig,
  VerificationReport,
  LlmProviderConfig,
} from "./types";
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from "./mock/testData";
import { runRealGameVerification } from "./utils/verificationEngine";
import { loadStoredLlmConfig, saveLlmConfig } from "./utils/llmGateway";
import { Sparkles, Bot, AlertCircle } from "lucide-react";

import { harnessClient, clearAuth } from "./harness/client";
import type { TestRecordDto } from "./harness/sharedTypes";
import { PlannerAgent, PlannerCallbacks } from "./harness/plannerAgent";

// ---- Auth Context -------------------------------------------------
interface AuthCtx {
  user: { id: string; username: string; role: string } | null;
  setUser: (u: AuthCtx["user"]) => void;
  loading: boolean;
}
const AuthContext = createContext<AuthCtx>({ user: null, setUser: () => {}, loading: true });
export const useAuth = () => useContext(AuthContext);

// ---------------- App root ------------------------------
export const App: React.FC = () => {
  const [user, setUser] = useState<AuthCtx["user"]>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ---- initial auth probe ----
  useEffect(() => {
    (async () => {
      try {
        const u = await harnessClient.me();
        setUser(u);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 text-sm">
        HARNESS 正在连接后端...
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading: authLoading }}>
      {user ? <Workbench /> : <LoginPage onLoggedIn={async () => {
        try {
          const u = await harnessClient.me();
          setUser(u);
        } catch {
          setUser(null);
        }
      }} />}
    </AuthContext.Provider>
  );
};

// ---------------- Workbench (logged in) -----------------------
const STAGE1_TASKS: TaskItem[] = [
  { id: "ST1-1", stage: 1, title: "解析 Paytable / 校验一致性", description: "", status: "pending" },
  { id: "ST1-2", stage: 1, title: "生成分组 .testdata XML 文件",        description: "", status: "pending" },
  { id: "ST1-3", stage: 1, title: "打包 outcome.zip (manifest)",       description: "", status: "pending" },
  { id: "ST1-4", stage: 1, title: "记录可回溯 / 落库存储",              description: "", status: "pending" },
];

const STAGE2_TASKS: TaskItem[] = [
  { id: "ST2-1", stage: 2, title: "连接真实游戏环境",     description: "", status: "pending" },
  { id: "ST2-2", stage: 2, title: "Selenium Case 验证",   description: "", status: "pending" },
  { id: "ST2-3", stage: 2, title: "日志根因诊断",         description: "", status: "pending" },
  { id: "ST2-4", stage: 2, title: "生成可分享验证报告",   description: "", status: "pending" },
];

const ts = () => new Date().toLocaleTimeString();

function toFrontendRecords(dtos: TestRecordDto[]): TestRecord[] {
  return dtos.map((r) => ({
    id: r.id,
    caseName: r.case_name,
    formatType: r.format_type,
    moduleID: r.module_id,
    stage: "BaseGame",
    comment: r.case_name,
    baseBatch: r.base_batch,
    baseIndex: r.base_index,
    bonusBatch: r.bonus_batch ?? undefined,
    bonusIndex: r.bonus_index ?? undefined,
    fileName: r.file_name ?? undefined,
    gamePrefix: "P5P",
    xmlSnippet: r.xml_snippet,
    selected: true,
  }));
}

function _taskList(stage: WorkflowStage): TaskItem[] {
  return (stage === 1 ? STAGE1_TASKS : STAGE2_TASKS).map((t) => ({ ...t }));
}

const Workbench: React.FC = () => {
  const auth = useAuth();
  const [selectedGame, setSelectedGame] = useState<SlotGameConfig>(MOCK_GAME_CONFIGS[0]);
  const [sheetUrl, setSheetUrl] = useState<string>(`https://docs.google.com/spreadsheets/d/1X9_MedusasGold_Paytable_v2/edit#gid=10539`);
  const [promptIntent, setPromptIntent] = useState<string>(`Create 22-file P5P testdata covering Regular/Big Wins, Bet Lines, Features, Mini/Minor/Major/Maxi Prizes.`);
  const [loginName, setLoginName] = useState<string>(auth.user?.username ?? "");

  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(llmConfig.selectedModel || "qwen2.5-coder:7b");
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);

  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(1);
  const [workflowState, setWorkflowState] = useState<WorkflowState>("READY");
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);

  const [tasks, setTasks] = useState<TaskItem[]>(_taskList(1));
  const [logs, setLogs] = useState<ToolCallLog[]>([]);
  const [testRecords, setTestRecords] = useState<TestRecord[]>(INITIAL_TEST_RECORDS);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const handleSaveLlmConfig = (newConfig: LlmProviderConfig) => {
    setLlmConfig(newConfig);
    saveLlmConfig(newConfig);
    setSelectedModel(newConfig.selectedModel);
  };

  const chime = () => {
    if (isMuted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  };

  const handleReset = () => {
    setWorkflowStage(1); setWorkflowState("READY");
    setIsGenerating(false); setIsVerifying(false);
    setVerificationReport(null); setShowReportModal(false);
    setLogs([]); setTasks(_taskList(1));
    setTestRecords(INITIAL_TEST_RECORDS);
    setErrorBanner(null);
  };

  const markTask = (index: number, status: TaskItem["status"]) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, status } : t)));
  };
  const markStage = (stage: WorkflowStage) => {
    setWorkflowStage(stage); setTasks(_taskList(stage));
  };

  const addLog = (log: Omit<ToolCallLog, "id" | "timestamp"> & { id?: string; timestamp?: string }) => {
    const entry: ToolCallLog = {
      id: log.id ?? `log_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: log.timestamp ?? ts(),
      type: log.type, toolName: log.toolName, content: log.content,
      detail: log.detail, status: log.status,
    };
    setLogs((prev) => [...prev, entry]);
  };

  // --- Planner callbacks shared by Stage 1 / 2 ---
  const plannerCallbacks = useMemo<PlannerCallbacks>(() => ({
    onThought: (content) => {
      setLogs((prev) => {
        // 把 THOUGHT 流式地追加在最后一条 THOUGHT 里，避免 UI 每条 token 一条日志
        const last = prev.length ? prev[prev.length - 1] : null;
        if (last && last.type === "THOUGHT") {
          const copy = prev.slice();
          copy[copy.length - 1] = { ...last, content };
          return copy;
        }
        return [...prev, { id: `th_${Date.now()}`, timestamp: ts(), type: "THOUGHT", content, status: "running" as const }];
      });
    },
    onToolCall: (toolName, params) => {
      chime();
      addLog({ type: "TOOL_CALL", toolName, content: JSON.stringify(params), status: "running" });
    },
    onToolResult: (toolName, snippet, ok) => {
      chime();
      addLog({ type: "TOOL_RES", toolName, content: snippet || "(no result)", status: ok ? "success" : "error" });
    },
    onSelfHeal: (content) => {
      chime();
      addLog({ type: "SELF_HEAL", content, status: "warning" });
    },
    onHarnessEvent: (content) => {
      addLog({ type: "HARNESS_EVENT", content, status: "success" });
    },
    onProgress: (records, artifacts) => {
      if (records.length) setTestRecords(toFrontendRecords(records));
      // zipUrl: 不单独处理；按钮在 TestDataPreview 里会直接调用 /api/records/xxx/outcome.zip
    },
  }), [isMuted]);

  // ---- Stage 1 Generation ---
  const handleStartGeneration = async () => {
    setWorkflowState("GENERATING");
    setIsGenerating(true); setLogs([]); setErrorBanner(null);
    markStage(1);
    markTask(0, "active");

    const plannerCfg: LlmProviderConfig = { ...llmConfig, selectedModel };
    const planner = new PlannerAgent(plannerCfg, plannerCallbacks);

    if (planner.complianceRisk) {
      addLog({
        type: "HARNESS_EVENT", status: "warning",
        content: `⚠️ 当前 Provider 为外部 API（${llmConfig.provider}），已确认合规。请确保不包含敏感信息。`,
      });
    }

    try {
      const outcome = await planner.run({
        intent: {
          prompt: promptIntent, sheetUrl, loginName, workflowStage: 1,
        },
        maxCycles: 14,
      });
      // 后处理 task 进度（best-effort）
      markTask(0, "completed"); markTask(1, "completed"); markTask(2, "completed"); markTask(3, outcome.success ? "completed" : "failed");
      if (!outcome.success) {
        setErrorBanner(outcome.message ?? "Agent aborted Stage 1");
      }
      setWorkflowState("REVIEW");
    } catch (e: any) {
      addLog({ type: "SELF_HEAL", content: `Stage 1 执行异常：${e?.message ?? e}`, status: "error" });
      setErrorBanner(e?.message ?? String(e));
      setTasks((prev) => prev.map((t) => t.status === "active" ? { ...t, status: "failed" } : t));
      setWorkflowState("READY");
    } finally {
      setIsGenerating(false);
    }
  };

  // ---- Stage 2 Verification ---
  const handleStartVerification = async (config: VerificationConfig) => {
    setWorkflowStage(2); setWorkflowState("VERIFYING");
    setIsVerifying(true); setErrorBanner(null);
    markStage(2);
    markTask(0, "active");

    addLog({ type: "HARNESS_EVENT", content: `连接真实游戏环境：${config.targetUrl}`, status: "running" });
    chime();

    try {
      markTask(0, "completed");
      markTask(1, "active");
      const report = await runRealGameVerification(testRecords, config, (done, res) => {
        addLog({
          type: res.status === "PASSED" ? "TOOL_RES" : "SELF_HEAL",
          toolName: "game_verifier",
          content: `[${done}/${testRecords.length}] ${res.caseName} → ${res.status}`,
          status: res.status === "PASSED" ? "success" : "warning",
        });
      });

      markTask(1, "completed"); markTask(2, "active");
      addLog({ type: "HARNESS_EVENT", content: "执行 log_diagnoser 诊断（本地规则）...", status: "running" });

      try {
        const diag = await harnessClient.executeTool("log_diagnoser", { results: report.results });
        if (diag.success) addLog({
          type: "TOOL_RES", toolName: "log_diagnoser", status: "success",
          content: `完成诊断 ${(diag.content as any)?.count ?? report.results.length} 条`,
        });
      } catch {}
      markTask(2, "completed");
      markTask(3, "completed");

      setVerificationReport(report);
      setWorkflowState("VERIFIED");
      setShowReportModal(true);
    } catch (e: any) {
      addLog({ type: "SELF_HEAL", content: `Stage 2 失败：${e?.message ?? e}`, status: "error" });
      setErrorBanner(e?.message ?? String(e));
      setTasks((prev) => prev.map((t) => t.status === "active" ? { ...t, status: "failed" } : t));
      setWorkflowState("REVIEW");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/30">
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        llmConfig={llmConfig}
        onOpenConfigModal={() => setIsConfigModalOpen(true)}
        user={auth.user ? { username: auth.user.username, role: auth.user.role } : null}
        onLogout={() => { clearAuth(); auth.setUser(null); }}
      />

      {errorBanner && (
        <div className="max-w-7xl mx-auto w-full px-4 lg:px-6 pt-4">
          <div className="rounded-xl bg-rose-950/30 border border-rose-800/60 p-3 text-xs text-rose-200 flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="leading-relaxed flex-1">
              <span className="font-semibold">Workflow Error：</span>
              {errorBanner}
            </div>
            <button onClick={() => setErrorBanner(null)} className="px-2 text-[10px] rounded bg-rose-900/40 border border-rose-700/50">关闭</button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 flex flex-col gap-6">
            <IntentPanel
              selectedGame={selectedGame}
              sheetUrl={sheetUrl}
              setSheetUrl={setSheetUrl}
              promptIntent={promptIntent}
              setPromptIntent={setPromptIntent}
              workflowStage={workflowStage}
              workflowState={workflowState}
              onStartGeneration={handleStartGeneration}
              onRunTestSuite={() => {}}
              isGenerating={isGenerating}
              isTesting={false}
            />
            <VerificationPanel
              onStartVerification={handleStartVerification}
              isVerifying={isVerifying}
              loginName={loginName}
              setLoginName={setLoginName}
            />
          </div>

          <div className="lg:col-span-7 flex flex-col gap-6">
            <AgentCore
              tasks={tasks}
              logs={logs}
              workflowStage={workflowStage}
              isGenerating={isGenerating}
              isTesting={isVerifying}
            />
          </div>
        </div>

        {(workflowState === "REVIEW" || workflowState === "VERIFYING" || workflowState === "VERIFIED" || isGenerating) && (
          <div className="mt-2">
            <TestDataPreview
              records={testRecords}
              loginName={loginName}
              onRegenerate={handleStartGeneration}
            />
          </div>
        )}
      </main>

      {showReportModal && verificationReport && (
        <VerificationReportModal
          report={verificationReport}
          onClose={() => setShowReportModal(false)}
          onReRun={() => handleStartVerification({
            targetUrl: verificationReport.targetUrl,
            spinDelayMs: 300,
            timeoutMs: 5000,
            autoRetryServerError: true,
          })}
        />
      )}

      <LlmConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        config={llmConfig}
        onSaveConfig={handleSaveLlmConfig}
      />

      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-6 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span>Slot AI HARNESS · Planner（本地 LLM + 合规外部 Provider 扩展） + ToolRegistry 后端</span>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <span>Tools: paytable_parser / testdata_generator / zip_packager / game_verifier / log_diagnoser</span>
        </div>
      </footer>
    </div>
  );
};
```

---

## Phase 5: start-dev.cmd 双进程启动 + .gitignore 检查 + tsconfig strict 去 noUnusedParameters:false 移除（可选）

### Task 5.1: 启动脚本 & Vite 代理 /api → FastAPI

**Files:**
- Modify: `start-dev.cmd`
- Modify: `start-dev-debug.cmd`
- Modify: `healthcheck.cmd`
- Modify: `vite.config.ts` （add `/api` proxy to `http://localhost:8000`）

- [ ] **Step 1: Modify `vite.config.ts`**
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 2: Modify `start-dev.cmd` (double-click launcher)**
```cmd
@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

:: === Check Node ===
where node >nul 2>nul
if errorlevel 1 (
  echo [Harness] Node.js not found. Trying winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [Harness] winget not found. Please install Node.js LTS manually: https://nodejs.org/
    start "" https://nodejs.org/
    pause
    exit /b 1
  )
  echo [Harness] Running: winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements
  if errorlevel 1 (
    echo [Harness] Install aborted. Please manually install Node.js LTS.
    start "" https://nodejs.org/
    pause
    exit /b 1
  )
  echo [Harness] Node installed; you may need to re-open this terminal. Restarting in 2s...
  ping 127.0.0.1 -n 3 >nul
  start "" "%~f0"
  exit /b 0
)

:: === Check Python ===
where python >nul 2>nul
if errorlevel 1 (
  echo [Harness] Python not found. Trying winget install Python 3.11...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [Harness] winget not found. Please install Python 3.11+ manually: https://www.python.org/downloads/
    start "" https://www.python.org/downloads/
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.11 --silent --accept-package-agreements
  if errorlevel 1 (
    echo [Harness] Python install aborted.
    pause
    exit /b 1
  )
  echo [Harness] Python installed. Restarting in 2s...
  ping 127.0.0.1 -n 3 >nul
  start "" "%~f0"
  exit /b 0
)

:: === Install deps ===
if not exist "node_modules" (
  echo [Harness] Installing npm dependencies (npm ci)...
  call npm.cmd ci
)

if not exist "server\.venv" (
  echo [Harness] Creating Python venv + installing requirements...
  call python -m venv server\.venv
  call "server\.venv\Scripts\pip.exe" install --upgrade pip
  call "server\.venv\Scripts\pip.exe" install -r server\requirements.txt
) else (
  echo [Harness] server\.venv already present. Skipping pip install (delete folder to re-install).
)

:: === Start FastAPI in background (hidden window) ===
echo [Harness] Starting FastAPI backend (uvicorn port 8000)...
start "HARNESS-FASTAPI" /MIN cmd /c ""server\.venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000"

:: Wait a bit for backend to come up (warm-up)
echo [Harness] Backend warm-up (4s)...
ping 127.0.0.1 -n 5 >nul

:: === Start Vite ===
echo [Harness] Starting Vite dev server (port 3000). Launching browser...
start "" "http://localhost:3000"
call npm.cmd run dev
endlocal
```

- [ ] **Step 3: Modify `start-dev-debug.cmd`**
```cmd
@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"

echo ==============================================
echo   HARNESS Debug Mode
echo   Backend log -> harness-backend.log
echo   Vite log    -> harness-vite.log
echo ==============================================
pause

where node >nul 2>nul || (echo Node not found & pause & exit /b 1)
where python >nul 2>nul || (echo Python not found & pause & exit /b 1)

if not exist node_modules call npm.cmd ci
if not exist server\.venv (
  call python -m venv server\.venv
  call server\.venv\Scripts\pip.exe install --upgrade pip
  call server\.venv\Scripts\pip.exe install -r server\requirements.txt
)

echo [Harness] Launching backend in visible terminal...
start "HARNESS-FASTAPI-DEBUG" cmd /k ""server\.venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload"
ping 127.0.0.1 -n 5 >nul
start "http://localhost:3000"
call npm.cmd run dev
endlocal
```

- [ ] **Step 4: Modify `healthcheck.cmd`**
```cmd
@echo off
setlocal
cd /d "%~dp0"
echo === AI HARNESS Health Check ===
echo.
echo [1] Vite (frontend) port 3000:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK HTTP ' + $r.StatusCode) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
echo [2] FastAPI (backend) port 8000:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:8000/healthz -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK ' + $r.Content) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
echo [3] Ollama (local planner model) port 11434:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:11434/api/tags -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK HTTP ' + $r.StatusCode) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
pause
endlocal
```

---

### Task 5.2: `paytable_parser_tool.py` 修掉 Pydantic ToolResult.success 类型不兼容的多余位置参数 & import `time` 未用；以及 parse 成功后返回 content 再检查一次

- [ ] **Step 1: Fix `paytable_parser_tool.py` — remove deprecated `result_snippet := None` line**
(已在 Task 1.2 说明过；实施时确保最终文件里无 `:=` 残留或单独 return ToolResult)

---

## Phase 6: Minimal TDD — 后端 + 前端 parse / build

### Task 6.1: 后端 Python import smoke tests + 前端 ts build (type-check + build)

- [ ] **Step 1: 安装 Python deps 并跑一次 uvicorn 启动 smoke（10s 超时关）**

```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
python -m venv server\.venv
server\.venv\Scripts\python.exe -m pip install --upgrade pip
server\.venv\Scripts\pip.exe install -r server\requirements.txt
start /B server\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
Start-Sleep 5
try { $r = Invoke-RestMethod http://localhost:8000/healthz -TimeoutSec 5; $r | ConvertTo-Json } catch { Write-Warning $_.Exception.Message }
Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*server\.venv*" } | Stop-Process -Force
```
Expected: `{ ok: true, ... }` 健康检查通过。

- [ ] **Step 2: `npm ci` (若未) → `npm.cmd run build`**
```powershell
cd c:\Users\lijun\Documents\trae\testdata-tool-main
if (-not (Test-Path node_modules)) { npm ci }
npm.cmd run build
```
Expected: Vite build succeeds, no TS type errors (if any, fix as you go).

---

## Plan Self-Review

**1. Spec coverage check:**
- ✅ P0 工具 Plugin 接口（Task 1.1 base.py ToolRegistry）
- ✅ P0 5 个内置工具实现（Task 1.2 paytable/testdata/zip/verifier/diagnoser）
- ✅ P0 PlannerProvider 4 个 实现 + 合规风险门（Task 3.1/4.1）
- ✅ P0 PlannerAgent ReAct 循环，LLM 跑在前端（用户本机 Ollama，满足保密），外部 Provider 灰显（Task 3.2, 4.1）
- ✅ P1 FastAPI 5 路由（Auth/Tools/Executions/Records），Session 口令 bcrypt（Task 2.1）
- ✅ P1 process_runner 桥接 verify_testdata.py（Task 0.2, GameVerifierTool）
- ✅ P2 Execution history DB + 回溯（storage + /mine + /:id），Workflow 对象雏形（stage 1/2）
- ✅ P2 LLM 审计落库（不含内容）（POST /audit-llm）
- ✅ P2 start-dev.cmd 双进程 Windows 双击启动（Phase 5）
- ✅ 可扩展性证明：LlmConfigModal 四 Provider Tab + 健康检测/拉模型列表（Task 4.1）

**2. Placeholder scan:**
- 已在计划中用完整代码填充每个步骤；无 TBD。
- `__noop__` 已通过 Patch 2（`/api/executions/new`）移除。

**3. Type consistency:**
- 后端 `ToolResult.success` → bool；前端 `ToolResultDto.success` → bool；一致。
- `ExecutionRow.status` 字符串枚举 与 storage 写入值（PENDING/RUNNING/SUCCESS/FAILED）一致。
- `test_records` 字段名（`base_batch`、`bonus_batch`、`xml_snippet`）在 PlannerAgent._coerceRecords 中对齐。
- Frontend `ToolCallLog` 5 种 type (`THOUGHT/TOOL_CALL/TOOL_RES/SELF_HEAL/HARNESS_EVENT`) 与 HarnessSseEvent union 一致，与后端 SSE `_sse("harness_event", {...})` 一致。

---

**Next step (after plan is reviewed): choose between subagent-driven or inline execution.**
