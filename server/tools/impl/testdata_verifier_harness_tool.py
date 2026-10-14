"""
Harness-based TestData verification — the "third" login mechanism.

Still browser-driven (Selenium), so screenshots keep working — unlike testdata_verifier_api.
But unlike testdata_verifier, the browser never touches the real production game URL, a borrowed
Chrome profile, or an interactive Okta/MFA prompt. It goes straight to an internal QA-only
"Titan Harness" launcher page instead — the same one a colleague's separate Playwright
automation suite (jftw-game-client-sdk-automation-axiom) already uses for its own login.

Confirmed against a live manual test (2026-09-16) against
  https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/harness/apexDragonPowerComboV94
The harness page is a plain HTML form (Username / Password / Product Id / Module Id / Client Id /
Brand, plus Market/Host dropdowns and some toggles left at their page defaults) that, once
submitted via its "LAUNCH GAME" button, drops straight into an authenticated game session — no
Okta, no MFA. Two things confirmed on that same manual test:
  - The Password field comes pre-filled with a single shared, non-expiring value (`test1234$`)
    for every QA test account on this platform — not a per-account secret we need to look up.
  - Username and Module Id are the *same* loginName/moduleID already embedded in a .testdata
    file's <Key> element (see _extract_testdata_key in testdata_verifier_tool.py) — this tool
    derives them from the file being verified rather than asking for them again.
  - Product Id / Client Id / Brand are NOT derivable from the testdata file — they're fixed per
    game-module version, not per test case — so they're plain tool parameters here, defaulted to
    the values confirmed working for moduleId 105170 (productId=5001, clientId=40300,
    brand=IslandParadise). Market/Host were left at the page's own defaults on that same test and
    are not touched by this tool at all — only fill in what was actually needed.

TestData upload uses the same direct-HTTP Axiom call as testdata_verifier_api (x-api-key header,
POST .../Upload/TestDataFile, field name testDataFormFile) instead of Selenium clicking through
the admin panel — that panel login also required Okta, so removing it here removes the *second*
Okta dependency this tool would otherwise still have.

UNVERIFIED: the exact DOM selectors for the harness page's input fields and "LAUNCH GAME" button
were written from a screenshot, not a live DOM inspection (this internal QA page isn't reachable
from outside the tester's own network). _fill_labeled_field() tries several common
formcontrolname/name/id/placeholder strategies per field and reports exactly which field it
couldn't find, but the very first live run against this tool should be watched closely — expect
to need one round of selector fixes, the same way testdata_verifier's upload-button and
splash-dismissal selectors were fixed after their first live runs.
"""
from __future__ import annotations
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verifier_tool import (
    _INTERCEPTOR_JS,
    _parse_testdata,
    _compare_record,
    _generate_html_report,
    _extract_testdata_key,
    _force_kill_driver,
    TestdataVerifierTool,
)
from server.tools.impl.testdata_verifier_api_tool import _derive_env, _axiomcore_host
from server.infra.logger import log

HARNESS_DEFAULT_PASSWORD = "test1234$"


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
    TestdataVerifierTool._click_spin's CSS-selector guessing.

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


class TestdataVerifierHarnessTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier_harness",
            description=(
                "Browser-driven TestData verification via the QA-only Titan Harness launcher "
                "page instead of the real production game URL — no Okta, no MFA, no borrowed "
                "Chrome profile. Uploads testdata directly to Axiom over HTTP (like "
                "testdata_verifier_api), then drives a fresh Chrome session through the harness "
                "form to reach an authenticated game session. Keeps screenshot capability "
                "(unlike testdata_verifier_api) since it stays browser-driven."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=False,
                              description="Absolute path to a single .testdata XML file (backward compat)."),
                ToolParameter(name="testdata_files", type="array", required=False,
                              description="List of absolute paths to .testdata XML files. All files in one "
                                          "run must share the same <Key loginName>/<moduleID> — a single "
                                          "harness session only logs into one account/module at a time."),
                ToolParameter(name="harness_url", type="string", required=True,
                              description="Full Titan Harness launcher page URL for this exact game version, "
                                          "e.g. https://mobile-app1-gtp537.installprogram.eu/htmlGames/"
                                          "4.54.0/harness/apexDragonPowerComboV94 — open it once in a normal "
                                          "browser to confirm the gameId/frameworkVersion slug."),
                ToolParameter(name="axiom_api_key", type="string", required=True,
                              description="Long-lived Axiom API Key ('x-api-key' header) — authenticates "
                                          "both the testdata upload and, indirectly, nothing else here; "
                                          "unrelated to the harness login itself."),
                ToolParameter(name="product_id", type="string", required=True,
                              description="Harness form's Product Id field. Fixed per game-module version, "
                                          "not derivable from the testdata file — confirmed 5001 for "
                                          "moduleId 105170 on gtp537."),
                ToolParameter(name="client_id", type="string", required=True,
                              description="Harness form's Client Id field. Fixed per game-module version — "
                                          "confirmed 40300 for moduleId 105170 on gtp537."),
                ToolParameter(name="brand", type="string", default="IslandParadise",
                              description="Harness form's Brand field."),
                ToolParameter(name="harness_password", type="string", default=HARNESS_DEFAULT_PASSWORD,
                              description="Harness form's Password field. A single shared value for every "
                                          "QA test account on this platform, not a per-account secret — the "
                                          "page itself pre-fills this same value by default."),
                ToolParameter(name="spin_delay_sec", type="number", default=3.0,
                              description="Seconds to wait between spins for the game to settle."),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
                ToolParameter(name="screenshot_on_bonus", type="boolean", default=True,
                              description="Take screenshot for bonus-trigger spins."),
                ToolParameter(name="screenshot_on_fail", type="boolean", default=True,
                              description="Take screenshot for failed spins."),
                ToolParameter(name="harness_load_timeout_sec", type="number", default=60,
                              description="Seconds to wait for the harness page (and, after clicking Launch, "
                                          "the game) to finish loading. No human MFA step is involved here, "
                                          "so this can be far shorter than testdata_verifier's "
                                          "admin_login_timeout_sec — 60s just covers normal page/network "
                                          "latency."),
            ]),
            permissions=["filesystem:write", "selenium", "network:outbound"],
            timeout_seconds=1800,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        import asyncio
        return await asyncio.to_thread(self._run_verification_sync, params, ctx)

    def _run_verification_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from server.infra import cancellation

        testdata_files_list: list[Path] = []
        if params.get("testdata_files"):
            for fp in params["testdata_files"]:
                p = Path(fp)
                if not p.exists():
                    return ToolResult(success=False, error=f"testdata_file_not_found:{p}")
                testdata_files_list.append(p)
        elif params.get("testdata_file"):
            p = Path(params["testdata_file"])
            if not p.exists():
                return ToolResult(success=False, error=f"testdata_file_not_found:{p}")
            testdata_files_list.append(p)
        else:
            return ToolResult(success=False, error="No testdata_file or testdata_files provided")

        harness_url: str = params["harness_url"]
        axiom_api_key: str = params["axiom_api_key"]
        product_id: str = str(params["product_id"])
        client_id: str = str(params["client_id"])
        brand: str = params.get("brand") or "IslandParadise"
        harness_password: str = params.get("harness_password") or HARNESS_DEFAULT_PASSWORD
        spin_delay: float = float(params.get("spin_delay_sec", 3.0))
        screenshot_bonus: bool = bool(params.get("screenshot_on_bonus", True))
        screenshot_fail: bool = bool(params.get("screenshot_on_fail", True))
        harness_load_timeout: int = int(params.get("harness_load_timeout_sec", 60))

        output = (
            Path(params["output_report"])
            if params.get("output_report")
            else (Path(ctx.work_dir) / "report.html")
        )
        output.parent.mkdir(parents=True, exist_ok=True)

        # ── Parse ALL testdata files, and enforce they share one identity ────
        all_records_by_file: dict[str, list[dict]] = {}
        keys_seen: set[tuple[str, str]] = set()
        for tf in testdata_files_list:
            try:
                records = _parse_testdata(tf)
            except Exception as e:
                return ToolResult(success=False, error=f"testdata_parse_error:{tf.name}:{e}")
            if not records:
                return ToolResult(success=False, error=f"testdata_file_contains_no_spins:{tf.name}")
            all_records_by_file[str(tf)] = records
            key = _extract_testdata_key(tf)
            keys_seen.add((key["loginName"], key["moduleID"]))

        if len(keys_seen) > 1:
            return ToolResult(
                success=False,
                error="testdata_files_have_different_identities:" + "; ".join(
                    f"loginName={ln!r},moduleID={mid!r}" for ln, mid in keys_seen
                ) + " — a single harness session only logs into one account/module; run these as separate batches.",
            )
        login_name, module_id = next(iter(keys_seen))
        if not login_name or not module_id:
            return ToolResult(success=False, error="testdata_key_missing_loginName_or_moduleID")

        env = _derive_env(harness_url)
        if not env:
            return ToolResult(success=False, error=f"could_not_derive_env_from_harness_url:{harness_url}")
        axiomcore_host = _axiomcore_host(env)

        log.info("verifier_harness.start", login_name=login_name, module_id=module_id,
                  files=len(testdata_files_list))

        # ── Upload every testdata file over HTTP first (no Okta, no browser needed) ──
        with httpx.Client(timeout=30.0) as client:
            for tf in testdata_files_list:
                try:
                    with open(tf, "rb") as fh:
                        upload_resp = client.post(
                            f"https://{axiomcore_host}/Upload/TestDataFile",
                            headers={"x-api-key": axiom_api_key},
                            files={"testDataFormFile": (tf.name, fh, "application/octet-stream")},
                        )
                except httpx.HTTPError as e:
                    return ToolResult(success=False, error=f"testdata_upload_request_failed:{tf.name}:{e}")
                if upload_resp.status_code != 200:
                    return ToolResult(
                        success=False,
                        error=f"testdata_upload_failed:{tf.name}:HTTP{upload_resp.status_code}:{upload_resp.text[:500]}",
                    )
                log.info("verifier_harness.uploaded", file=tf.name)

        # ── Chrome setup. No borrowed profile needed — the harness login has no session to
        # persist across runs (it's a fresh form submission every time), unlike Okta SSO. ──
        chrome_options = Options()
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)
        chrome_options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

        harness_host = urlparse(harness_url).hostname or ""
        if any(kw in harness_host.lower() for kw in ["installprogram.eu", "staging", "internal", "test", "dev"]):
            chrome_options.add_argument("--ignore-certificate-errors")

        driver = webdriver.Chrome(options=chrome_options)
        cancellation.register(ctx.execution_id, lambda: _force_kill_driver(driver))
        driver.maximize_window()
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _INTERCEPTOR_JS})

        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        all_results: list[dict] = []
        all_records_flat: list[dict] = []
        artifacts: list[str] = []

        try:
            # ── Navigate to the harness launcher page and fill the form ──
            log.info("verifier_harness.navigate", url=harness_url)
            driver.get(harness_url)

            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.common.by import By
            try:
                WebDriverWait(driver, harness_load_timeout).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "input"))
                )
            except Exception:
                return ToolResult(
                    success=False,
                    error=f"harness_page_did_not_load:{harness_url} (no <input> found within "
                          f"{harness_load_timeout}s)",
                )

            fields = [
                (["username"], login_name),
                (["password"], harness_password),
                (["productid", "product_id", "productId"], product_id),
                (["moduleid", "module_id", "moduleId"], module_id),
                (["clientid", "client_id", "clientId"], client_id),
                (["brand"], brand),
            ]
            missing_fields: list[str] = []
            for candidates, value in fields:
                if not _fill_labeled_field(driver, candidates, value):
                    missing_fields.append(candidates[0])
            if missing_fields:
                return ToolResult(
                    success=False,
                    error=f"harness_form_fields_not_found:{missing_fields} — the harness page's DOM "
                          f"selectors need a quick look (see this tool's module docstring); "
                          f"open harness_url manually and check these fields' formcontrolname/name/id.",
                )

            prior_handles = set(driver.window_handles)
            if not _click_button_by_text(driver, "LAUNCH GAME", timeout=harness_load_timeout):
                return ToolResult(success=False, error="harness_launch_game_button_not_found_or_not_clickable")

            # CONFIRMED on a live run: this harness page's "LAUNCH GAME" button opens the game in
            # a new tab/window and closes its own — without switching, every subsequent driver
            # call (execute_script, get_screenshot_as_png, ...) raised NoSuchWindowException
            # ("target window already closed") because `driver` was still bound to the now-dead
            # original handle. Poll window_handles for whichever handle is new (or, if the
            # original tab closed and only one handle remains, whichever handle isn't the one we
            # started with) and switch to that. If neither ever happens (the harness navigated in
            # place, same single handle throughout), switching to the sole remaining handle is a
            # harmless no-op.
            deadline = time.time() + harness_load_timeout
            new_handle = None
            while time.time() < deadline:
                try:
                    current_handles = driver.window_handles
                except Exception:
                    break
                diff = [h for h in current_handles if h not in prior_handles]
                if diff:
                    new_handle = diff[0]
                    break
                if len(current_handles) == 1 and current_handles[0] not in prior_handles:
                    new_handle = current_handles[0]
                    break
                time.sleep(0.5)
            try:
                driver.switch_to.window(new_handle or driver.window_handles[0])
            except Exception as e:
                return ToolResult(success=False, error=f"harness_no_window_remained_after_launch:{e}")

            game_context = _enter_game_context(driver, timeout_sec=harness_load_timeout)
            log.info("verifier_harness.launched", login_name=login_name, module_id=module_id,
                     game_context=game_context)

            if not _wait_for_spin_ready(driver, timeout_sec=60):
                log.warning("verifier_harness.spin_not_ready_after_wait")
                try:
                    ss_path = screenshots_dir / "after_launch_not_ready.png"
                    ss_path.write_bytes(driver.get_screenshot_as_png())
                    artifacts.append(str(ss_path.resolve()))
                except Exception:
                    pass

            _apply_time_scale(driver)

            driver.execute_script("window.__gvResponses = []; window.__gvSpinCount = 0;")

            # ── Auto-spin & verify each record ──
            all_records_this_run = [
                (Path(fp).name, rec) for fp, recs in all_records_by_file.items() for rec in recs
            ]
            consecutive_network_errors = 0
            consecutive_seed_rejections = 0
            max_consecutive_network_errors = 3
            max_consecutive_seed_rejections = 2
            environment_aborted = False

            for file_name, rec in all_records_this_run:
                if environment_aborted:
                    all_results.append({
                        "passed": False, "verdict": "NETWORK_ERROR",
                        "actualBatch": None, "actualIndex": None,
                        "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
                        "issues": ["Verification aborted: environment unavailable"],
                        "screenshot_b64": None, "source_file": file_name,
                    })
                    all_records_flat.append(rec)
                    continue

                log.info("verifier_harness.spin", spin=rec["spinIndex"], batch=rec["batch"], index=rec["index"])

                # A big-win result commonly triggers a win-celebration overlay that leaves the
                # spin button not-ready for a few seconds — touching jftw-spinButton while it's
                # still disabled silently no-ops (confirmed on a live run: alternating spins
                # after a big win came back TIMEOUT with zero errors raised anywhere). Waiting
                # for isSpinButtonReady() before *every* spin, not just once after launch, is
                # what actually needs to happen here.
                _wait_for_spin_ready(driver, timeout_sec=15)
                prev_count = driver.execute_script(
                    "return window.__gvResponses ? window.__gvResponses.length : 0;")
                if not _click_spin_via_jftw(driver):
                    TestdataVerifierTool._click_spin(driver)
                time.sleep(spin_delay)

                actual = None
                for _ in range(30):
                    curr_count = driver.execute_script(
                        "return window.__gvResponses ? window.__gvResponses.length : 0;")
                    if curr_count > prev_count:
                        actual = driver.execute_script(f"return window.__gvResponses[{curr_count - 1}];")
                        break
                    time.sleep(0.5)

                if actual is None:
                    result = {
                        "passed": False, "verdict": "TIMEOUT",
                        "actualBatch": None, "actualIndex": None,
                        "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
                        "issues": ["No game response captured within timeout"],
                        "screenshot_b64": None, "source_file": file_name,
                    }
                    # A TIMEOUT means _click_spin never produced a captured response at all —
                    # screenshotting here (unlike the pass/fail branch below, which only fires
                    # once a response *was* captured) is the only way to see what the page
                    # actually looked like when the click didn't register, while debugging this
                    # still-new tool's spin-button selectors against the harness-launched game.
                    try:
                        png_bytes = driver.get_screenshot_as_png()
                        import base64
                        result["screenshot_b64"] = base64.b64encode(png_bytes).decode("utf-8")
                        ss_path = screenshots_dir / f"{file_name}_spin{rec['spinIndex']}_timeout.png"
                        ss_path.write_bytes(png_bytes)
                        artifacts.append(str(ss_path.resolve()))
                    except Exception:
                        pass
                    consecutive_network_errors += 1
                    consecutive_seed_rejections = 0
                else:
                    result = _compare_record(rec, actual)
                    result["screenshot_b64"] = None
                    result["source_file"] = file_name

                    gd = actual.get("gameResponse", {})
                    error_msg = gd.get("error", "") or gd.get("errorMessage", "")
                    if error_msg and ("invalid" in error_msg.lower() or "reject" in error_msg.lower()):
                        result["verdict"] = "SEED_REJECTED"
                        result["passed"] = False
                        result["issues"].append(f"Server rejected seed: {error_msg}")
                        consecutive_seed_rejections += 1
                        consecutive_network_errors = 0
                    else:
                        consecutive_seed_rejections = 0
                        if result["passed"]:
                            consecutive_network_errors = 0

                    need_screenshot = (rec["isBonus"] and screenshot_bonus) or (
                        not result["passed"] and screenshot_fail)
                    if need_screenshot:
                        try:
                            png_bytes = driver.get_screenshot_as_png()
                            import base64
                            result["screenshot_b64"] = base64.b64encode(png_bytes).decode("utf-8")
                            ss_path = screenshots_dir / f"{file_name}_spin{rec['spinIndex']}_{'pass' if result['passed'] else 'fail'}.png"
                            ss_path.write_bytes(png_bytes)
                            artifacts.append(str(ss_path.resolve()))
                        except Exception:
                            pass

                if consecutive_network_errors >= max_consecutive_network_errors:
                    environment_aborted = True
                    result["issues"].append(
                        f"Environment UNAVAILABLE after {max_consecutive_network_errors} consecutive timeouts")
                elif consecutive_seed_rejections >= max_consecutive_seed_rejections:
                    environment_aborted = True
                    result["issues"].append(
                        f"Verification paused: {max_consecutive_seed_rejections} consecutive seeds rejected")

                all_results.append(result)
                all_records_flat.append(rec)

            # ── Generate report (same format as the other two tools) ──
            passed_count = sum(1 for r in all_results if r["passed"])
            total = len(all_results)
            is_multi = len(testdata_files_list) > 1
            report_label = (
                f"{len(testdata_files_list)} files batch verification (harness login: {login_name})"
                if is_multi else testdata_files_list[0].name
            )
            report_path = _generate_html_report(
                all_records_flat, all_results, harness_url, report_label, output, multi_file=is_multi,
            )
            artifacts.append(str(output.resolve()))

            report_url = None
            try:
                rel = Path(report_path).resolve().relative_to(Path(ctx.work_dir).resolve())
                report_url = f"/api/executions/runs/{ctx.execution_id}/testdata_verifier_harness/{rel.as_posix()}"
            except ValueError:
                pass

            return ToolResult(
                success=passed_count == total,
                content={
                    "total": total, "passed": passed_count,
                    "failed": total - passed_count,
                    "passRate": round(passed_count / total * 100, 1) if total else 0,
                    "report_html": report_path,
                    "report_url": report_url,
                    "files_processed": len(testdata_files_list),
                    "cases": [
                        {"spinIndex": rec["spinIndex"], "stage": rec["stage"],
                         "expectedBatch": rec["batch"], "expectedIndex": rec["index"],
                         "isBonus": rec["isBonus"], **r}
                        for rec, r in zip(all_records_flat, all_results)
                    ],
                },
                execution_ms=0, artifacts=artifacts,
            )

        except Exception as e:
            return ToolResult(success=False, error=f"verification_error:{type(e).__name__}:{e}")
        finally:
            cancellation.unregister(ctx.execution_id)
            try:
                driver.quit()
            except Exception:
                pass
