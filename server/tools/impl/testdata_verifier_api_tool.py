"""
API-direct TestData verification — bypasses Selenium/the browser entirely.

Talks straight to the same backend APIs the game's own frontend (and a colleague's separate
Playwright automation suite, for the upload half) use. No browser, no Selenium, no clicking
through a splash screen or an admin panel, no guessing CSS selectors — just HTTP calls.

Two independent auth mechanisms are in play here, for two independent systems:
  - Axiom (game deployment/ops platform, host axiomcore-app1-<env>): authenticates with a
    long-lived static API Key (`x-api-key` header, generated from Axiom's own ApiKeys page —
    good for ~1 year, no Okta involved at all). Confirmed against a colleague's working
    automation suite (jftw-game-client-sdk-automation-axiom), which uses this exact header and
    the exact multipart field name below for /Upload/TestDataFile.
  - The game's own player-session API (host api5-rhel1-<env>): bootstrapped from a *separate*,
    short-lived Okta access_token (2 hours, obtained interactively — see the design-doc
    verification-history discussion for the network captures this chain was derived from):
      1. A human logs into Okta once (2-hour access_token, scope includes offline_access).
      2. GET .../casino/user/public/v1/accounts/real?fields=core,balance,session
         with `Authorization: Bearer <okta_token>` returns tokens.userToken (600s lifetime) and
         tokens.refreshTokens[0].
      3. `Authorization: Bearer <userToken>` on .../casino/play/.../play — confirmed
         byte-for-byte identical to what the real browser sent on a live capture.
      4. POST .../accounts/refreshUserToken?fields=none with body
         {"numLaunchTokens": 10, "refreshToken": "<current refresh token>"} returns a *new*
         userToken + a *new*, rotated refreshToken — repeatable indefinitely without ever
         touching Okta again.
    These two tokens (Axiom API Key, Okta access_token) are unrelated and both required.

Known limitations vs. the Selenium-based testdata_verifier:
  - No screenshots (there is no rendered page to capture in this mode).
  - A human still has to paste a fresh Okta access_token to start a run; after that this tool
    refreshes its own game-session token on its own. The Axiom API Key does not expire nearly
    as often and does not need repasting every run.
  - One remaining detail was inferred from a single live capture and was never independently
    confirmed: the session-bootstrap call (`real?fields=...`) is assumed to be a GET, not a
    POST. If this tool 404s/405s on that call, try switching it to POST.
"""
from __future__ import annotations
import asyncio
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

import httpx

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verify_common import (
    _parse_testdata,
    _compare_record,
    _generate_html_report,
    _extract_url_identity,
    _extract_testdata_key,
    _check_key_matches_url,
)
from server.infra.logger import log

# Server-declared userToken lifetime (see the bootstrap response's userTokenExpiryInSeconds,
# confirmed as 600 on a live capture) and how long before actual expiry to refresh proactively —
# refreshing at the wire means a slow /play call could still land after expiry and 401.
USER_TOKEN_LIFETIME_SEC = 600
USER_TOKEN_REFRESH_MARGIN_SEC = 120


def _derive_env(target_url: str) -> str:
    """Pull the environment slug (e.g. "gtp537") out of the game URL's hostname.

    Every host on this platform follows the same <service>-<env>.installprogram.eu pattern —
    mobile-app1-gtp537, admin-app1-gtp537, axiomcore-app1-gtp537, api5-rhel1-gtp537 — confirmed
    across three different services on a live capture (see _derive_admin_testdata_url in
    the retired Selenium verifier for the same pattern applied to the admin panel). Extracting just
    the env slug once and reusing it to build every other host is more robust than hardcoding
    each host, and works the same way regardless of which environment (gtp537, gtp618, ...) the
    tester happens to be pointed at — confirmed the Okta token itself is environment-agnostic,
    so only the *host* needs to change per environment, not the auth.
    """
    host = urlparse(target_url).hostname or ""
    prefix = host.split(".")[0] if host else ""
    return prefix.rsplit("-", 1)[-1] if "-" in prefix else prefix


def _api5_host(env: str) -> str:
    return f"api5-rhel1-{env}.installprogram.eu"


def _axiomcore_host(env: str) -> str:
    return f"axiomcore-app1-{env}.installprogram.eu"


def _xml_result_to_game_response(xml_str: str) -> dict:
    """Convert the raw <Pkt><Response>...</Response></Pkt> XML the /play endpoint returns into
    the {"gameResponse": {...}} shape _compare_record() already expects. That shape originally
    came from the game's own console.log output in the Selenium-based tool's interceptor —
    reusing it here means _compare_record() needs zero changes to work with either tool."""
    root = ET.fromstring(xml_str)
    financial = root.find(".//Financial")
    slot = root.find(".//Slot")
    pregen = root.find(".//TestData/Spin/PreGen")
    return {
        "gameResponse": {
            "testData": {"spin": {"preGen": {
                "batch": int(pregen.get("batch")) if pregen is not None and pregen.get("batch") else None,
                "index": int(pregen.get("index")) if pregen is not None and pregen.get("index") else None,
            }}},
            "financials": {
                "win": float(financial.get("win", 0)) if financial is not None else 0.0,
                "wager": float(financial.get("wager", 0)) if financial is not None else 0.0,
            },
            "slot": {"stage": slot.get("stage", "") if slot is not None else ""},
            "error": "",
        }
    }


def _failed_result(verdict: str, issue: str, source_file: str) -> dict:
    return {
        "passed": False, "verdict": verdict,
        "actualBatch": None, "actualIndex": None,
        "actualStage": "N/A", "actualWin": 0, "actualWager": 0,
        "issues": [issue], "screenshot_b64": None, "source_file": source_file,
    }


class TestdataVerifierApiTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier_api",
            description=(
                "API-direct TestData verification: calls the game's own session/play APIs "
                "straight over HTTP using an Okta access_token — no browser, no Selenium, no "
                "admin-panel clicking, no splash-screen dismissal. Same pre-flight "
                "loginName/moduleID check and the same HTML report format as testdata_verifier. "
                "Cannot take screenshots (no rendered page exists in this mode)."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=False,
                              description="Absolute path to a single .testdata XML file (backward compat)."),
                ToolParameter(name="testdata_files", type="array", required=False,
                              description="List of absolute paths to .testdata XML files for batch verification."),
                ToolParameter(name="target_url", type="string", required=True,
                              description="Full game environment URL (must contain username, moduleId, clientId, productId)."),
                ToolParameter(name="okta_access_token", type="string", required=True,
                              description="Okta JWT access_token (from Axiom's Profile page, or the browser's "
                                          "own Local Storage), valid ~2 hours. Bootstraps the *game* session "
                                          "(api5-rhel1); the tool refreshes its own game-session token on its "
                                          "own after that. Unrelated to axiom_api_key below."),
                ToolParameter(name="axiom_api_key", type="string", required=True,
                              description="Long-lived Axiom API Key (from Axiom's ApiKeys page — the "
                                          "'x-api-key' header, not a Bearer token). Authenticates the "
                                          "*Axiom* testdata upload call (axiomcore-app1); does not expire "
                                          "anywhere near as often as okta_access_token, so it rarely needs "
                                          "repasting."),
                ToolParameter(name="chip_size", type="number", default=10,
                              description="Bet chipSize sent on each Spin request."),
                ToolParameter(name="num_chips", type="number", default=1,
                              description="Bet numChips sent on each Spin request."),
                ToolParameter(name="spin_delay_sec", type="number", default=0.5,
                              description="Seconds to wait between spins."),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
            ]),
            permissions=["filesystem:write", "network:outbound"],
            timeout_seconds=1800,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
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
        okta_token: str = params["okta_access_token"]
        axiom_api_key: str = params["axiom_api_key"]
        chip_size = str(params.get("chip_size", 10))
        num_chips = str(params.get("num_chips", 1))
        spin_delay: float = float(params.get("spin_delay_sec", 0.5))

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

        # ── Pre-flight: same identity check as the Selenium-based tool (imported, not
        # duplicated) — a loginName/moduleID mismatch here means the game would silently ignore
        # the uploaded file and serve an unrelated seed instead, with no error at all.
        url_identity = _extract_url_identity(target_url)
        mismatch_lines: list[str] = []
        for tf in testdata_files_list:
            issues = _check_key_matches_url(_extract_testdata_key(tf), url_identity)
            if issues:
                mismatch_lines.append(f"{tf.name}: " + "; ".join(issues))
        if mismatch_lines:
            return ToolResult(success=False, error="testdata_url_identity_mismatch:\n" + "\n".join(mismatch_lines))

        # ── Derive env + hosts + game identity from the target URL ──
        env = _derive_env(target_url)
        if not env:
            return ToolResult(success=False, error=f"could_not_derive_env_from_url:{target_url}")
        qs = parse_qs(urlparse(target_url).query)
        module_id = (qs.get("moduleId") or [""])[0]
        client_id = (qs.get("clientId") or [""])[0]
        product_id = (qs.get("productId") or [""])[0]
        if not module_id or not client_id:
            return ToolResult(success=False, error=f"target_url_missing_moduleId_or_clientId:{target_url}")

        api5_host = _api5_host(env)
        axiomcore_host = _axiomcore_host(env)

        all_results: list[dict] = []
        all_records_flat: list[dict] = []
        artifacts: list[str] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            # ── Step 1: bootstrap a game session from the Okta token ──
            # ASSUMPTION: GET, not POST — never directly confirmed on a capture, only inferred
            # from this being a read-only "fetch account/balance/session" endpoint. If this
            # 404s/405s, try POST instead.
            try:
                real_resp = await client.get(
                    f"https://{api5_host}/casino/user/public/v1/accounts/real",
                    params={"fields": "core,balance,session"},
                    headers={"Authorization": f"Bearer {okta_token}"},
                )
            except httpx.HTTPError as e:
                return ToolResult(success=False, error=f"session_bootstrap_request_failed:{e}")
            if real_resp.status_code != 200:
                return ToolResult(
                    success=False,
                    error=f"session_bootstrap_failed:HTTP{real_resp.status_code}:{real_resp.text[:500]}",
                )
            try:
                real_data = real_resp.json()
                user_token = real_data["tokens"]["userToken"]
                refresh_token = real_data["tokens"]["refreshTokens"][0]
            except Exception as e:
                return ToolResult(success=False, error=f"session_bootstrap_parse_failed:{e}:{real_resp.text[:500]}")
            user_token_issued_at = time.monotonic()
            log.info("verifier_api.session_bootstrapped", env=env, module_id=module_id)

            async def _refresh_if_needed() -> str | None:
                """Returns an error string on failure, None on success/no-op."""
                nonlocal user_token, refresh_token, user_token_issued_at
                age = time.monotonic() - user_token_issued_at
                if age < USER_TOKEN_LIFETIME_SEC - USER_TOKEN_REFRESH_MARGIN_SEC:
                    return None
                try:
                    resp = await client.post(
                        f"https://{api5_host}/casino/user/public/v1/accounts/refreshUserToken",
                        params={"fields": "none"},
                        json={"numLaunchTokens": 10, "refreshToken": refresh_token},
                    )
                except httpx.HTTPError as e:
                    return f"token_refresh_request_failed:{e}"
                if resp.status_code != 200:
                    return f"token_refresh_failed:HTTP{resp.status_code}:{resp.text[:500]}"
                try:
                    data = resp.json()
                    user_token = data["tokens"]["userToken"]
                    refresh_token = data["tokens"]["refreshTokens"][0]
                except Exception as e:
                    return f"token_refresh_parse_failed:{e}:{resp.text[:500]}"
                user_token_issued_at = time.monotonic()
                log.info("verifier_api.token_refreshed", env=env)
                return None

            # ── Step 2: upload each testdata file, then spin its records ──
            for file_idx, (filepath_str, records) in enumerate(all_records_by_file.items()):
                testdata_file = Path(filepath_str)
                file_label = f"[{file_idx + 1}/{len(all_records_by_file)}] {testdata_file.name}"
                log.info("verifier_api.file_start", file=file_label, spins=len(records))

                # Auth header, field name, and endpoint all confirmed against a colleague's
                # working Playwright automation suite (jftw-game-client-sdk-automation-axiom's
                # src/js/axiomAPI/upload.js) — this is a real, exercised code path, not a guess.
                try:
                    with open(testdata_file, "rb") as fh:
                        upload_resp = await client.post(
                            f"https://{axiomcore_host}/Upload/TestDataFile",
                            headers={"x-api-key": axiom_api_key},
                            files={"testDataFormFile": (testdata_file.name, fh, "application/octet-stream")},
                        )
                except httpx.HTTPError as e:
                    return ToolResult(success=False, error=f"testdata_upload_request_failed:{file_label}:{e}")
                if upload_resp.status_code != 200:
                    return ToolResult(
                        success=False,
                        error=f"testdata_upload_failed:{file_label}:HTTP{upload_resp.status_code}:{upload_resp.text[:500]}",
                    )

                for rec_idx, rec in enumerate(records):
                    refresh_err = await _refresh_if_needed()
                    if refresh_err:
                        # Token refresh failing mid-run is fatal — every subsequent /play call
                        # would 401 anyway, so stop cleanly with the real reason instead of
                        # burning through the rest of the batch as a wall of timeouts.
                        for remaining in records[rec_idx:]:
                            all_results.append(_failed_result("NETWORK_ERROR", refresh_err, testdata_file.name))
                            all_records_flat.append(remaining)
                        break

                    pkt_xml = (
                        f'<Pkt version="5"><Id mid="{module_id}" cid="{client_id}" sid="{product_id}" verb="Spin"/>'
                        f'<Request chipSize="{chip_size}" numChips="{num_chips}" verb="Spin" /></Pkt>'
                    )
                    body = {
                        "packet": {
                            "packetType": 7,
                            "context": {},
                            "isBase64Encoded": False,
                            "payload": pkt_xml,
                            "useFilter": False,
                        },
                        "context": {},
                    }
                    try:
                        play_resp = await client.post(
                            f"https://{api5_host}/casino/play/public/v1/games/module/{module_id}/client/{client_id}/play",
                            headers={"Authorization": f"Bearer {user_token}"},
                            json=body,
                        )
                    except httpx.HTTPError as e:
                        all_results.append(_failed_result("NETWORK_ERROR", f"play request failed: {e}", testdata_file.name))
                        all_records_flat.append(rec)
                        continue

                    if play_resp.status_code != 200:
                        all_results.append(_failed_result(
                            "NETWORK_ERROR", f"play HTTP {play_resp.status_code}: {play_resp.text[:300]}",
                            testdata_file.name,
                        ))
                        all_records_flat.append(rec)
                        continue

                    try:
                        play_data = play_resp.json()
                        result_xml = play_data["packet"]["payload"]
                        actual = _xml_result_to_game_response(result_xml)
                    except Exception as e:
                        all_results.append(_failed_result(
                            "TIMEOUT", f"could not parse play response: {e}", testdata_file.name,
                        ))
                        all_records_flat.append(rec)
                        continue

                    result = _compare_record(rec, actual)
                    result["screenshot_b64"] = None  # no rendered page exists in this mode
                    result["source_file"] = testdata_file.name
                    all_results.append(result)
                    all_records_flat.append(rec)

                    if spin_delay > 0:
                        await asyncio.sleep(spin_delay)

                log.info(
                    "verifier_api.file_done", file=file_label,
                    passed=sum(1 for r in all_results if r.get("source_file") == testdata_file.name and r["passed"]),
                )

        # ── Step 3: generate the same HTML report format the Selenium tool produces ──
        passed_count = sum(1 for r in all_results if r["passed"])
        total = len(all_results)
        is_multi = len(testdata_files_list) > 1
        report_label = f"{len(testdata_files_list)} files batch verification" if is_multi else testdata_files_list[0].name
        report_path = _generate_html_report(
            all_records_flat, all_results, target_url, report_label, output, multi_file=is_multi,
        )
        artifacts.append(str(output.resolve()))

        report_url = None
        try:
            rel = Path(report_path).resolve().relative_to(Path(ctx.work_dir).resolve())
            report_url = f"/api/executions/runs/{ctx.execution_id}/testdata_verifier_api/{rel.as_posix()}"
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
