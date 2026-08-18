@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"

echo ==============================================
echo   HARNESS Debug Mode
echo   Backend runs in a visible window (--reload)
echo   Vite runs in this window
echo ==============================================
pause

where node >nul 2>nul || (echo Node not found & pause & exit /b 1)
where python >nul 2>nul || (echo Python not found & pause & exit /b 1)

if not exist node_modules call npm.cmd ci
if not exist ".deps\fastapi" (
  call python -m pip install -r server\requirements.txt --target .deps
  if errorlevel 1 (echo pip install --target .deps failed & pause & exit /b 1)
)

echo [Harness] Launching backend in visible terminal...
start "HARNESS-FASTAPI-DEBUG" cmd /k "server\start-server.cmd --reload"
ping 127.0.0.1 -n 5 >nul
start "" "http://localhost:3000"
call npm.cmd run dev
endlocal
