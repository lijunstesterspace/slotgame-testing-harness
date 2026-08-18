@echo on
setlocal EnableExtensions EnableDelayedExpansion

REM Debug version: keeps the window open and prints full logs.

cd /d "%~dp0"
echo.
echo === start-dev-debug.cmd ===
echo Working dir: %cd%
echo.

set "LOG=%~dp0start-dev-debug.log"
echo === start-dev-debug.cmd log === > "%LOG%"
echo Started at: %date% %time% >> "%LOG%"
echo Working dir: %cd% >> "%LOG%"
echo STEP 0: script started >> "%LOG%"

title testdata-tool-main - start-dev-debug
echo (Log saved to: start-dev-debug.log)
echo If this window still flashes, run it from an existing cmd:
echo   1) Win+R -> cmd
echo   2) cd /d "你的项目目录"
echo   3) start-dev-debug.cmd
echo.

echo [Check] node and npm
echo STEP 1: checking node >> "%LOG%"
"%SystemRoot%\System32\where.exe" node >> "%LOG%" 2>&1
set "NODE_RC=!errorlevel!"
echo STEP 1 result: where node rc=!NODE_RC! >> "%LOG%"
if not "!NODE_RC!"=="0" (
  echo ERROR: node not found. Install Node.js LTS first: https://nodejs.org/en/download
  echo ERROR: node not found >> "%LOG%"
  start notepad "%LOG%"
  pause
  exit /b 1
)

echo STEP 2: checking npm >> "%LOG%"
"%SystemRoot%\System32\where.exe" npm >> "%LOG%" 2>&1
set "NPM_RC=!errorlevel!"
echo STEP 2 result: where npm rc=!NPM_RC! >> "%LOG%"
if not "!NPM_RC!"=="0" (
  echo ERROR: npm not found. Re-install/repair Node.js LTS: https://nodejs.org/en/download
  echo ERROR: npm not found >> "%LOG%"
  start notepad "%LOG%"
  pause
  exit /b 1
)

echo.
echo [Check] node -v / npm -v
echo STEP 3: versions >> "%LOG%"
node -v >> "%LOG%" 2>&1
call npm -v >> "%LOG%" 2>&1
echo STEP 3 done >> "%LOG%"

echo.
echo [Install] npm ci (skip if already ok)
if not exist "node_modules\vite\package.json" (
  echo STEP 4: npm ci >> "%LOG%"
  echo Running: npm ci >> "%LOG%"
  call npm ci >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo ERROR: npm ci failed
    echo ERROR: npm ci failed >> "%LOG%"
    start notepad "%LOG%"
    pause
    exit /b 1
  )
  echo STEP 4 done >> "%LOG%"
) else (
  echo node_modules detected, skip npm ci
  echo node_modules detected, skip npm ci >> "%LOG%"
  echo STEP 4 skip >> "%LOG%"
)

echo.
echo [Run] npm run dev
echo (If it exits immediately, the error will be shown below.)
echo STEP 5: npm run dev >> "%LOG%"
echo Running: npm run dev >> "%LOG%"
call npm run dev >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: npm run dev failed, see start-dev-debug.log
  echo ERROR: npm run dev failed >> "%LOG%"
  start notepad "%LOG%"
)
echo STEP 5 done >> "%LOG%"

echo.
echo Dev server stopped or failed. Press any key to close.
pause
