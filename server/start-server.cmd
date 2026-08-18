@echo off
setlocal
chcp 65001 > nul

REM ============================================================
REM  HARNESS backend launcher (FastAPI / uvicorn, port 8000)
REM  Location: <project_root>\server\start-server.cmd
REM  Python deps are pre-installed in <project_root>\.deps
REM  (pip install --target .deps). No venv required.
REM  Extra args are passed through to uvicorn, e.g. --reload
REM ============================================================

REM Resolve project root relative to this script (no hardcoded paths)
set "ROOT=%~dp0.."
cd /d "%ROOT%"

REM Make the in-project .deps packages importable
set "PYTHONPATH=%ROOT%\.deps"

where python >nul 2>nul
if errorlevel 1 (
  echo [Harness] Python not found. Please install Python 3.11+: https://www.python.org/downloads/
  exit /b 1
)

if not exist ".deps\fastapi" (
  echo [Harness] .deps\fastapi not found. Install backend dependencies first:
  echo     python -m pip install -r server\requirements.txt --target .deps
  exit /b 1
)

echo [Harness] Starting FastAPI backend: uvicorn server.main:app --host 127.0.0.1 --port 8000
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000 %*
endlocal
