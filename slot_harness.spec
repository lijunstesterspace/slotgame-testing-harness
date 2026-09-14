# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec 文件 - Slot AI Harness 打包配置
用法：pyinstaller slot_harness.spec --noconfirm
"""
import os
from pathlib import Path

block_cipher = None

# ---------------------------------------------------------------------------
# 项目根目录（SPECPATH 即 spec 文件所在目录 = 项目根目录）
# ---------------------------------------------------------------------------
ROOT = SPECPATH

# ---------------------------------------------------------------------------
# Hidden imports：PyInstaller 静态分析无法自动发现的模块
# ---------------------------------------------------------------------------
hidden_imports = [
    # ---- FastAPI / uvicorn / starlette ----
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "fastapi",
    "fastapi.middleware",
    "fastapi.middleware.cors",
    "fastapi.staticfiles",
    "fastapi.responses",
    "starlette",
    "starlette.staticfiles",
    "starlette.responses",
    "starlette.routing",

    # ---- pydantic / pydantic_core ----
    "pydantic",
    "pydantic_core",
    "pydantic.deprecated",
    "pydantic._internal",
    "annotated_types",

    # ---- 数据库 ----
    "aiosqlite",
    "sqlite3",

    # ---- C 扩展 ----
    "_cffi_backend",
    "cffi",
    "pycparser",

    # ---- 序列化 / 工具 ----
    "aiofiles",
    "structlog",
    "structlog.processors",
    "structlog.stdlib",
    "dotenv",
    "python_dotenv",
    "multipart",
    "python_multipart",
    "python_multipart.multipart",

    # ---- Selenium ----
    "selenium",
    "selenium.webdriver",
    "selenium.webdriver.chrome",
    "selenium.webdriver.chrome.webdriver",
    "selenium.webdriver.chrome.service",
    "selenium.webdriver.chrome.options",
    "selenium.webdriver.common",
    "selenium.webdriver.common.by",
    "selenium.webdriver.common.keys",
    "selenium.webdriver.common.action_chains",
    "selenium.webdriver.support",
    "selenium.webdriver.support.ui",
    "selenium.webdriver.support.expected_conditions",
    "urllib3",
    "certifi",
    "idna",
    "h11",
    "sniffio",
    "outcome",
    "trio",
    "trio_websocket",
    "websocket",
    "wsproto",
    "socks",
    "sortedcontainers",

    # ---- pywebview ----
    "webview",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "clr",
    "pythonnet",
    "System",
    "System.Windows.Forms",
    "System.Drawing",
    "System.Threading",

    # ---- 标准库（PyInstaller 有时漏掉）----
    "asyncio",
    "contextlib",
    "dataclasses",
    "json",
    "pathlib",
    "webbrowser",
    "multiprocessing",
    "ctypes",
    "ctypes.util",
    "hashlib",
    "hmac",
    "secrets",
    "uuid",
    "mimetypes",
    "html",
    "html.parser",
    "logging.config",
    "logging.handlers",

    # ---- server 子模块（确保全部打入）----
    "server",
    "server.config",
    "server.main",
    "server.api",
    "server.api.tools_router",
    "server.api.executions_router",
    "server.api.records_router",
    "server.infra",
    "server.infra.logger",
    "server.infra.process_runner",
    "server.infra.security",
    "server.infra.storage",
    "server.services",
    "server.services.execution_queue",
    "server.tools",
    "server.tools.base",
    "server.tools.impl",
    "server.tools.impl.game_verifier_tool",
    "server.tools.impl.log_diagnoser_tool",
    "server.tools.impl.testdata_parser_tool",
    "server.tools.impl.testdata_generator_tool",
    "server.tools.impl.zip_packager_tool",
]

# ---------------------------------------------------------------------------
# collect_all 辅助：将 _cffi_backend 的 .pyd 文件一并打包
# ---------------------------------------------------------------------------
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs

cffi_datas, cffi_binaries, _ = collect_all("_cffi_backend")
aiosqlite_datas, aiosqlite_binaries, _ = collect_all("aiosqlite")

# 收集 server.tools.impl 包的所有子模块（PyInstaller 静态分析可能遗漏）
try:
    impl_datas, impl_binaries, impl_hidden = collect_all("server.tools.impl")
except Exception:
    impl_datas, impl_binaries, impl_hidden = [], [], []
    print("[spec] WARNING: Could not collect_all server.tools.impl")

# ---------------------------------------------------------------------------
# 前端静态文件：server/static（Vite 构建产物）
# ---------------------------------------------------------------------------
static_dir = os.path.join(ROOT, "server", "static")
static_datas = []
if os.path.isdir(static_dir):
    # PyInstaller 的 target 是目录路径，文件会以原名放入该目录
    # 所以需要将同目录的文件分组，target 设为子目录路径
    from collections import defaultdict
    groups = defaultdict(list)
    for f in Path(static_dir).rglob("*"):
        if f.is_file():
            rel = f.relative_to(static_dir)
            groups[str(rel.parent)].append(str(f))
    for subdir, files in groups.items():
        target = os.path.join("server", "static", subdir) if subdir != "." else os.path.join("server", "static")
        for f in files:
            static_datas.append((f, target))
    print(f"[spec] Found {len(static_datas)} frontend static files in {len(groups)} groups")
    for s, d in static_datas:
        print(f"  {os.path.basename(s)} -> {d}")
else:
    print("[spec] WARNING: server/static not found, run npm run build first")

# ---------------------------------------------------------------------------
# .env 文件：不打包进 exe，运行时从 exe 所在目录读取，方便用户修改配置
# ---------------------------------------------------------------------------
env_datas = []  # 不再打包 .env，运行时从 exe 同目录读取
print("[spec] .env will be read from exe directory at runtime")

# ---------------------------------------------------------------------------
# verify_testdata.py / generate_testdata.py（工具脚本）
# ---------------------------------------------------------------------------
script_datas = []
for script_name in ("verify_testdata.py", "generate_testdata.py"):
    script_path = os.path.join(ROOT, script_name)
    if os.path.isfile(script_path):
        script_datas.append((script_path, "."))
        print(f"[spec] Including tool script: {script_name}")

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(
    [os.path.join(ROOT, "build.py")],
    pathex=[ROOT],
    binaries=cffi_binaries + aiosqlite_binaries + impl_binaries,
    datas=cffi_datas + aiosqlite_datas + impl_datas + static_datas + env_datas + script_datas,
    hiddenimports=hidden_imports + impl_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib", "numpy", "pandas", "scipy", "PIL",
        "IPython", "notebook", "pytest", "setuptools", "pip",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# ---------------------------------------------------------------------------
# PYZ（Python 字节码压缩包）
# ---------------------------------------------------------------------------
pyz = PYZ(a.pure, cipher=block_cipher)

# ---------------------------------------------------------------------------
# EXE（单文件模式）
# ---------------------------------------------------------------------------
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="SlotAIHarness",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,       # 无控制台窗口，纯桌面应用
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,             # 可替换为项目 icon 路径，如 "assets/icon.ico"
)
