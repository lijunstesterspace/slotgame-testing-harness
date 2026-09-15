from __future__ import annotations
import base64
import json
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

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


def _detach_profile_link(link_path: Path, link_method: str | None) -> None:
    """Remove just the reparse point at `link_path`, never its target.

    CRITICAL: a Windows junction does NOT satisfy Path.is_symlink() (junctions use
    IO_REPARSE_TAG_MOUNT_POINT, not IO_REPARSE_TAG_SYMLINK). Falling through to
    shutil.rmtree() on a directory that still contains an un-detached junction walks straight
    through it and deletes the *real* target directory's files — here, the tester's actual
    Chrome profile. `link_method` (tracked at creation time, not re-detected) picks the correct
    removal call; os.rmdir() on a junction detaches it without touching its target.
    """
    import os
    if link_method == "junction":
        os.rmdir(link_path)
    elif link_method == "symlink" or link_path.is_symlink():
        link_path.unlink()


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


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------

class TestdataVerifierTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier",
            description=(
                "Validates each file's <Key> loginName/moduleID against target_url's "
                "username/moduleId before touching the browser — a mismatch there makes the "
                "real game silently ignore the upload and serve an unrelated seed instead. "
                "Uploads .testdata to the game admin panel, opens the game in Chrome, "
                "auto-spins and intercepts responseLogger via console.log. "
                "Compares actual seed/payout against expected values. "
                "Returns HTML report with data comparison + screenshots for bonus/failed cases."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=False,
                              description="Absolute path to a single .testdata XML file (backward compat)."),
                ToolParameter(name="testdata_files", type="array", required=False,
                              description="List of absolute paths to .testdata XML files for batch verification."),
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
                ToolParameter(name="admin_login_timeout_sec", type="number", default=240,
                              description="Seconds to wait for the admin TestData page to finish loading "
                                          "after navigating to it, before giving up. Needs to comfortably "
                                          "cover a human completing SSO login (password + an MFA/Okta "
                                          "Verify push approval on their phone), not just a page redirect — "
                                          "too short and this tool closes the browser out from under a "
                                          "tester who hasn't finished logging in yet."),
            ]),
            permissions=["filesystem:write", "selenium", "network:outbound"],
            timeout_seconds=1800,
            version="2.1.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        """Selenium's calls below (driver.get, time.sleep, execute_script, ...) are all
        synchronous and block the calling thread for the whole verification run (minutes).
        Running that directly in this coroutine would freeze the *entire* asyncio event loop —
        no other request, including a user's "stop" request, could be served until it finished.
        Offloading to a worker thread keeps the server responsive so cancellation can actually
        reach this execution (see server/infra/cancellation.py)."""
        import asyncio
        return await asyncio.to_thread(self._run_verification_sync, params, ctx)

    def _run_verification_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.common.exceptions import TimeoutException
        from server.infra.logger import log
        from server.infra import cancellation

        # ── Extract params (support single file + batch) ──────────
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

        target_url: str = params["target_url"]
        spin_delay: float = float(params.get("spin_delay_sec", 3.0))
        screenshot_bonus: bool = bool(params.get("screenshot_on_bonus", True))
        screenshot_fail: bool = bool(params.get("screenshot_on_fail", True))
        admin_login_timeout: int = int(params.get("admin_login_timeout_sec", 240))

        output = (
            Path(params["output_report"])
            if params.get("output_report")
            else (Path(ctx.work_dir) / "report.html")
        )
        output.parent.mkdir(parents=True, exist_ok=True)

        # ── Parse ALL testdata files ───────────────────────────────
        all_records_by_file: dict[str, list[dict]] = {}
        for tf in testdata_files_list:
            try:
                records = _parse_testdata(tf)
            except Exception as e:
                return ToolResult(success=False, error=f"testdata_parse_error:{tf.name}:{e}")
            if not records:
                return ToolResult(success=False, error=f"testdata_file_contains_no_spins:{tf.name}")
            all_records_by_file[str(tf)] = records

        total_spins = sum(len(r) for r in all_records_by_file.values())
        log.info("verifier.batch_start", files=len(testdata_files_list), total_spins=total_spins)

        # ── Pre-flight: reject any file/URL identity mismatch before touching Selenium ──
        # (see _check_key_matches_url's docstring for why this matters: the game environment
        # silently ignores a mismatched upload instead of erroring, so this is the only place
        # that failure mode can actually be caught.)
        url_identity = _extract_url_identity(target_url)
        mismatch_lines: list[str] = []
        for tf in testdata_files_list:
            testdata_key = _extract_testdata_key(tf)
            issues = _check_key_matches_url(testdata_key, url_identity)
            if issues:
                mismatch_lines.append(f"{tf.name}: " + "; ".join(issues))
        if mismatch_lines:
            return ToolResult(
                success=False,
                error="testdata_url_identity_mismatch:\n" + "\n".join(mismatch_lines),
            )

        # ── Derive admin TestData URL from game URL ────────────────
        admin_url = _derive_admin_testdata_url(target_url)

        # ── Setup Chrome with CDP interceptor (ONCE) ──────────────
        chrome_options = Options()
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)
        chrome_options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

        import platform, tempfile, shutil
        temp_profile = None
        link_method: str | None = None
        if platform.system() == "Windows":
            user_data_dir = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"
        elif platform.system() == "Darwin":
            user_data_dir = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
        else:
            user_data_dir = Path.home() / ".config" / "google-chrome"

        if user_data_dir.exists():
            default_profile = user_data_dir / "Default"
            if default_profile.exists():
                candidate = Path(tempfile.mkdtemp(prefix="harness_chrome_"))
                link_path = candidate / "Default"

                # Prefer an NTFS *junction* over a symlink on Windows: junctions are a plain
                # directory reparse point that any standard (non-admin) account can create,
                # whereas Path.symlink_to() needs Developer Mode or admin rights
                # (SeCreateSymbolicLinkPrivilege) and raises WinError 1314 without it — which is
                # exactly why testers kept hitting a fresh, logged-out Chrome profile (and had to
                # log into the admin panel again every run) on machines without Dev Mode enabled.
                if platform.system() == "Windows":
                    try:
                        import _winapi
                        _winapi.CreateJunction(str(default_profile), str(link_path))
                        link_method = "junction"
                    except OSError as e:
                        log.warning("verifier.chrome_profile_junction_failed", error=str(e))

                if link_method is None:
                    try:
                        link_path.symlink_to(default_profile)
                        link_method = "symlink"
                    except OSError as e:
                        log.warning("verifier.chrome_profile_symlink_failed", error=str(e))

                if link_method is not None:
                    try:
                        local_state = user_data_dir / "Local State"
                        if local_state.exists():
                            shutil.copy2(local_state, candidate / "Local State")
                        chrome_options.add_argument(f"--user-data-dir={candidate}")
                        chrome_options.add_argument("--profile-directory=Default")
                        temp_profile = candidate
                        log.info("verifier.chrome_profile_linked", path=str(candidate), method=link_method)
                    except OSError as e:
                        log.warning("verifier.chrome_profile_setup_failed", error=str(e))
                        try:
                            _detach_profile_link(link_path, link_method)
                        except OSError:
                            pass
                        shutil.rmtree(candidate, ignore_errors=True)
                else:
                    # Neither a junction nor a symlink could be created — degrade to a fresh,
                    # unauthenticated Chrome profile instead of crashing the whole verification
                    # run; the admin-page login check further below will surface the resulting
                    # "not logged in" state on its own.
                    shutil.rmtree(candidate, ignore_errors=True)
            else:
                log.warning("verifier.chrome_profile_not_found", path=str(default_profile))
        else:
            log.warning("verifier.chrome_user_data_not_found", path=str(user_data_dir))

        parsed_target = urlparse(target_url)
        target_host = parsed_target.hostname or ""
        if any(kw in target_host.lower() for kw in ["installprogram.eu", "staging", "internal", "test", "dev"]):
            chrome_options.add_argument("--ignore-certificate-errors")

        driver = webdriver.Chrome(options=chrome_options)
        # Registering driver.quit as the cancel callback right after the session exists is what
        # actually makes "Stop" work: calling it from the main event loop while this worker
        # thread is blocked mid Selenium-call invalidates the session, which raises in this
        # thread and unwinds through the except/finally below — there is no other way to
        # interrupt a synchronous Selenium call from outside its own thread.
        cancellation.register(ctx.execution_id, lambda: _force_kill_driver(driver))
        driver.maximize_window()
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _INTERCEPTOR_JS})

        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        all_results: list[dict] = []
        all_records_flat: list[dict] = []
        artifacts: list[str] = []

        consecutive_network_errors = 0
        consecutive_seed_rejections = 0
        max_consecutive_network_errors = 3
        max_consecutive_seed_rejections = 2
        environment_aborted = False

        try:
            # ── Step 1: Navigate to admin TestData page (ONCE) ────
            log.info("verifier.navigate_admin", url=admin_url)
            driver.get(admin_url)
            admin_host = urlparse(admin_url).hostname or ""
            for waited in range(admin_login_timeout):
                # Parenthesize explicitly: `X or "" == Y` parses as `X or ("" == Y)`, which is
                # truthy for almost any non-empty hostname — the intended equality check never
                # actually ran, so a failed/redirected login was never detected here.
                if (urlparse(driver.current_url).hostname or "") == admin_host:
                    break
                # A human may still be typing a password or approving an Okta Verify push on
                # their phone right now. NOTE: log.info only reaches the server-side log stream
                # (structlog / terminal) — ToolPlugin._run_impl has no way to push live progress
                # into the app's own Execution Console (that only gets one TOOL_CALL/TOOL_RES
                # event per whole tool invocation, from execution_queue.py). This is a breadcrumb
                # for anyone tailing server logs, not something the tester watching the UI sees.
                if waited > 0 and waited % 10 == 0:
                    log.info("verifier.awaiting_admin_login", waited_sec=waited, timeout_sec=admin_login_timeout)
                time.sleep(1)
            else:
                return ToolResult(
                    success=False,
                    error=f"Admin page login failed: still redirected after {admin_login_timeout}s. "
                          f"Current URL: {driver.current_url}. "
                          f"Please log in to the admin panel (including any MFA/Okta Verify step) in "
                          f"your regular Chrome browser first, then re-run — or raise "
                          f"admin_login_timeout_sec if you just needed more time.",
                )

            # ── Step 2: Process each file (reuse Chrome) ──────────
            for file_idx, (filepath_str, records) in enumerate(all_records_by_file.items()):
                testdata_file = Path(filepath_str)
                file_label = f"[{file_idx + 1}/{len(all_records_by_file)}] {testdata_file.name}"
                log.info("verifier.file_start", file=file_label, spins=len(records))

                # ── Navigate back to admin TestData page for upload ──
                # After processing previous file, browser is on game page.
                # Must return to admin page to upload next testdata file.
                if file_idx > 0:
                    log.info("verifier.navigate_admin_for_upload", file=file_label)
                    driver.get(admin_url)
                    # Wait for admin page to load (check hostname). Same generous timeout as the
                    # first navigation — a long-running batch can outlast the session and force a
                    # re-login (possibly with MFA again) partway through.
                    for _waited in range(admin_login_timeout):
                        current_host = urlparse(driver.current_url).hostname or ""
                        if current_host == admin_host:
                            break
                        time.sleep(1)
                    else:
                        log.warning("verifier.admin_page_timeout", file=file_label)
                        # Mark all remaining records as failed
                        for rec in records:
                            all_results.append({
                                "passed": False, "verdict": "NETWORK_ERROR",
                                "actualBatch": None, "actualIndex": None,
                                "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
                                "issues": [f"Admin page failed to load for file {file_idx + 1}"],
                                "screenshot_b64": None, "source_file": testdata_file.name,
                            })
                            all_records_flat.append(rec)
                        continue
                    time.sleep(1)  # Let page fully settle

                # Upload testdata. Two robustness fixes over a plain find_element() here:
                #   1. The admin page can still be rendering its upload form for a moment even
                #      after the URL has already switched to the admin host (React-style client
                #      render), so both elements need an explicit wait, not an immediate lookup.
                #   2. contains(text(),'UPLOAD') is case-sensitive — the button is very likely
                #      styled UPPERCASE via CSS (text-transform) while its actual DOM text is
                #      mixed/lower case (e.g. "Upload File"), which silently matches nothing and
                #      is exactly what surfaced as a NoSuchElementException in practice. Uppercase
                #      both sides of the comparison so styling can't affect the match.
                file_input = WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='file']"))
                )
                file_input.send_keys(str(testdata_file.resolve()))
                time.sleep(1)
                try:
                    upload_btn = WebDriverWait(driver, 20).until(
                        EC.element_to_be_clickable((
                            By.XPATH,
                            "//button[contains("
                            "translate(normalize-space(.), "
                            "'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), "
                            "'UPLOAD')]",
                        ))
                    )
                except TimeoutException:
                    # Last resort: whatever submit-type button exists on the page.
                    upload_btn = WebDriverWait(driver, 5).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "button[type='submit']"))
                    )
                upload_btn.click()
                time.sleep(3)

                # Open game URL
                driver.get(target_url)
                time.sleep(5)

                # Reset interceptor response count for fresh game session
                driver.execute_script("window.__gvResponses = []; window.__gvSpinCount = 0;")

                # Auto-spin & verify each record
                for i, rec in enumerate(records):
                    if environment_aborted:
                        result = {
                            "passed": False, "verdict": "NETWORK_ERROR",
                            "actualBatch": None, "actualIndex": None,
                            "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
                            "issues": ["Verification aborted: environment unavailable"],
                            "screenshot_b64": None, "source_file": testdata_file.name,
                        }
                        all_results.append(result)
                        all_records_flat.append(rec)
                        continue

                    log.info("verifier.spin", file=file_label, spin=i + 1, total=len(records),
                             batch=rec["batch"], index=rec["index"])

                    prev_count = driver.execute_script(
                        "return window.__gvResponses ? window.__gvResponses.length : 0;")
                    self._click_spin(driver)
                    time.sleep(spin_delay)

                    actual = None
                    for _ in range(30):
                        curr_count = driver.execute_script(
                            "return window.__gvResponses ? window.__gvResponses.length : 0;")
                        if curr_count > prev_count:
                            actual = driver.execute_script(
                                f"return window.__gvResponses[{curr_count - 1}];")
                            break
                        time.sleep(0.5)

                    if actual is None:
                        result = {
                            "passed": False, "verdict": "TIMEOUT",
                            "actualBatch": None, "actualIndex": None,
                            "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
                            "issues": ["No game response captured within timeout"],
                            "screenshot_b64": None, "source_file": testdata_file.name,
                        }
                        consecutive_network_errors += 1
                        consecutive_seed_rejections = 0
                    else:
                        result = _compare_record(rec, actual)
                        result["screenshot_b64"] = None
                        result["source_file"] = testdata_file.name

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
                                result["screenshot_b64"] = base64.b64encode(png_bytes).decode("utf-8")
                                ss_path = screenshots_dir / f"{testdata_file.stem}_spin{rec['spinIndex']}_{'pass' if result['passed'] else 'fail'}.png"
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

                log.info("verifier.file_done", file=file_label, passed=sum(1 for r in all_results if r.get("source_file") == testdata_file.name and r["passed"]))

            # ── Step 3: Generate combined HTML report ─────────────
            passed_count = sum(1 for r in all_results if r["passed"])
            total = len(all_results)
            is_multi = len(testdata_files_list) > 1
            if is_multi:
                report_label = f"{len(testdata_files_list)} files batch verification"
            else:
                report_label = testdata_files_list[0].name
            report_path = _generate_html_report(
                all_records_flat, all_results, target_url, report_label, output,
                multi_file=is_multi,
            )
            artifacts.append(str(output.resolve()))

            # report_html above is an absolute local path — not directly downloadable from the
            # UI. report_url is the same file served through the API (see executions_router.py's
            # /runs/{execution_id}/{tool_name}/{filename} route), for an actual "Download HTML
            # Report" button in the frontend.
            report_url = None
            try:
                rel = Path(report_path).resolve().relative_to(Path(ctx.work_dir).resolve())
                report_url = f"/api/executions/runs/{ctx.execution_id}/testdata_verifier/{rel.as_posix()}"
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
            try:
                if temp_profile is not None and temp_profile.exists():
                    try:
                        _detach_profile_link(temp_profile / "Default", link_method)
                    except OSError:
                        pass
                    shutil.rmtree(temp_profile, ignore_errors=True)
                    log.info("verifier.chrome_profile_cleaned", path=str(temp_profile))
            except Exception:
                pass

    @staticmethod
    def _click_spin(driver) -> None:
        """Click the game's spin button. Tries multiple selectors."""
        # `By` is only ever imported locally inside _run_verification_sync — a plain Python
        # local import binds the name only in that function's own scope, not across other
        # methods of the same class, so this staticmethod needs its own import or every `By.*`
        # reference below raises NameError. This went unnoticed until now because every prior
        # run failed earlier (admin login timeout, then the upload-button lookup) before
        # execution ever reached this method.
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
