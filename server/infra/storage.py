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
