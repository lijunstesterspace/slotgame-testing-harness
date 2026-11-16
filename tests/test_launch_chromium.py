"""launch_chromium: installed Chrome → installed Edge → Playwright's Chromium, and a clear error if none."""
from types import SimpleNamespace

import pytest

from server.game_session.launcher import launch_chromium


def _pw(available: set):
    calls = []

    def launch(**kw):
        channel = kw.get("channel")
        calls.append(channel)
        if channel not in available:
            raise RuntimeError(f"Executable doesn't exist for {channel}\nmore detail")
        return SimpleNamespace(channel=channel, kw=kw)

    return SimpleNamespace(chromium=SimpleNamespace(launch=launch)), calls


def test_prefers_installed_chrome():
    pw, calls = _pw({"chrome", "msedge", None})
    assert launch_chromium(pw, headless=True).channel == "chrome"
    assert calls == ["chrome"]


def test_falls_back_to_edge_when_chrome_missing():
    pw, calls = _pw({"msedge"})
    browser = launch_chromium(pw, headless=False)
    assert browser.channel == "msedge" and browser.kw["headless"] is False
    assert calls == ["chrome", "msedge"]


def test_bundled_chromium_is_last_resort():
    pw, calls = _pw({None})
    assert launch_chromium(pw).channel is None
    assert calls == ["chrome", "msedge", None]


def test_no_browser_raises_readable_error():
    pw, _ = _pw(set())
    with pytest.raises(RuntimeError, match="no_browser_available"):
        launch_chromium(pw)
