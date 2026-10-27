"""Selenium page-driving helpers, shared by the tools that still run on Selenium
(currently portugal_plugin_fetcher).

This is the Selenium counterpart of server/game_session: the same jobs — get into the game,
wait for the spin button, dismiss the splash, touch the screen, press Spin — driven through
WebDriver instead of Playwright. None of it is used by testdata_verifier_harness any more (it
was rewritten on game_session), and it lives here so that the .testdata parsing / comparison /
report code it left behind in testdata_verify_common does not have to carry Selenium with it.

Everything the harness page needs to be filled in with — its field list, its LAUNCH GAME
control, and the shared QA password — stays in server.game_session.launcher, which is the one
definition both browser stacks read.

All functions here are best-effort: they swallow their own errors and report failure by return
value, because a live game page is hostile to automation (canvas-rendered splashes, a debug
overlay that opens itself, iframes that attach late) and a hard failure mid-run would cost the
whole verification instead of one step.
"""
from __future__ import annotations
import time

from server.infra.logger import log

# ---------------------------------------------------------------------------
# JS injected via CDP *before* any page script runs.
# Overrides console.log to capture responseLogger objects into a global store.
# ---------------------------------------------------------------------------
_INTERCEPTOR_JS = r"""
(function() {
    if (window.__gvInstalled) return;
    window.__gvInstalled = true;
    window.__gvResponses = [];
    window.__gvSpinCount = 0;
    window.__gvLastError = null;

    var origLog = console.log;
    console.log = function() {
        origLog.apply(console, arguments);
        try {
            for (var i = 0; i < arguments.length; i++) {
                var arg = arguments[i];
                if (arg && typeof arg === 'object' && arg.gameResponse && arg.gameResponse.testData) {
                    window.__gvResponses.push(JSON.parse(JSON.stringify(arg)));
                }
            }
        } catch(e) {}
    };
})();
"""


def _fill_labeled_field(driver, candidates: list[str], value: str) -> bool:
    """Fill a text input matched by any of `candidates` (formcontrolname/name/id/placeholder,
    case-insensitive). The harness page's exact DOM wasn't inspectable ahead of time (internal,
    VPN-only), only screenshotted — trying several common Angular-Material-style attribute
    strategies per candidate is more robust than committing to a single guessed selector."""
    from selenium.webdriver.common.by import By
    for name in candidates:
        for by, sel in [
            (By.CSS_SELECTOR, f"input[formcontrolname='{name}' i]"),
            (By.CSS_SELECTOR, f"input[name='{name}' i]"),
            (By.CSS_SELECTOR, f"input#{name}"),
            (By.CSS_SELECTOR, f"input[placeholder='{name}' i]"),
        ]:
            try:
                el = driver.find_element(by, sel)
                if el.is_displayed():
                    el.clear()
                    el.send_keys(value)
                    return True
            except Exception:
                continue
    return False


def _click_button_by_text(driver, text: str, timeout: int = 20) -> bool:
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.common.by import By
    upper_text = text.upper()
    xpath = (
        "//*[self::button or self::a][contains("
        "translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), "
        f"'{upper_text}')]"
    )
    try:
        btn = WebDriverWait(driver, timeout).until(EC.element_to_be_clickable((By.XPATH, xpath)))
        btn.click()
        return True
    except Exception:
        return False


def _close_debug_panel_if_open(driver) -> None:
    """The harness-launched build exposes a "Mock Server / F2 Dev Panel" overlay that the real
    production URL never shows — confirmed on a live run: it ended up open (via a corner icon
    near the top-right of the screen — the same icon testdata_verifier's splash-dismissal fix
    was written to avoid clicking) while the feature splash was still showing underneath it, and
    its footprint sat over roughly the right quarter of the screen, right where a spin button
    commonly lives. If it's open, click that same corner icon again (it's a toggle) to close it."""
    try:
        is_open = driver.execute_script(
            "return !!Array.from(document.querySelectorAll('*')).find("
            "  el => el.textContent && el.textContent.includes('Mock Server') && el.offsetParent !== null);"
        )
    except Exception:
        return
    if not is_open:
        return
    try:
        driver.execute_script(
            "const x = Math.round(window.innerWidth * 0.965);"
            "const y = Math.round(window.innerHeight * 0.08);"
            "const el = document.elementFromPoint(x, y);"
            "if (el) { for (const t of ['mousedown','mouseup','click']) {"
            "  el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, clientX: x, clientY: y}));"
            "} }"
        )
    except Exception:
        pass
    time.sleep(1)


_JFTW_PRESENT_JS = "return !!(window.jftwTools && window.jftwTools.gameState && window.jftwTools.common);"


def _has_jftw(driver) -> bool:
    try:
        return bool(driver.execute_script(_JFTW_PRESENT_JS))
    except Exception:
        return False


def _trusted_click(driver, fx: float, fy: float) -> None:
    """Click at a fraction of the top-level viewport via CDP Input.dispatchMouseEvent.

    Unlike a JS-dispatched MouseEvent (isTrusted=false, which canvas-rendered splashes ignore —
    see _wait_for_spin_ready), CDP input goes through the browser's real input pipeline, so it is
    hit-tested like a human click: it reaches a <canvas>, and it reaches into an iframe the game
    may be running in. Coordinates are always top-level-viewport CSS pixels, regardless of which
    frame the driver is currently switched into, so the size comes from Page.getLayoutMetrics
    rather than the current frame's window.innerWidth."""
    try:
        m = driver.execute_cdp_cmd("Page.getLayoutMetrics", {})
        vp = m.get("cssLayoutViewport") or m.get("layoutViewport") or {}
        x = round(vp["clientWidth"] * fx)
        y = round(vp["clientHeight"] * fy)
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
        for t in ("mousePressed", "mouseReleased"):
            driver.execute_cdp_cmd("Input.dispatchMouseEvent",
                                   {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})
    except Exception:
        pass


def _enter_game_context(driver, timeout_sec: int) -> str:
    """Wait for window.jftwTools to attach, switching into the game's iframe if that's where it
    lives, and make sure the console.log interceptor is installed in that same context.

    Replaces a fixed `time.sleep(3)` followed by a single jftwTools check. On a live run against
    grandBountyOpenWatersPowerComboDesktop (4.60.0) the browser then sat on the feature splash
    ("PRESS ANYWHERE TO CONTINUE") indefinitely: either the (larger, desktop) bundle hadn't attached
    jftwTools within 3s, or the launch page hosts the game in an iframe where the top-level
    `window.jftwTools` never exists — both sent _wait_for_spin_ready down its no-jftw fallback.
    Polls the top document and its iframes until timeout. Returns "top", "iframe[<n>]" or
    "not_found" (driver left on the top document) for logging.
    """
    from selenium.webdriver.common.by import By
    deadline = time.time() + timeout_sec
    where = "not_found"
    while time.time() < deadline:
        driver.switch_to.default_content()
        if _has_jftw(driver):
            where = "top"
            break
        try:
            frames = driver.find_elements(By.TAG_NAME, "iframe")
        except Exception:
            frames = []
        for i, frame in enumerate(frames):
            try:
                driver.switch_to.frame(frame)
                if _has_jftw(driver):
                    where = f"iframe[{i}]"
                    break
            except Exception:
                pass
            driver.switch_to.default_content()
        if where != "not_found":
            break
        time.sleep(1)

    # Page.addScriptToEvaluateOnNewDocument was registered on the harness tab before LAUNCH GAME
    # opened the game in a *new* tab — CDP registrations are per-target, so it may never have run
    # here. Register it on this target too (covers any later reload), and install it right now if
    # it's missing. A late install still catches every future console.log call made through the
    # global console object, which is all the interceptor relies on.
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _INTERCEPTOR_JS})
    except Exception:
        pass
    try:
        if not driver.execute_script("return !!window.__gvInstalled;"):
            driver.execute_script(_INTERCEPTOR_JS)
            log.warning("verifier_harness.interceptor_late_install", context=where)
    except Exception:
        pass
    return where


def _wait_for_spin_ready(driver, timeout_sec: int) -> bool:
    """Dismiss the intro/feature-splash and wait for the spin button to be ready.

    CONFIRMED on a live run: this game's splash is canvas-rendered, not real DOM — a raw
    synthetic MouseEvent dispatched via document.elementFromPoint(x,y).dispatchEvent(...) (the
    same technique _dismiss_feature_splash uses) never progressed
    window.jftwTools.gameState.getActiveGameState() past 'IntroStart' even after 24s of polling.
    window.jftwTools.common.touch(x, y) — the game's own debug/test API (see
    jftw-game-client-sdk-automation-axiom's `window.jftwTools` usage) — IS recognized as a real
    touch and reliably advanced the state to 'Idle' with isSpinButtonReady() true within one 2s
    poll cycle on that same run.

    jftwTools is re-checked on every poll (it can attach after this starts), and a trusted CDP
    click (_trusted_click) backs up the jftw touch on alternate polls in case a game build's
    touch() ignores the coordinates we pass. Without jftwTools there is no readiness signal, so
    the fallback makes a few trusted clicks and proceeds optimistically — a trusted click, unlike
    the old synthetic MouseEvent, does actually reach a canvas splash.
    """
    deadline = time.time() + timeout_sec
    attempt = 0
    while time.time() < deadline:
        has_jftw = _has_jftw(driver)
        if has_jftw:
            try:
                if driver.execute_script("return window.jftwTools.gameState.isSpinButtonReady();"):
                    return True
            except Exception:
                pass
        elif attempt >= 3:
            _close_debug_panel_if_open(driver)
            return True
        attempt += 1
        if has_jftw:
            try:
                # {x, y} object form matches the colleague's automation suite's own usage
                # (src/js/client/misc.js's touch()).
                driver.execute_script(
                    "const w = window.innerWidth, h = window.innerHeight;"
                    "window.jftwTools.common.touch({x: Math.round(w*0.5), y: Math.round(h*0.6)});"
                )
            except Exception:
                pass
        if not has_jftw or attempt % 2 == 0:
            _trusted_click(driver, 0.5, 0.6)
        time.sleep(2)
    try:
        state = driver.execute_script(
            "try { return window.jftwTools.gameState.getActiveGameState(); } catch (e) { return null; }")
    except Exception:
        state = None
    log.warning("verifier_harness.spin_not_ready", timeout_sec=timeout_sec, game_state=state)
    return False


def _apply_time_scale(driver, scale: int = 2000) -> None:
    """Speed up the game engine's own animation clock via window.jftwTools.gameEngine.timeScale.

    Ported from the colleague's automation suite (src/js/util.js's timeScale(), called once by
    states.js's waitUntilGameLoad right after the splash is dismissed). Without this, a big-win
    result plays its full win-celebration animation before the spin button re-enables — on a live
    run of this tool, that showed up as alternating spins TIMING OUT right after a big win (the
    button was genuinely just not ready yet, not broken). Compressing the animation clock 2000x
    makes celebrations resolve in a fraction of a second instead, which is what the colleague's
    suite relies on for exactly this reason. Best-effort: swallows errors so a game build without
    this debug hook (or without jftwTools at all) just runs at normal speed instead of failing.
    """
    try:
        driver.execute_script(f"window.jftwTools.gameEngine.timeScale({scale});")
    except Exception:
        pass


def _click_spin_via_jftw(driver) -> bool:
    """Press Spin via window.jftwTools.button.touch('jftw-spinButton').

    CONFIRMED on a live run: this triggered a real spin and produced a captured console.log
    response — the component id came from window.jftwTools.common.getComponentsId()'s
    `keypad`/`legacy` groups (NOT the 'uiSpinButton' id mentioned in an unrelated Spine-atlas
    console warning, which turned out to be a red herring). Returns False (rather than raising)
    when jftwTools isn't available, so the caller can fall back to
    _click_spin_by_selector's CSS-selector guessing.

    The isEnabledVisually check + short pauses before/after the touch mirror the colleague's
    automation suite's touchSpinButton() (src/js/client/keypad.js) — their comment there notes
    the pauses exist "to ensure the button state/action is updated/processed"; harmless to keep
    even though our own isSpinButtonReady() poll (see _wait_for_spin_ready) already gates this.
    """
    try:
        if not driver.execute_script("return !!(window.jftwTools && window.jftwTools.button);"):
            return False
        driver.execute_script("window.jftwTools.button.isEnabledVisually('jftw-spinButton');")
        time.sleep(0.3)
        driver.execute_script("window.jftwTools.button.touch('jftw-spinButton');")
        time.sleep(0.3)
        return True
    except Exception:
        return False


def _click_spin_by_selector(driver) -> None:
    """Fallback Spin click for a game build without window.jftwTools: tries common DOM
    selectors, then a Space key press."""
    from selenium.webdriver.common.by import By
    selectors = [
        # Common spin button selectors
        (By.CSS_SELECTOR, "button.spin-button"),
        (By.CSS_SELECTOR, ".spin-btn"),
        (By.CSS_SELECTOR, "#spinButton"),
        (By.CSS_SELECTOR, "[data-action='spin']"),
        (By.CSS_SELECTOR, "button[class*='spin' i]"),
        (By.CSS_SELECTOR, "div[class*='spin' i] button"),
        # SVG spin button
        (By.CSS_SELECTOR, "svg[class*='spin' i]"),
        # Fallback: look for the large circular button on the right
        (By.CSS_SELECTOR, "button:last-of-type"),
    ]
    for by, sel in selectors:
        try:
            el = driver.find_element(by, sel)
            if el.is_displayed():
                el.click()
                return
        except Exception:
            continue

    # Last resort: send Space key
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    ActionChains(driver).send_keys(Keys.SPACE).perform()


def _force_kill_driver(driver) -> None:
    """Hard-kill the browser session for cancellation.

    driver.quit() waits for the browser to respond over its normal control channel — this does
    NOT interrupt an in-flight blocked call. Measured directly: a driver.get() stuck on an
    unreachable host ran to its own ~20s OS-level network timeout regardless of quit() being
    called from another thread while it was blocked. Killing chromedriver's OS process instead
    breaks the underlying connection immediately, which does interrupt it (~3s in the same test).

    `/T` (tree-kill) is required, not optional: chromedriver spawns the actual Chrome process as
    a child, and killing only chromedriver orphans that Chrome window running (and consuming
    memory) indefinitely instead of closing it — confirmed by inspecting the process tree.
    """
    import platform
    import subprocess
    pid = None
    try:
        pid = driver.service.process.pid
    except Exception:
        pass
    if pid and platform.system() == "Windows":
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=5)
            return
        except Exception:
            pass
    # Non-Windows, or taskkill unavailable: best effort via the normal (non-instant) path.
    try:
        driver.quit()
    except Exception:
        pass
