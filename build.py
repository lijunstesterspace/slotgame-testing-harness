"""
PyInstaller 入口文件。
启动 uvicorn 服务 + pywebview 桌面窗口。
"""
from __future__ import annotations
import multiprocessing
import sys
import threading
import time


def _freeze_support():
    """Windows 多进程支持（PyInstaller 打包后必须调用）。"""
    multiprocessing.freeze_support()


def _start_server():
    """在后台线程启动 uvicorn 服务。"""
    import uvicorn
    from server.config import settings

    uvicorn.run(
        "server.main:app",
        host="127.0.0.1",
        port=settings.api_port,
        reload=False,
        log_level="info",
    )


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

    # 在后台线程启动 FastAPI 服务
    server_thread = threading.Thread(target=_start_server, daemon=True)
    server_thread.start()

    # 在主线程启动 pywebview 桌面窗口
    _open_webview()


if __name__ == "__main__":
    main()
