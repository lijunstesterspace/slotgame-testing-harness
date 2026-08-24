from __future__ import annotations
import os
import sys
from pathlib import Path
from dataclasses import dataclass, field
from dotenv import load_dotenv


def _resolve_env_path() -> Path:
    """解析 .env 文件路径：打包后从 exe 所在目录读取，开发时从项目根目录读取。"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：exe 所在目录
        return Path(sys.executable).parent / ".env"
    else:
        # 开发模式：项目根目录
        return Path(__file__).resolve().parent.parent / ".env"


_env_path = _resolve_env_path()
load_dotenv(_env_path)

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
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip()
        for o in os.getenv(
            "HARNESS_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if o.strip()
    ])
    admin_username: str = os.getenv("HARNESS_ADMIN_USERNAME", "admin")
    admin_password: str = os.getenv("HARNESS_ADMIN_PASSWORD", "admin123")
    default_tester_password: str = os.getenv("HARNESS_TESTER_PASSWORD", "test1234")
    session_ttl_seconds: int = int(os.getenv("HARNESS_SESSION_TTL", str(60 * 60 * 8)))
    execution_run_ttl_hours: int = int(os.getenv("HARNESS_RUN_TTL_HOURS", "24"))
    max_tool_timeout_sec: int = int(os.getenv("HARNESS_MAX_TOOL_TIMEOUT", "900"))
    enable_auth: bool = _bool("HARNESS_ENABLE_AUTH", True)
    default_user_role: str = os.getenv("HARNESS_DEFAULT_ROLE", "tester")


settings = Settings()
