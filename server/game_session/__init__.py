"""Shared game-session layer (Playwright): launch a game, follow complete plays, capture every
/casino/play response and the state trace. Used by TestData verification; meant to be reused by
the Portugal fetcher and future browser-driven tools.

    from server.game_session import open_session
    with open_session(LaunchSpec(url=...)) as gs:
        gs.finish_restored_play()
        result = gs.play("spin1")
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from server.game_session.capture import Captured, PlayCapture
from server.game_session.launcher import Browser, LaunchSpec, launch, open_browser
from server.game_session.protocol import PlayResponse
from server.game_session.session import (
    Cancelled, GameSession, PageReloaded, PlayResult, SessionConfig, SessionError, SpinNotStarted, StuckInState,
)

__all__ = [
    "Browser", "Captured", "Cancelled", "GameSession", "LaunchSpec", "PageReloaded", "PlayCapture", "PlayResponse",
    "PlayResult", "SessionConfig", "SessionError", "SpinNotStarted", "StuckInState", "open_session",
]


@contextmanager
def open_session(spec: LaunchSpec, *, headless: bool = True, trace_path: Path | None = None,
                 config: SessionConfig | None = None, log: Callable[..., None] | None = None,
                 cancel_event=None, enter_timeout_sec: float = 90.0) -> Iterator[GameSession]:
    browser = open_browser(headless=headless, trace_path=trace_path)
    try:
        capture = PlayCapture()
        page = launch(browser, spec, capture, timeout_sec=enter_timeout_sec)
        gs = GameSession(page=page, capture=capture, config=config or SessionConfig(),
                         log=log or (lambda *a, **k: None))
        if cancel_event is not None:
            gs.cancel_event = cancel_event
        gs.enter_game(timeout_sec=enter_timeout_sec)
        gs.set_time_scale()
        yield gs
    finally:
        browser.close()
