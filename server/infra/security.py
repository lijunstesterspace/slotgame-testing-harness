from __future__ import annotations
import secrets
from typing import Callable, Any


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


# No login in this build (see design doc §4.1): every request is treated as the
# same single local user. Kept as a dependency (rather than inlined at each call
# site) purely so route signatures like `user=Depends(require_user())` don't need
# to change if a real multi-user identity is ever reintroduced.
LOCAL_USER: dict = {"id": "local", "username": "local", "role": "admin", "token": "local"}


def require_user() -> Callable[[], Any]:
    async def _dep() -> dict:
        return LOCAL_USER
    return _dep


def require_role(*roles: str) -> Callable[[], Any]:
    async def _dep() -> dict:
        return LOCAL_USER
    return _dep
