"""
PyInstaller 入口文件。
启动 uvicorn 服务 + pywebview 桌面窗口。
"""
import os
import multiprocessing
import sys
import threading
import time
from pathlib import Path

# Windows 无控制台模式（console=False）下，sys.stdout / sys.stderr 为 None。
# 必须重定向，否则 uvicorn 与 logging 尝试写入时会崩溃。
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


def _freeze_support():
    """Windows 多进程支持（PyInstaller 打包后必须调用）。"""
    multiprocessing.freeze_support()


def _get_log_file() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "app_startup.log"
    return Path("app_startup.log")


def _start_server():
    """在后台线程启动 uvicorn 服务。"""
    try:
        import uvicorn
        from server.config import settings
        from server.main import app

        with open(_get_log_file(), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] _start_server starting on port {settings.api_port}\n")

        uvicorn.run(
            app,
            host="127.0.0.1",
            port=settings.api_port,
            reload=False,
            log_level="info",
        )
    except Exception as e:
        import traceback
        with open(_get_log_file(), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Server failed: {e}\n{traceback.format_exc()}\n")


def _open_webview():
    """等待服务就绪后，用 pywebview 打开桌面窗口。"""
    import webview
    from server.config import settings

    # pywebview 默认禁用下载（ALLOW_DOWNLOADS=False）：在 Windows 的 EdgeChromium 后端上，
    # 点击一个会触发 Content-Disposition: attachment 的链接（比如"Download HTML Report"
    # 按钮）时，on_download_starting 会直接 args.Cancel = True 静默取消，界面上完全没有
    # 任何提示——这正是打包后的桌面版一直"点了下载链接却什么也拿不到"的原因。开启后会弹出
    # 系统原生的另存为对话框。必须在 create_window() 之前设置。
    webview.settings["ALLOW_DOWNLOADS"] = True

    # 等待服务启动
    import urllib.request
    url = f"http://127.0.0.1:{settings.api_port}"
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{url}/healthz", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    # 始终打开主页面，前端内部处理登录逻辑（避免 pywebview 弹出双窗口）
    page_url = f"{url}/"

    # 创建 pywebview 窗口
    window = webview.create_window(
        title=settings.app_name,
        url=page_url,
        width=1280,
        height=800,
        min_size=(800, 600),
        resizable=True,
        fullscreen=False,
    )
    webview.start(debug=False)


def main():
    _freeze_support()
    try:
        with open(_get_log_file(), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] main() entered, argv={sys.argv}\n")
    except Exception:
        pass

    if "--server-only" in sys.argv:
        # 仅后端模式（测试或无头环境使用）
        _start_server()
        while True:
            time.sleep(1)

    # 在后台线程启动 FastAPI 服务
    server_thread = threading.Thread(target=_start_server, daemon=True)
    server_thread.start()

    # 在主线程启动 pywebview 桌面窗口
    _open_webview()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        try:
            with open(_get_log_file(), "a", encoding="utf-8") as f:
                f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Crash in main: {e}\n{traceback.format_exc()}\n")
        except Exception:
            pass
