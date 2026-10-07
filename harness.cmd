@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

:: 使用绝对路径，避免路径空格问题
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

:: 验证目录切换
echo [信息] 工作目录: %ROOT%
if not exist "%ROOT%\server\requirements.txt" (
    echo [错误] 找不到 server\requirements.txt
    echo [提示] 请确保 harness.cmd 在项目根目录运行
    pause
    exit /b 1
)

:: ============================================================
::   Slot Game Testing Harness - EXE 打包工具
::   用途：打包成 exe 分享给同事使用
:: ============================================================

echo ============================================================
echo   Slot Game Testing Harness - EXE 打包工具
echo ============================================================
echo.
echo  此工具将生成 slotgametestingharness.exe
echo  打包完成后可分享给同事直接运行
echo.
pause

:: ============================================================
:: Step 1: 检查 Python
:: ============================================================
echo.
echo [1/5] 检查 Python 环境...
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)
python --version
echo.

:: ============================================================
:: Step 2: 创建/激活虚拟环境
:: ============================================================
echo [2/5] 配置虚拟环境...
if not exist "venv" (
    echo [信息] 创建虚拟环境 venv...
    python -m venv venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败
        pause
        exit /b 1
    )
)
call venv\Scripts\activate.bat

:: ============================================================
:: Step 3: 安装依赖
:: ============================================================
echo [3/5] 安装 PyInstaller 和后端依赖...
python -m pip install --upgrade pip pyinstaller
python -m pip install -r "%ROOT%\server\requirements.txt"
if errorlevel 1 (
    echo [错误] 安装依赖失败
    echo [提示] 请检查上方错误信息
    pause
    exit /b 1
)
echo.

:: ============================================================
:: Step 4: 构建前端
:: ============================================================
echo [4/5] 构建前端...
where node >nul 2>nul
if errorlevel 1 (
    echo [警告] 未找到 Node.js，跳过前端构建
    echo [提示] 如需包含前端页面，请先安装 Node.js: https://nodejs.org/
    goto :skip_frontend
)

:: 先清理旧的 server/static（避免残留旧构建产物）
if exist "server\static" (
    echo [信息] 清理旧的 server/static 产物...
    rmdir /s /q "server\static"
)

:: 强制重新构建前端依赖
if exist "node_modules" (
    echo [信息] 清理旧 node_modules/.cache...
    if exist "node_modules\.cache" rmdir /s /q "node_modules\.cache"
)

:: 检查 node_modules
if not exist "node_modules" (
    echo [信息] 安装前端依赖...
    call npm.cmd ci
)

:: 构建前端到 server/static
echo [信息] 执行 npm run build（输出到 server/static）...
call npm.cmd run build
if errorlevel 1 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)

:: 验证构建产物
if not exist "server\static\index.html" (
    echo [错误] 前端构建产物不存在: server/static/index.html
    pause
    exit /b 1
)
echo [成功] 前端构建完成

:skip_frontend
echo.

:: ============================================================
:: Step 5: 执行 PyInstaller 打包
:: ============================================================
echo [5/5] 执行 PyInstaller 打包...
echo [信息] 这可能需要 2-5 分钟，请耐心等待...
echo.

:: ============================================================
:: 深度清理：避免旧代码/旧字节码/旧依赖被 PyInstaller 收集
:: ============================================================
echo [信息] 深度清理 Python 缓存与残留目录...

:: 清理 PyInstaller 产物目录
if exist "dist" rmdir /s /q dist
if exist "build" rmdir /s /q build

:: 清理 PyInstaller spec 锁文件
if exist "slot_harness.spec.lock" del /f /q "slot_harness.spec.lock"

:: 清理根目录 .deps（旧依赖残留）
if exist ".deps" (
    echo        - .deps/ 旧依赖目录
    rmdir /s /q ".deps"
)

:: 清理所有 __pycache__ 字节码目录（项目根目录 + server/ 深度递归）
echo        - __pycache__ 字节码目录
for /d /r "%ROOT%" %%d in (__pycache__) do if exist "%%d" rmdir /s /q "%%d" 2>nul

:: 清理所有 .pyc 字节码文件
echo        - .pyc 字节码文件
for /r "%ROOT%" %%f in (*.pyc) do if exist "%%f" del /f /q "%%f" 2>nul

:: 如果使用虚拟环境，确保依赖安装到 venv（不是系统 Python）
if exist "venv\Scripts\python.exe" (
    echo [信息] 重新安装后端依赖到 venv（确保版本最新）...
    "venv\Scripts\python.exe" -m pip install --upgrade pip pyinstaller >nul
    "venv\Scripts\python.exe" -m pip install -r "%ROOT%\server\requirements.txt" --upgrade --force-reinstall >nul 2>&1
    echo [成功] venv 依赖重新安装完成
)
echo [成功] 深度清理完成
echo.

:: 执行打包（用 venv 的 python 优先）
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" -m PyInstaller "%ROOT%\slot_harness.spec" --noconfirm --clean
) else (
    python -m PyInstaller "%ROOT%\slot_harness.spec" --noconfirm --clean
)
if errorlevel 1 (
    echo [错误] PyInstaller 打包失败，请检查上方错误信息
    pause
    exit /b 1
)

:: ============================================================
:: 完成
:: ============================================================
echo.
if exist "dist\slotgametestingharness.exe" (
    echo ============================================================
    echo   打包完成！
    echo ============================================================
    echo.
    echo 输出文件: dist\slotgametestingharness.exe
    echo.
    
    :: 复制 .env 到 dist 目录
    if exist ".env" (
        copy /y ".env" "dist\.env" >nul
        echo [信息] 已复制 .env 到 dist 目录
    ) else (
        echo [警告] 未找到 .env 文件，请手动创建
    )
    
    echo.
    echo ============================================================
    echo   使用说明
    echo ============================================================
    echo.
    echo  1. 将 dist 文件夹中的以下文件打包成 zip:
    echo     - slotgametestingharness.exe
    echo     - .env
    echo.
    echo  2. 将 zip 文件分享给同事
    echo.
    echo  3. 同事解压后双击 slotgametestingharness.exe 即可使用
    echo     桌面窗口将自动打开
    echo.
    echo  注意: 同事电脑需要安装 Chrome 浏览器 (用于 Selenium)
    echo.
    
    :: 询问是否打开 dist 目录
    set /p "open_dir=是否打开 dist 目录？(Y/N): "
    if /i "!open_dir!"=="Y" (
        explorer "dist"
    )
) else (
    echo [错误] 未找到输出文件 dist\slotgametestingharness.exe
)

echo.
pause
endlocal
