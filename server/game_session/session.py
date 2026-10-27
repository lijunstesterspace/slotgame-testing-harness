"""GameSession — drive one launched game through complete plays, event-by-event.

A *play* is one player-initiated spin plus everything the game auto-plays after it (free spins,
bonus steps, outros). It is over when `jftwTools.gameState.isGamePlayActive()` is false and the spin
button is ready again. `onGameRoundComplete` is NOT used for this: it fires at the end of the base
round, before the feature starts (confirmed live, docs/p0-testdata-verification-findings.md §3).

Blocking screens (feature intros/outros, "PRESS ANYWHERE TO CONTINUE", big-win presentations) are
advanced by touching, repeatedly, until the state actually changes: a live BonusOutro ignored a touch
1.5 s after it appeared and accepted one ~23 s later, so a single well-timed touch is not reliable.

State is traced inside the page (a 50 ms setInterval polling getActiveGameState()), which also sees
game-specific states that slot-core's getSlotState() list does not contain (BONUS_SPIN, UNLOCK_ROW, ...).
The tracer's random id doubles as reload detection: browser-sync reloads the page whenever the local
client is rebuilt, and a fresh page has no tracer (or a different id).
"""
from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from server.game_session.capture import Captured, PlayCapture

JFTW_READY_JS = "() => !!(window.jftwTools && window.jftwTools.gameState && window.jftwTools.common)"

TRACER_JS = """() => {
  if (window.__gsTracer) return window.__gsTracer.id;
  const id = Math.random().toString(36).slice(2);
  const trace = [];
  let last = null;
  setInterval(() => {
    try {
      const s = window.jftwTools.gameState.getActiveGameState();
      if (s !== last) { trace.push([Date.now(), s]); last = s; }
    } catch (e) {}
  }, 50);
  window.__gsTracer = { id, trace };
  return id;
}"""

STATUS_JS = """() => {
  const t = window.jftwTools, g = t && t.gameState;
  if (!g) return { jftw: false, tracerId: window.__gsTracer ? window.__gsTracer.id : null };
  const safe = f => { try { return f(); } catch (e) { return null; } };
  return {
    jftw: true,
    state: safe(() => g.getActiveGameState()),
    playActive: !!safe(() => g.isGamePlayActive()),
    spinReady: !!safe(() => g.isSpinButtonReady()),
    restore: !!safe(() => g.getIsRefreshRestore()),
    serverState: safe(() => g.getCurrentServerState()),
    nextServerState: safe(() => g.getNextServerState()),
    tracerId: window.__gsTracer ? window.__gsTracer.id : null,
    traceLen: window.__gsTracer ? window.__gsTracer.trace.length : 0,
  };
}"""

TRACE_SINCE_JS = "(i) => window.__gsTracer ? window.__gsTracer.trace.slice(i) : []"

TOUCH_JS = """async ([fx, fy]) => {
  await window.jftwTools.common.touch({ x: Math.round(innerWidth * fx), y: Math.round(innerHeight * fy) });
  return true;
}"""

SPIN_JS = "async () => { await window.jftwTools.button.touch('jftw-spinButton'); return true; }"

# States that wait for the player. Matched case-insensitively against the active state name.
BLOCKING_STATE = re.compile(r"(intro|outro|summary|splash|bigwin|big_win|continue|collect)", re.I)


class SessionError(Exception):
    """Base class: every failure carries the state it happened in, for the report."""

    def __init__(self, code: str, message: str, state: str | None = None):
        super().__init__(f"{code}: {message}")
        self.code, self.message, self.state = code, message, state


class StuckInState(SessionError):
    def __init__(self, state: str | None, dwell_sec: float, touches: int):
        super().__init__("STUCK_IN_STATE",
                         f"game stayed in {state!r} for {dwell_sec:.0f}s ({touches} touches did not advance it)",
                         state)
        self.dwell_sec, self.touches = dwell_sec, touches


class PageReloaded(SessionError):
    def __init__(self, state: str | None = None):
        super().__init__("PAGE_RELOADED",
                         "the game page reloaded mid-run (browser-sync rebuild of the local client?)", state)


class SpinNotStarted(SessionError):
    def __init__(self, state: str | None):
        super().__init__("SPIN_NOT_STARTED", "pressing Spin did not start a game play", state)


class Cancelled(SessionError):
    def __init__(self):
        super().__init__("CANCELLED", "stopped by the user")


@dataclass
class PlayResult:
    """Everything observed during one play — evidence for the matcher, judge and report."""
    responses: list[Captured]
    states: list[tuple[int, str]]          # [epoch_ms, state] transitions, in order
    started_at: float
    ended_at: float
    touches: int
    restored: bool = False                 # a play the page restored on load, not one we started
    screenshot: str | None = None
    error: SessionError | None = None

    @property
    def state_names(self) -> list[str]:
        return [s for _, s in self.states]

    def to_json(self) -> dict[str, Any]:
        return {
            "restored": self.restored, "startedAt": self.started_at, "endedAt": self.ended_at,
            "durationSec": round(self.ended_at - self.started_at, 2), "touches": self.touches,
            "states": self.states, "responses": [c.to_json() for c in self.responses],
            "screenshot": self.screenshot,
            "error": {"code": self.error.code, "message": self.error.message, "state": self.error.state}
            if self.error else None,
        }


@dataclass
class SessionConfig:
    time_scale: int = 400                  # jftwTools.gameEngine.timeScale percent (100 = normal speed)
    poll_sec: float = 0.25
    touch_after_sec: float = 1.5           # dwell in a blocking state before the first touch
    touch_every_sec: float = 2.0           # then keep touching at this interval until the state changes
    stall_touch_after_sec: float = 8.0     # any state, no progress at all for this long -> touch too
    play_timeout_sec: float = 300.0        # one play, start to idle (long bonuses are slow)
    stuck_after_sec: float = 90.0          # one state, no progress, touches not helping
    spin_start_timeout_sec: float = 10.0
    # Where "press to continue" is. Screen centre works for full-screen "PRESS ANYWHERE" outros, but a
    # feature intro may only react to its own START button (Mega Eagle 2 landscape: bottom centre), and
    # such scene buttons are not jftwTools UI components, so they cannot be touched by id. During a play
    # the session rotates through these points and remembers the one that last advanced the game.
    # Outside a play (pre-game splash) only the first point is used, so idle UI (bet menu etc.) is never hit.
    touch_points: tuple[tuple[float, float], ...] = ((0.5, 0.6), (0.5, 0.9), (0.5, 0.75))


@dataclass
class GameSession:
    page: Any                              # playwright Page hosting the game
    capture: PlayCapture
    config: SessionConfig = field(default_factory=SessionConfig)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    log: Callable[..., None] = lambda *a, **k: None
    frame: Any = None                      # the frame window.jftwTools lives in (top or an iframe)
    _tracer_id: str | None = None
    _trace_read: int = 0
    _good_point: int = 0                   # index into config.touch_points that last advanced the game
    _rotation: int = 0

    # ── attach ──────────────────────────────────────────────────────────────
    def enter_game(self, timeout_sec: float = 90.0) -> str:
        """Find the frame that exposes window.jftwTools (top document first) and start the tracer."""
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            self._check_cancel()
            for fr in [self.page.main_frame, *[f for f in self.page.frames if f != self.page.main_frame]]:
                try:
                    if fr.evaluate(JFTW_READY_JS):
                        self.frame = fr
                        self._tracer_id = fr.evaluate(TRACER_JS)
                        self._trace_read = 0
                        where = "top" if fr == self.page.main_frame else f"iframe:{fr.url.split('?')[0]}"
                        self.log("game_session.entered", where=where)
                        return where
                except Exception:
                    continue
            time.sleep(0.5)
        raise SessionError("JFTW_NOT_FOUND", f"window.jftwTools did not appear within {timeout_sec:.0f}s")

    def set_time_scale(self, percent: int | None = None) -> None:
        pct = int(percent or self.config.time_scale)
        try:
            self.frame.evaluate(f"() => window.jftwTools.gameEngine.timeScale({pct})")
        except Exception:
            self.log("game_session.time_scale_unavailable", percent=pct)

    # ── primitives ──────────────────────────────────────────────────────────
    def status(self) -> dict[str, Any]:
        try:
            st = self.frame.evaluate(STATUS_JS)
        except Exception:
            raise PageReloaded()
        if st.get("tracerId") != self._tracer_id:
            raise PageReloaded(st.get("state"))
        return st

    def is_idle(self, st: dict[str, Any] | None = None) -> bool:
        st = st or self.status()
        return bool(st.get("jftw")) and not st.get("playActive") and bool(st.get("spinReady"))

    def touch(self, point: tuple[float, float] | None = None) -> None:
        """jftwTools.common.touch at `point` (viewport fractions); a trusted Playwright click if jftw rejects it."""
        fx, fy = point or self.config.touch_points[0]
        try:
            self.frame.evaluate(TOUCH_JS, [fx, fy])
            return
        except Exception:
            pass
        box = None
        try:
            if self.frame != self.page.main_frame:
                box = self.frame.frame_element().bounding_box()
        except Exception:
            box = None
        vp = self.page.viewport_size or {"width": 1280, "height": 720}
        ox, oy = (box["x"], box["y"]) if box else (0, 0)
        w, h = (box["width"], box["height"]) if box else (vp["width"], vp["height"])
        self.page.mouse.click(ox + w * fx, oy + h * fy)

    def screenshot(self, path: Path) -> str | None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(path))
            return str(path)
        except Exception:
            return None

    def new_states(self) -> list[tuple[int, str]]:
        try:
            got = self.frame.evaluate(TRACE_SINCE_JS, self._trace_read) or []
        except Exception:
            return []
        self._trace_read += len(got)
        return [(int(t), str(s)) for t, s in got]

    # ── plays ───────────────────────────────────────────────────────────────
    def wait_until_idle(self, timeout_sec: float | None = None) -> tuple[list[tuple[int, str]], int]:
        """Advance blocking screens until the game is idle. Returns (state transitions seen, touches)."""
        cfg = self.config
        timeout = timeout_sec or cfg.play_timeout_sec
        start = time.time()
        states: list[tuple[int, str]] = []
        touches = 0
        last_state, state_since = None, time.time()
        last_progress = time.time()           # any new state or response
        last_touch = 0.0
        pending_point: int | None = None      # touch point awaiting proof that it advanced the game
        seen_responses = self.capture.next_seq
        while True:
            self._check_cancel()
            st = self.status()
            fresh = self.new_states()
            if fresh:
                states.extend(fresh)
                last_progress = time.time()
            if self.capture.next_seq != seen_responses:
                seen_responses = self.capture.next_seq
                last_progress = time.time()
            state = st.get("state")
            if state != last_state:
                if pending_point is not None:
                    self._good_point, self._rotation = pending_point, 0
                    pending_point = None
                last_state, state_since = state, time.time()
            if self.is_idle(st):
                return states, touches
            now = time.time()
            dwell, stalled = now - state_since, now - last_progress
            in_play = bool(st.get("playActive"))
            blocking = bool(state and BLOCKING_STATE.search(state)) or not in_play
            due = (blocking and dwell >= cfg.touch_after_sec) or stalled >= cfg.stall_touch_after_sec
            if due and now - last_touch >= cfg.touch_every_sec:
                points = cfg.touch_points
                idx = (self._good_point + self._rotation) % len(points) if in_play else 0
                self._rotation += 1 if in_play else 0
                self.touch(points[idx])
                pending_point = idx
                touches += 1
                last_touch = now
                self.log("game_session.touch", state=state, point=points[idx],
                         dwell=round(dwell, 1), stalled=round(stalled, 1))
            if stalled >= cfg.stuck_after_sec:
                raise StuckInState(state, dwell, touches)
            if now - start >= timeout:
                raise StuckInState(state, dwell, touches)
            time.sleep(cfg.poll_sec)

    def finish_restored_play(self, shots_dir: Path | None = None) -> PlayResult | None:
        """If the page restored an unfinished play (or is mid-feature) on load, play it out first so
        the first .testdata record is not attributed to it. Returns None when the game was already idle."""
        st = self.status()
        if self.is_idle(st) and not st.get("restore"):
            return None
        started, first_seq = time.time(), 0
        result = PlayResult(responses=[], states=[], started_at=started, ended_at=started, touches=0, restored=True)
        try:
            result.states, result.touches = self.wait_until_idle()
        except SessionError as e:
            result.error = e
        result.responses = self.capture.since(first_seq)
        result.ended_at = time.time()
        if shots_dir:
            result.screenshot = self.screenshot(shots_dir / f"restored_{int(started)}.png")
        return result

    def play(self, label: str = "play", shots_dir: Path | None = None) -> PlayResult:
        """Press Spin once and follow the whole play until the game is idle again."""
        cfg = self.config
        first_seq = self.capture.next_seq
        started = time.time()
        result = PlayResult(responses=[], states=self.new_states(), started_at=started, ended_at=started, touches=0)
        try:
            pre_states, _ = self.wait_until_idle()   # a previous play's outro may still be up
            result.states += pre_states
            first_seq = self.capture.next_seq
            self.frame.evaluate(SPIN_JS)
            deadline = time.time() + cfg.spin_start_timeout_sec
            while time.time() < deadline:
                self._check_cancel()
                st = self.status()
                if st.get("playActive") or self.capture.next_seq > first_seq:
                    break
                time.sleep(cfg.poll_sec)
            else:
                raise SpinNotStarted(self.status().get("state"))
            states, touches = self.wait_until_idle()
            result.states += states
            result.touches = touches
        except PageReloaded as e:
            result.error = e
        except SessionError as e:
            result.error = e
            result.states += self.new_states()
        result.responses = self.capture.since(first_seq)
        result.ended_at = time.time()
        if shots_dir:
            tag = "fail" if result.error else "end"
            result.screenshot = self.screenshot(shots_dir / f"{label}_{tag}.png")
        self.log("game_session.play_done", label=label, responses=len(result.responses),
                 states=len(result.states), touches=result.touches,
                 error=result.error.code if result.error else None)
        return result

    def _check_cancel(self) -> None:
        if self.cancel_event.is_set():
            raise Cancelled()
