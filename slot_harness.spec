# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file - Slot Game Testing Harness packaging configuration
Usage: pyinstaller slot_harness.spec --noconfirm
"""
import os
from pathlib import Path

block_cipher = None

# ---------------------------------------------------------------------------
# Project root (SPECPATH is the directory containing the spec file = project root)
# ---------------------------------------------------------------------------
ROOT = SPECPATH

# ---------------------------------------------------------------------------
# Hidden imports: modules that PyInstaller static analysis cannot discover automatically
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

    # ---- Database ----
    "aiosqlite",
    "sqlite3",

    # ---- C extensions ----
    "_cffi_backend",
    "cffi",
    "pycparser",

    # ---- Serialization / utilities ----
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

    # ---- Standard library (PyInstaller sometimes misses these) ----
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

    # ---- server submodules (ensure all are included) ----
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
    "server.infra.cancellation",
    "server.services",
    "server.services.execution_queue",
    "server.tools",
    "server.tools.base",
    "server.tools.impl",
    "server.tools.impl.__init__",
    "server.tools.impl.diff_comparator_tool",
    "server.tools.impl.helpfile_analyzer_tool",
    "server.tools.impl.helpfile_report_tool",
    "server.tools.impl.html_to_text_converter_tool",
    "server.tools.impl.log_diagnoser_tool",
    "server.tools.impl.portugal_plugin_fetcher_tool",
    "server.tools.impl.portugal_plugin_parser_tool",
    "server.tools.impl.portugal_plugin_reporter_tool",
    "server.tools.impl.portugal_plugin_symbol_map_tool",
    "server.tools.impl.symbol_profiles",
    "server.tools.impl.testdata_generator_tool",
    "server.tools.impl.testdata_parser_tool",
    "server.tools.impl.testdata_verifier_api_tool",
    "server.tools.impl.testdata_verifier_harness_tool",
    "server.tools.impl.testdata_verifier_tool",
    "server.tools.impl.zip_packager_tool",
]

# ---------------------------------------------------------------------------
# collect_all helper: also bundle the _cffi_backend .pyd file
# ---------------------------------------------------------------------------
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs

cffi_datas, cffi_binaries, _ = collect_all("_cffi_backend")
aiosqlite_datas, aiosqlite_binaries, _ = collect_all("aiosqlite")

# Collect all submodules of the server.tools.impl package (PyInstaller static analysis may miss them)
try:
    impl_datas, impl_binaries, impl_hidden = collect_all("server.tools.impl")
except Exception:
    impl_datas, impl_binaries, impl_hidden = [], [], []
    print("[spec] WARNING: Could not collect_all server.tools.impl")

# ---------------------------------------------------------------------------
# Frontend static files: server/static (Vite build output)
# ---------------------------------------------------------------------------
static_dir = os.path.join(ROOT, "server", "static")
static_datas = []
if os.path.isdir(static_dir):
    # PyInstaller's target is a directory path; files are placed into it under their original names
    # so files in the same directory are grouped, with target set to the subdirectory path
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
# .env file: not bundled into the exe; read at runtime from the exe directory so users can edit the config
# ---------------------------------------------------------------------------
env_datas = []  # .env is no longer bundled; read at runtime from the exe directory
print("[spec] .env will be read from exe directory at runtime")

# ---------------------------------------------------------------------------
# verify_testdata.py / generate_testdata.py (utility scripts)
# ---------------------------------------------------------------------------
script_datas = []
for script_name in ("verify_testdata.py", "generate_testdata.py"):
    script_path = os.path.join(ROOT, script_name)
    if os.path.isfile(script_path):
        script_datas.append((script_path, "."))
        print(f"[spec] Including tool script: {script_name}")

# ---------------------------------------------------------------------------
# symbol_profiles/*.json: bundled as read-only seeds; at runtime symbol_profiles/ next to the exe is writable and takes precedence
# ---------------------------------------------------------------------------
profile_datas = []
profiles_src = os.path.join(ROOT, "symbol_profiles")
if os.path.isdir(profiles_src):
    for f in Path(profiles_src).glob("*.json"):
        profile_datas.append((str(f), "symbol_profiles"))
    print(f"[spec] Including {len(profile_datas)} symbol profile(s)")

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(
    [os.path.join(ROOT, "build.py")],
    pathex=[ROOT],
    binaries=cffi_binaries + aiosqlite_binaries + impl_binaries,
    datas=cffi_datas + aiosqlite_datas + impl_datas + static_datas + env_datas + script_datas + profile_datas,
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
# PYZ (Python bytecode archive)
# ---------------------------------------------------------------------------
pyz = PYZ(a.pure, cipher=block_cipher)

# ---------------------------------------------------------------------------
# EXE (single-file mode)
# ---------------------------------------------------------------------------
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="SlotGameTestingHarness",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,       # No console window, pure desktop application
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,             # Can be replaced with a project icon path, e.g. "assets/icon.ico"
)
