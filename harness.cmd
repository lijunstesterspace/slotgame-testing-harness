@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

:: Use absolute paths to avoid issues with spaces in paths
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

:: Verify the directory change
echo [INFO] Working directory: %ROOT%
if not exist "%ROOT%\server\requirements.txt" (
    echo [ERROR] Cannot find server\requirements.txt
    echo [HINT] Make sure harness.cmd is run from the project root
    pause
    exit /b 1
)

:: ============================================================
::   Slot Game Testing Harness - EXE packaging tool
::   Purpose: package into an exe to share with colleagues
:: ============================================================

echo ============================================================
echo   Slot Game Testing Harness - EXE packaging tool
echo ============================================================
echo.
echo  This tool will generate slotgametestingharness.exe
echo  Once packaged, it can be shared with colleagues to run directly
echo.
pause

:: ============================================================
:: Step 1: Check Python
:: ============================================================
echo.
echo [1/5] Checking Python environment...
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found, please install Python 3.11+ first
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)
python --version
echo.

:: ============================================================
:: Step 2: Create/activate virtual environment
:: ============================================================
echo [2/5] Configuring virtual environment...
if not exist "venv" (
    echo [INFO] Creating virtual environment venv...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)
call venv\Scripts\activate.bat

:: ============================================================
:: Step 3: Install dependencies
:: ============================================================
echo [3/5] Installing PyInstaller and backend dependencies...
python -m pip install --upgrade pip pyinstaller
python -m pip install -r "%ROOT%\server\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    echo [HINT] Please check the error messages above
    pause
    exit /b 1
)
echo.

:: ============================================================
:: Step 4: Build frontend
:: ============================================================
echo [4/5] Building frontend...
where node >nul 2>nul
if errorlevel 1 (
    echo [WARNING] Node.js not found, skipping frontend build
    echo [HINT] To include the frontend pages, install Node.js first: https://nodejs.org/
    goto :skip_frontend
)

:: Call "npm", not "npm.cmd": cmd resolves it through PATHEXT, so it works both for the official
:: installer (npm.cmd) and for version managers that only put an npm.exe shim on PATH (nvm-windows 2.x)
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was found but npm was not
    echo [HINT] Reinstall Node.js, or with nvm run: nvm use ^<version^>
    pause
    exit /b 1
)

:: Clean the old server/static first (avoid leftover old build output)
if exist "server\static" (
    echo [INFO] Cleaning old server/static output...
    rmdir /s /q "server\static"
)

:: Force rebuild of frontend dependencies
if exist "node_modules" (
    echo [INFO] Cleaning old node_modules/.cache...
    if exist "node_modules\.cache" rmdir /s /q "node_modules\.cache"
)

:: Check node_modules
if not exist "node_modules" (
    echo [INFO] Installing frontend dependencies...
    call npm ci
)

:: Build frontend into server/static
echo [INFO] Running npm run build - output to server/static...
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed
    pause
    exit /b 1
)

:: Verify build output
if not exist "server\static\index.html" (
    echo [ERROR] Frontend build output missing: server/static/index.html
    pause
    exit /b 1
)
echo [SUCCESS] Frontend build complete

:skip_frontend
echo.

:: ============================================================
:: Step 5: Run PyInstaller packaging
:: ============================================================
echo [5/5] Running PyInstaller packaging...
echo [INFO] This may take 2-5 minutes, please be patient...
echo.

:: ============================================================
:: Deep clean: prevent old code/bytecode/dependencies from being collected by PyInstaller
:: ============================================================
echo [INFO] Deep cleaning Python caches and leftover directories...

:: Clean PyInstaller output directories
if exist "dist" rmdir /s /q dist
if exist "build" rmdir /s /q build

:: Clean PyInstaller spec lock file
if exist "slot_harness.spec.lock" del /f /q "slot_harness.spec.lock"

:: Clean root .deps (leftover old dependencies)
if exist ".deps" (
    echo        - .deps/ old dependency directory
    rmdir /s /q ".deps"
)

:: Clean all __pycache__ bytecode directories (project root + server/, fully recursive)
echo        - __pycache__ bytecode directories
for /d /r "%ROOT%" %%d in (__pycache__) do if exist "%%d" rmdir /s /q "%%d" 2>nul

:: Clean all .pyc bytecode files
echo        - .pyc bytecode files
for /r "%ROOT%" %%f in (*.pyc) do if exist "%%f" del /f /q "%%f" 2>nul

:: If using a virtual environment, ensure dependencies are installed into venv, not system Python
if exist "venv\Scripts\python.exe" (
    echo [INFO] Reinstalling backend dependencies into venv - ensuring latest versions...
    "venv\Scripts\python.exe" -m pip install --upgrade pip pyinstaller >nul
    "venv\Scripts\python.exe" -m pip install -r "%ROOT%\server\requirements.txt" --upgrade --force-reinstall >nul 2>&1
    echo [SUCCESS] venv dependencies reinstalled
)
echo [SUCCESS] Deep clean complete
echo.

:: Run packaging - prefer the venv python
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" -m PyInstaller "%ROOT%\slot_harness.spec" --noconfirm --clean
) else (
    python -m PyInstaller "%ROOT%\slot_harness.spec" --noconfirm --clean
)
if errorlevel 1 (
    echo [ERROR] PyInstaller packaging failed, please check the error messages above
    pause
    exit /b 1
)

:: ============================================================
:: Done
:: ============================================================
echo.
if exist "dist\slotgametestingharness.exe" (
    echo ============================================================
    echo   Packaging complete.
    echo ============================================================
    echo.
    echo Output file: dist\slotgametestingharness.exe
    echo.
    
    :: Copy .env to the dist directory
    if exist ".env" (
        copy /y ".env" "dist\.env" >nul
        echo [INFO] Copied .env to the dist directory
    ) else (
        echo [WARNING] .env file not found, please create it manually
    )
    
    echo.
    echo ============================================================
    echo   Usage instructions
    echo ============================================================
    echo.
    echo  1. Pack the following files from the dist folder into a zip:
    echo     - slotgametestingharness.exe
    echo     - .env
    echo.
    echo  2. Share the zip file with colleagues
    echo.
    echo  3. After extracting, colleagues double-click slotgametestingharness.exe to use it
    echo     The desktop window will open automatically
    echo.
    echo  Note: colleagues need the Chrome browser installed (for Selenium)
    echo.
    
    :: Ask whether to open the dist directory
    set /p "open_dir=Open the dist directory? (Y/N): "
    if /i "!open_dir!"=="Y" (
        explorer "dist"
    )
) else (
    echo [ERROR] Output file not found: dist\slotgametestingharness.exe
)

echo.
pause
endlocal
