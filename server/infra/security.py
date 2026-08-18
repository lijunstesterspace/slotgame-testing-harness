from __future__ import annotations
import asyncio
import hashlib
import secrets
from typing import Callable, Any
import bcrypt
from fastapi import Header, Query, HTTPException, status
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


async def _get_session_user(authorization: str | None = None, token_q: str | None = None) -> dict:
    # NOTE: StorageAsync 懒加载，避免与 storage.py 的循环引用
    from server.infra.storage import StorageAsync

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


def require_user() -> Callable[[Any], Any]:
    async def _dep(
        authorization: str | None = Header(default=None),
        token: str | None = Query(default=None, alias="token", include_in_schema=False),
    ) -> dict:
        return await _get_session_user(authorization, token)
    return _dep


def require_role(*roles: str) -> Callable[[Any], Any]:
    async def _dep(
        authorization: str | None = Header(default=None),
        token: str | None = Query(default=None, alias="token", include_in_schema=False),
    ) -> dict:
        u = await _get_session_user(authorization, token)
        if u["role"] not in roles and u["role"] != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"role_requires_one_of:{roles}")
        return u
    return _dep
