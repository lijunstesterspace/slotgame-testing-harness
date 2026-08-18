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
