"""
PyInstaller entry point.
Starts the uvicorn server + pywebview desktop window.
"""
import os
import multiprocessing
import sys
import threading
import time
from pathlib import Path

# In Windows no-console mode (console=False), sys.stdout / sys.stderr are None.
# They must be redirected, otherwise uvicorn and logging crash when they try to write.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


def _freeze_support():
    """Windows multiprocessing support (must be called after PyInstaller packaging)."""
    multiprocessing.freeze_support()


def _get_log_file() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "app_startup.log"
    return Path("app_startup.log")


def _start_server():
    """Start the uvicorn server in a background thread."""
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


class _DesktopApi:
    """Exposed to the page as window.pywebview.api.* — native dialogs return real absolute paths,
    which a browser <input type=file> never does. The window is stored with a leading underscore
    so pywebview does not try to expose it to JS as well."""

    def __init__(self):
        self._window = None

    def pick_folder(self) -> str:
        import webview
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else ""

    def pick_html_files(self) -> list:
        import webview
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=("HTML files (*.html;*.htm)", "All files (*.*)"),
        )
        return list(result) if result else []

    def open_path(self, path: str) -> bool:
        """Open a report or output folder with the Windows default handler. Limited to folders and
        report-type files so the page cannot launch arbitrary executables."""
        p = Path(path)
        if not p.exists():
            return False
        if p.is_file() and p.suffix.lower() not in (".html", ".htm", ".xlsx", ".txt", ".json", ".png"):
            return False
        os.startfile(str(p))
        return True


def _open_webview():
    """Wait for the server to be ready, then open the desktop window with pywebview."""
    import webview
    from server.config import settings

    # pywebview disables downloads by default (ALLOW_DOWNLOADS=False): on the Windows EdgeChromium backend,
    # clicking a link that triggers Content-Disposition: attachment (e.g. the "Download HTML Report"
    # button) makes on_download_starting set args.Cancel = True and silently cancel, with no
    # feedback at all in the UI - this is exactly why the packaged desktop app "clicked the download link but got nothing". When enabled,
    # the native system Save As dialog appears. Must be set before create_window().
    webview.settings["ALLOW_DOWNLOADS"] = True

    # Wait for the server to start
    import urllib.request
    url = f"http://127.0.0.1:{settings.api_port}"
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{url}/healthz", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    # Always open the main page; the frontend handles login internally (avoids pywebview opening two windows)
    page_url = f"{url}/"

    # Create the pywebview window
    api = _DesktopApi()
    window = webview.create_window(
        js_api=api,
        title=settings.app_name,
        url=page_url,
        width=1280,
        height=800,
        min_size=(800, 600),
        resizable=True,
        fullscreen=False,
    )
    api._window = window
    webview.start(debug=False)


def main():
    _freeze_support()
    try:
        with open(_get_log_file(), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] main() entered, argv={sys.argv}\n")
    except Exception:
        pass

    if "--server-only" in sys.argv:
        # Backend-only mode (for tests or headless environments)
        _start_server()
        while True:
            time.sleep(1)

    # Start the FastAPI server in a background thread
    server_thread = threading.Thread(target=_start_server, daemon=True)
    server_thread.start()

    # Start the pywebview desktop window in the main thread
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
