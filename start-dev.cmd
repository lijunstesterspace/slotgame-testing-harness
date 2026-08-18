@echo off
setlocal

REM Double-click to start the React/Vite dev server.
REM It will run "npm ci" once if dependencies are missing.

cd /d "%~dp0"

set "LOG=%~dp0start-dev.log"
> "%LOG%" echo === start-dev.cmd log ===
>> "%LOG%" echo Started at: %date% %time%
>> "%LOG%" echo Working dir: %cd%

title testdata-tool-main - start-dev
echo (Log saved to: start-dev.log)

echo.
echo [1/3] Checking Node.js and npm...
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found.
  >> "%LOG%" echo ERROR: node not found
  echo.
  echo npm is shipped with Node.js. You need to install Node.js (LTS).
  echo.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo Hint: winget not found. Opening Node.js download page...
    >> "%LOG%" echo winget not found. Opening https://nodejs.org/en/download
    start "" "https://nodejs.org/en/download"
    pause
    exit /b 1
  ) else (
    echo winget detected. You can auto-install Node.js LTS now.
    set /p INSTALL_NODE=Install Node.js LTS via winget? (Y/N):
    if /i "%INSTALL_NODE%"=="Y" (
      echo.
      echo Installing Node.js LTS...
      >> "%LOG%" echo Running: winget install -e --id OpenJS.NodeJS.LTS
      winget install -e --id OpenJS.NodeJS.LTS >> "%LOG%" 2>&1
      if errorlevel 1 (
        echo.
        echo ERROR: winget install failed. Please install Node.js manually:
        echo https://nodejs.org/en/download
        >> "%LOG%" echo ERROR: winget install failed
        start "" "https://nodejs.org/en/download"
        pause
        exit /b 1
      )
      echo.
      echo Node.js installation finished. Please close and re-open this script if node is still not found.
      >> "%LOG%" echo Node.js installed via winget. User should re-run script.
      pause
      exit /b 0
    ) else (
      echo Skipped auto-install. Opening Node.js download page...
      >> "%LOG%" echo User skipped winget install. Opening https://nodejs.org/en/download
      start "" "https://nodejs.org/en/download"
      pause
      exit /b 1
    )
  )
)
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Please re-install/repair Node.js (LTS).
  >> "%LOG%" echo ERROR: npm not found (node exists)
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" (
  echo.
  echo [2/3] Installing dependencies (npm ci)...
  >> "%LOG%" echo Running: npm ci
  call npm ci >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo.
    echo ERROR: npm ci failed.
    >> "%LOG%" echo ERROR: npm ci failed
    start notepad "%LOG%"
    pause
    exit /b 1
  )
)

echo.
echo [3/3] Starting dev server (http://localhost:3000/)...
>> "%LOG%" echo Running: npm run dev
start "" "http://localhost:3000/"
call npm run dev
if errorlevel 1 (
  echo.
  echo ERROR: Dev server exited with error.
  echo Tip: If the window closes too fast, run start-dev-debug.cmd to see full logs.
  >> "%LOG%" echo ERROR: npm run dev exited with errorlevel %errorlevel%
  start notepad "%LOG%"
  pause
  exit /b 1
)
