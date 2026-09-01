from __future__ import annotations
import base64
import json
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.config import ROOT_DIR

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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _derive_admin_testdata_url(game_url: str) -> str:
    """Derive TestData upload page URL from the game URL.

    mobile-app1-gtp537.installprogram.eu/...  →
    admin-app1-gtp537.installprogram.eu/TestData
    """
    parsed = urlparse(game_url)
    host = parsed.hostname or ""
    admin_host = host.replace("mobile-app1-", "admin-app1-", 1)
    return f"{parsed.scheme}://{admin_host}/TestData"


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

    Returns a dict with pass/fail details.
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

    return {
        "passed": passed,
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
) -> str:
    """Generate an HTML verification report with data comparison + screenshots."""
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    pass_rate = (passed / total * 100) if total > 0 else 0

    status_color = "#10b981" if failed == 0 else ("#f59e0b" if pass_rate >= 80 else "#ef4444")
    status_text = "ALL PASSED" if failed == 0 else f"{passed}/{total} PASSED"

    # Build case rows
    case_rows = ""
    for i, (rec, res) in enumerate(zip(records, results)):
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
            <div>TestData: {Path(testdata_file).name} &nbsp;|&nbsp; Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
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
        Slot AI Harness &mdash; TestData Verification Report
    </div>
</div>
</body>
</html>"""

    output_path.write_text(html, encoding="utf-8")
    return str(output_path)


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------

class TestdataVerifierTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier",
            description=(
                "Uploads .testdata to the game admin panel, opens the game in Chrome, "
                "auto-spins and intercepts responseLogger via console.log. "
                "Compares actual seed/payout against expected values. "
                "Returns HTML report with data comparison + screenshots for bonus/failed cases."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=True,
                              description="Absolute path to .testdata XML file."),
                ToolParameter(name="target_url", type="string", required=True,
                              description="Full game environment URL (must contain username & moduleId)."),
                ToolParameter(name="spin_delay_sec", type="number", default=3.0,
                              description="Seconds to wait between spins for the game to settle."),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
                ToolParameter(name="screenshot_on_bonus", type="boolean", default=True,
                              description="Take screenshot for bonus-trigger spins."),
                ToolParameter(name="screenshot_on_fail", type="boolean", default=True,
                              description="Take screenshot for failed spins."),
            ]),
            permissions=["filesystem:write", "selenium", "network:outbound"],
            timeout_seconds=900,
            version="2.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from server.infra.logger import log

        # ── Extract params ──────────────────────────────────────────
        testdata_file = Path(params["testdata_file"])
        if not testdata_file.exists():
            return ToolResult(success=False, error=f"testdata_file_not_found:{testdata_file}")

        target_url: str = params["target_url"]
        spin_delay: float = float(params.get("spin_delay_sec", 3.0))
        screenshot_bonus: bool = bool(params.get("screenshot_on_bonus", True))
        screenshot_fail: bool = bool(params.get("screenshot_on_fail", True))

        output = (
            Path(params["output_report"])
            if params.get("output_report")
            else (Path(ctx.work_dir) / "report.html")
        )
        output.parent.mkdir(parents=True, exist_ok=True)

        # ── Parse testdata ─────────────────────────────────────────
        try:
            records = _parse_testdata(testdata_file)
        except Exception as e:
            return ToolResult(success=False, error=f"testdata_parse_error:{e}")

        if not records:
            return ToolResult(success=False, error="testdata_file_contains_no_spins")

        # ── Derive admin TestData URL from game URL ────────────────
        admin_url = _derive_admin_testdata_url(target_url)

        # ── Setup Chrome with CDP interceptor ──────────────────────
        chrome_options = Options()
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)
        # Enable browser console log capture
        chrome_options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

        driver = webdriver.Chrome(options=chrome_options)
        driver.maximize_window()

        # Inject interceptor BEFORE any page script runs
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": _INTERCEPTOR_JS,
        })

        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        results: list[dict] = []
        artifacts: list[str] = []

        try:
            # ── Step 1: Navigate to admin TestData page ─────────────
            # If Okta SSO is required, the page will redirect to Okta login.
            # User must manually complete login (just like the original script
            # waited for "Press Enter"). We poll until we reach the admin page.
            log.info("verifier.navigate_admin", url=admin_url)
            driver.get(admin_url)

            # Wait for admin page to load (handle Okta redirect)
            admin_host = urlparse(admin_url).hostname or ""
            max_wait = 120  # seconds
            waited = 0
            while waited < max_wait:
                current_host = urlparse(driver.current_url).hostname or ""
                if current_host == admin_host:
                    break  # Successfully on admin page
                time.sleep(2)
                waited += 2
            else:
                return ToolResult(
                    success=False,
                    error=f"okta_login_timeout: User did not complete SSO login within {max_wait}s. "
                          f"Current URL: {driver.current_url}",
                )

            # ── Step 2: Upload testdata ─────────────────────────────
            log.info("verifier.upload_testdata", file=str(testdata_file))
            file_input = driver.find_element(By.CSS_SELECTOR, "input[type='file']")
            file_input.send_keys(str(testdata_file.resolve()))
            time.sleep(1)

            upload_btn = driver.find_element(By.XPATH, "//button[contains(text(),'UPLOAD')]")
            upload_btn.click()
            time.sleep(3)  # Wait for upload to complete

            # ── Step 3: Open game URL ───────────────────────────────
            log.info("verifier.open_game", url=target_url)
            driver.get(target_url)
            time.sleep(5)  # Wait for game to load

            # ── Step 4: Auto-spin & verify ──────────────────────────
            total = len(records)
            passed_count = 0

            for i, rec in enumerate(records):
                log.info("verifier.spin", spin=i + 1, total=total,
                         batch=rec["batch"], index=rec["index"])

                # Reset response counter before spin
                prev_count = driver.execute_script("return window.__gvResponses ? window.__gvResponses.length : 0;")

                # Click spin button
                self._click_spin(driver)
                time.sleep(spin_delay)

                # Wait for response (poll up to 15s)
                actual = None
                for _ in range(30):
                    curr_count = driver.execute_script(
                        "return window.__gvResponses ? window.__gvResponses.length : 0;"
                    )
                    if curr_count > prev_count:
                        actual = driver.execute_script(
                            f"return window.__gvResponses[{curr_count - 1}];"
                        )
                        break
                    time.sleep(0.5)

                if actual is None:
                    # No response captured — mark as error
                    result = {
                        "passed": False,
                        "actualBatch": None,
                        "actualIndex": None,
                        "actualStage": "N/A",
                        "actualWin": 0,
                        "actualWager": 0,
                        "issues": ["No game response captured within timeout"],
                        "screenshot_b64": None,
                    }
                else:
                    result = _compare_record(rec, actual)
                    result["screenshot_b64"] = None

                    # Screenshot for bonus or failed cases
                    need_screenshot = (rec["isBonus"] and screenshot_bonus) or (
                        not result["passed"] and screenshot_fail
                    )
                    if need_screenshot:
                        try:
                            png_bytes = driver.get_screenshot_as_png()
                            result["screenshot_b64"] = base64.b64encode(png_bytes).decode("utf-8")
                            ss_path = screenshots_dir / f"spin_{rec['spinIndex']}_{'pass' if result['passed'] else 'fail'}.png"
                            ss_path.write_bytes(png_bytes)
                            artifacts.append(str(ss_path.resolve()))
                        except Exception:
                            pass

                if result["passed"]:
                    passed_count += 1

                results.append(result)

            # ─ Step 5: Generate HTML report ────────────────────────
            report_path = _generate_html_report(
                records, results, target_url, str(testdata_file), output,
            )
            artifacts.append(str(output.resolve()))

            success = passed_count == total
            return ToolResult(
                success=success,
                content={
                    "total": total,
                    "passed": passed_count,
                    "failed": total - passed_count,
                    "passRate": round(passed_count / total * 100, 1) if total else 0,
                    "report_html": report_path,
                    "cases": [
                        {
                            "spinIndex": rec["spinIndex"],
                            "stage": rec["stage"],
                            "expectedBatch": rec["batch"],
                            "expectedIndex": rec["index"],
                            "isBonus": rec["isBonus"],
                            **r,
                        }
                        for rec, r in zip(records, results)
                    ],
                },
                execution_ms=0,
                artifacts=artifacts,
            )

        except Exception as e:
            return ToolResult(success=False, error=f"verification_error:{type(e).__name__}:{e}")
        finally:
            try:
                driver.quit()
            except Exception:
                pass

    @staticmethod
    def _click_spin(driver) -> None:
        """Click the game's spin button. Tries multiple selectors."""
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
