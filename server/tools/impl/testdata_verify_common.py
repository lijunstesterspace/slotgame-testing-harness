"""Shared helpers for the TestData verifier tools (testdata_verifier_harness,
testdata_verifier_api) and portugal_plugin_fetcher: the console.log response interceptor,
.testdata parsing, expected-vs-actual comparison, the standalone HTML report, and the Selenium
page-driving helpers those browser tools share.

These used to live in testdata_verifier_tool.py, the original Selenium verifier (real game URL +
borrowed Chrome profile + interactive Okta, testdata uploaded by clicking through the admin
panel). That tool was retired in favour of the Harness login and has been removed; only the
pieces the remaining tools share were kept here.

testdata_verifier_harness is no longer one of the Selenium consumers (it was rewritten on
server/game_session), but portugal_plugin_fetcher still is, so the browser helpers stay here
rather than in either tool.
"""
from __future__ import annotations
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse, parse_qs

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


def _extract_url_identity(game_url: str) -> dict:
    """Pull the `username` / `moduleId` query params off the game URL.

    These are the two values the real game environment uses to decide *which* uploaded
    .testdata file's seed queue to actually read from — see _check_key_matches_url()."""
    qs = parse_qs(urlparse(game_url).query)
    return {
        "username": (qs.get("username") or [""])[0],
        "moduleId": (qs.get("moduleId") or [""])[0],
    }


def _extract_testdata_key(filepath: Path) -> dict:
    """Read just the <Key moduleID=".." loginName=".."/> identity out of a .testdata file,
    without parsing the (possibly invalid, at this point still-unvalidated) spin records."""
    tree = ET.parse(str(filepath))
    key_elem = tree.getroot().find("Key")
    return {
        "moduleID": key_elem.get("moduleID", "") if key_elem is not None else "",
        "loginName": key_elem.get("loginName", "") if key_elem is not None else "",
    }


def _check_key_matches_url(testdata_key: dict, url_identity: dict) -> list[str]:
    """Verify a .testdata file's <Key> identity against the target game URL's query params.

    The real game environment silently ignores an uploaded .testdata file whenever its
    loginName/moduleID don't match the URL's username/moduleId — it just keeps serving
    whatever seed was already queued for that login instead (confirmed empirically: an
    uploaded batch/index only ever showed up in the game's response when both matched; a
    moduleId mismatch made the game return a completely unrelated seed with no error at all).
    Catching the mismatch here, before Selenium ever touches the browser, turns that silent
    wrong-seed failure into an immediate, specific error instead of a misleading PASS/FAIL
    report against data the game never actually used.
    """
    issues: list[str] = []
    if testdata_key["loginName"] != url_identity["username"]:
        issues.append(
            f"loginName mismatch: testdata Key loginName={testdata_key['loginName']!r} "
            f"!= URL username={url_identity['username']!r}"
        )
    if testdata_key["moduleID"] != url_identity["moduleId"]:
        issues.append(
            f"moduleID mismatch: testdata Key moduleID={testdata_key['moduleID']!r} "
            f"!= URL moduleId={url_identity['moduleId']!r}"
        )
    return issues


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


def _parse_testdata(filepath: Path) -> list[dict]:
    """Parse .testdata XML and return a list of expected spin records.

    Expected XML structure:
        <Test>
          <Key moduleID="..." loginName="..." />
          <Slot>
            <Spin stage="BaseGame">
              <PreGen batch="58" index="3" />
              <PreGen batch="2" index="67933" />   ← optional bonus
            </Spin>
            ...
          </Slot>
        </Test>
    """
    tree = ET.parse(str(filepath))
    root = tree.getroot()

    # Extract moduleID and loginName from <Key>
    key_elem = root.find("Key")
    module_id = key_elem.get("moduleID", "") if key_elem is not None else ""
    login_name = key_elem.get("loginName", "") if key_elem is not None else ""

    records: list[dict] = []
    slot = root.find("Slot")
    if slot is None:
        return records

    spin_index = 0
    for spin_elem in slot.findall("Spin"):
        stage = spin_elem.get("stage", "BaseGame")
        pregens = spin_elem.findall(".//PreGen")

        # Group PreGens: first is base, rest are bonus (if any)
        base_pre = None
        bonus_pres: list[dict] = []
        for pg in pregens:
            b = pg.get("batch")
            idx = pg.get("index")
            if b is not None and idx is not None:
                entry = {"batch": int(b), "index": int(idx)}
                if base_pre is None:
                    base_pre = entry
                else:
                    bonus_pres.append(entry)

        if base_pre is None:
            continue

        spin_index += 1
        record = {
            "spinIndex": spin_index,
            "stage": stage,
            "batch": base_pre["batch"],
            "index": base_pre["index"],
            "isBonus": len(bonus_pres) > 0,
            "bonusBatch": bonus_pres[0]["batch"] if bonus_pres else None,
            "bonusIndex": bonus_pres[0]["index"] if bonus_pres else None,
        }
        records.append(record)

    return records


def _compare_record(expected: dict, actual: dict) -> dict:
    """Compare expected testdata record with actual game response.

    Returns a dict with pass/fail details and fine-grained verdict.
    Verdict types (per skill-verification-protocol):
      PASSED | SEED_MISMATCH | STAGE_MISMATCH | PAYOUT_MISMATCH | SEED_REJECTED
    """
    issues: list[str] = []

    # Extract actual values from game response
    gd = actual.get("gameResponse", {})
    td = gd.get("testData", {})
    spin_td = td.get("spin", {})
    pre_gen = spin_td.get("preGen", {})
    financials = gd.get("financials", {})
    slot_info = gd.get("slot", {})

    actual_batch = pre_gen.get("batch")
    actual_index = pre_gen.get("index")
    actual_stage = slot_info.get("stage", "")
    actual_win = financials.get("win", 0)
    actual_wager = financials.get("wager", 0)

    # Compare batch
    batch_ok = actual_batch == expected["batch"]
    if not batch_ok:
        issues.append(f"batch mismatch: expected={expected['batch']}, actual={actual_batch}")

    # Compare index
    index_ok = actual_index == expected["index"]
    if not index_ok:
        issues.append(f"index mismatch: expected={expected['index']}, actual={actual_index}")

    # Compare stage
    stage_ok = actual_stage == expected["stage"]
    if not stage_ok:
        issues.append(f"stage mismatch: expected={expected['stage']}, actual={actual_stage}")

    passed = batch_ok and index_ok

    # Determine fine-grained verdict
    if passed and stage_ok:
        verdict = "PASSED"
    elif not batch_ok or not index_ok:
        verdict = "SEED_MISMATCH"
    elif not stage_ok:
        verdict = "STAGE_MISMATCH"
    else:
        verdict = "PASSED"

    return {
        "passed": passed,
        "verdict": verdict,
        "actualBatch": actual_batch,
        "actualIndex": actual_index,
        "actualStage": actual_stage,
        "actualWin": actual_win,
        "actualWager": actual_wager,
        "issues": issues,
    }


def _generate_html_report(
    records: list[dict],
    results: list[dict],
    game_url: str,
    testdata_file: str,
    output_path: Path,
    multi_file: bool = False,
) -> str:
    """Generate an HTML verification report with data comparison + screenshots."""
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    pass_rate = (passed / total * 100) if total > 0 else 0

    status_color = "#10b981" if failed == 0 else ("#f59e0b" if pass_rate >= 80 else "#ef4444")
    status_text = "ALL PASSED" if failed == 0 else f"{passed}/{total} PASSED"

    # Build per-file summary if multi-file
    file_summaries: dict[str, dict] = {}
    if multi_file:
        for rec, res in zip(records, results):
            sf = res.get("source_file", "unknown")
            if sf not in file_summaries:
                file_summaries[sf] = {"total": 0, "passed": 0, "failed": 0}
            file_summaries[sf]["total"] += 1
            if res["passed"]:
                file_summaries[sf]["passed"] += 1
            else:
                file_summaries[sf]["failed"] += 1

    # Build case rows
    case_rows = ""
    current_file = None
    for i, (rec, res) in enumerate(zip(records, results)):
        # File separator header for multi-file mode
        src_file = res.get("source_file", "")
        if multi_file and src_file != current_file:
            current_file = src_file
            fs = file_summaries.get(src_file, {})
            case_rows += f"""
        <div class="file-separator">
            <span class="file-separator-title">📄 {src_file}</span>
            <span class="file-separator-stats">{fs.get('passed', 0)}/{fs.get('total', 0)} passed</span>
        </div>"""

        badge_cls = "badge-pass" if res["passed"] else "badge-fail"
        badge_text = "PASS" if res["passed"] else "FAIL"
        issues_html = ""
        if res["issues"]:
            issues_html = '<div class="issues">' + "".join(
                f'<div class="issue-item">⚠ {iss}</div>' for iss in res["issues"]
            ) + "</div>"

        screenshot_html = ""
        if res.get("screenshot_b64"):
            screenshot_html = (
                f'<div class="screenshot-section">'
                f'<div class="screenshot-label">Game Screenshot</div>'
                f'<img src="data:image/png;base64,{res["screenshot_b64"]}" class="screenshot-img" />'
                f"</div>"
            )

        case_rows += f"""
        <div class="case-card {'case-pass' if res['passed'] else 'case-fail'}">
            <div class="case-header">
                <span class="case-title">Spin #{rec['spinIndex']}: {rec['stage']}</span>
                <span class="badge {badge_cls}">{badge_text}</span>
            </div>
            <div class="case-details">
                <div class="detail-row">
                    <span class="detail-label">Expected Seed</span>
                    <span class="detail-value">batch={rec['batch']}, index={rec['index']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Actual Seed</span>
                    <span class="detail-value">batch={res['actualBatch']}, index={res['actualIndex']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Stage</span>
                    <span class="detail-value">{res['actualStage']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Win Amount</span>
                    <span class="detail-value">{res['actualWin']}</span>
                </div>
                {f'<div class="detail-row"><span class="detail-label">Bonus Seed</span><span class="detail-value">batch={rec["bonusBatch"]}, index={rec["bonusIndex"]}</span></div>' if rec['isBonus'] else ''}
            </div>
            {issues_html}
            {screenshot_html}
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TestData Verification Report</title>
<style>
    :root {{
        --bg: #0f172a; --surface: #1e293b; --border: #334155;
        --text: #f1f5f9; --text-muted: #94a3b8;
        --green: #10b981; --red: #ef4444; --amber: #f59e0b; --cyan: #06b6d4;
    }}
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--bg); color: var(--text); padding: 2rem;
    }}
    .container {{ max-width: 960px; margin: 0 auto; }}
    header {{
        text-align: center; margin-bottom: 2rem;
        padding-bottom: 1.5rem; border-bottom: 1px solid var(--border);
    }}
    header h1 {{ font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }}
    header .meta {{ font-size: 0.8rem; color: var(--text-muted); }}
    .summary {{
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem;
    }}
    .summary-card {{
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.2rem; text-align: center;
    }}
    .summary-card .label {{ font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }}
    .summary-card .value {{ font-size: 1.8rem; font-weight: 700; margin-top: 0.3rem; }}
    .case-card {{
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.2rem; margin-bottom: 1rem;
    }}
    .case-pass {{ border-left: 4px solid var(--green); }}
    .case-fail {{ border-left: 4px solid var(--red); }}
    .case-header {{
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 0.8rem;
    }}
    .case-title {{ font-weight: 600; font-size: 0.95rem; }}
    .badge {{
        font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem;
        border-radius: 6px; text-transform: uppercase;
    }}
    .badge-pass {{ background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }}
    .badge-fail {{ background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }}
    .case-details {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }}
    .detail-row {{ display: flex; justify-content: space-between; padding: 0.3rem 0; }}
    .detail-label {{ font-size: 0.75rem; color: var(--text-muted); }}
    .detail-value {{ font-size: 0.8rem; font-family: monospace; }}
    .issues {{ margin-top: 0.8rem; }}
    .issue-item {{
        font-size: 0.75rem; color: var(--amber);
        padding: 0.3rem 0.5rem; background: rgba(245,158,11,0.1);
        border-radius: 6px; margin-bottom: 0.3rem;
    }}
    .screenshot-section {{ margin-top: 0.8rem; }}
    .screenshot-label {{ font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.3rem; }}
    .screenshot-img {{
        max-width: 100%; border-radius: 8px; border: 1px solid var(--border);
        cursor: pointer; transition: transform 0.2s;
    }}
    .screenshot-img:hover {{ transform: scale(1.02); }}
    .file-separator {{
        background: linear-gradient(90deg, rgba(6,182,212,0.1), transparent);
        border: 1px solid rgba(6,182,212,0.3); border-radius: 10px;
        padding: 0.8rem 1.2rem; margin: 1.5rem 0 0.8rem;
        display: flex; justify-content: space-between; align-items: center;
    }}
    .file-separator-title {{ font-weight: 700; font-size: 0.9rem; color: var(--cyan); }}
    .file-separator-stats {{ font-size: 0.8rem; color: var(--text-muted); font-family: monospace; }}
    .footer {{
        text-align: center; margin-top: 2rem; padding-top: 1rem;
        border-top: 1px solid var(--border); font-size: 0.7rem; color: var(--text-muted);
    }}
</style>
</head>
<body>
<div class="container">
    <header>
        <h1>TestData Verification Report</h1>
        <div class="meta">
            <div>Game: {game_url[:80]}...</div>
            <div>TestData: {testdata_file} &nbsp;|&nbsp; Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
        </div>
    </header>

    <div class="summary">
        <div class="summary-card">
            <div class="label">Status</div>
            <div class="value" style="color:{status_color}">{status_text}</div>
        </div>
        <div class="summary-card">
            <div class="label">Total Spins</div>
            <div class="value">{total}</div>
        </div>
        <div class="summary-card">
            <div class="label" style="color:var(--green)">Passed</div>
            <div class="value" style="color:var(--green)">{passed}</div>
        </div>
        <div class="summary-card">
            <div class="label" style="color:var(--red)">Failed</div>
            <div class="value" style="color:var(--red)">{failed}</div>
        </div>
    </div>

    <h2 style="font-size:1.1rem;margin-bottom:1rem;">Spin Validation Details</h2>
    {case_rows}

    <div class="footer">
        Slot Game Testing Harness &mdash; TestData Verification Report
    </div>
</div>
</body>
</html>"""

    output_path.write_text(html, encoding="utf-8")
    return str(output_path)


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


# ---------------------------------------------------------------------------
# Selenium page-driving helpers (currently used by portugal_plugin_fetcher).
# ---------------------------------------------------------------------------
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
