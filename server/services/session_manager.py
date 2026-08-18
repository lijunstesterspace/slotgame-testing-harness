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
