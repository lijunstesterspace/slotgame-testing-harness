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

if not exist ".deps\fastapi" (
  echo [Harness] .deps\fastapi not found. Installing backend dependencies into .deps...
  call python -m pip install -r server\requirements.txt --target .deps
  if errorlevel 1 (
    echo [Harness] pip install --target .deps failed.
    pause
    exit /b 1
  )
) else (
  echo [Harness] .deps already present. Skipping pip install (delete folder to re-install).
)

:: === Start FastAPI in background (hidden window) ===
echo [Harness] Starting FastAPI backend (uvicorn port 8000)...
start "HARNESS-FASTAPI" /MIN cmd /c "server\start-server.cmd"

:: Wait a bit for backend to come up (warm-up)
echo [Harness] Backend warm-up (4s)...
ping 127.0.0.1 -n 5 >nul

:: === Start Vite ===
echo [Harness] Starting Vite dev server (port 3000). Launching browser...
start "" "http://localhost:3000"
call npm.cmd run dev
endlocal
