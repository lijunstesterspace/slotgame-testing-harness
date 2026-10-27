"""
TestData verification through a real browser, without an interactive Okta/MFA prompt in any mode.

Two ways in, both chosen from the URL itself (LaunchSpec.mode):
  - harness — the URL contains `/harness/`: the internal QA-only "Titan Harness" launcher page.
    Its form is filled from the .testdata file's <Key> (username=loginName, moduleId=moduleID)
    plus the per-version Product Id / Client Id / Brand, then submitted via its LAUNCH GAME
    button, which opens an already-authenticated game session.
  - direct — any other URL: the game's own launch URL. It carries the account in its query string
    (?username=..&password=..&moduleId=..), which is exactly the URL a tester opens by hand, so
    the page authenticates itself and no Okta session is involved either.

The browser work is done by server/game_session (Playwright) rather than Selenium. That layer
makes the *play* the unit of verification instead of the base round, which removes the three
failure modes this tool used to be built around:
  - a feature round (FreeSpin/Bonus/...) is auto-played by the game after the spin that triggered
    it, so Spin is never clicked for it; the nested <Feature><PreGen/></Feature> seed is read from
    the triggering Spin's <TestData> echo;
  - blocking intro/outro/summary screens are advanced by touching repeatedly until the game state
    actually changes, instead of one touch plus a fixed sleep;
  - responses are read at the network layer with a monotonic seq, so "this play's responses" is a
    seq range rather than a count that a stray response can shift.

TestData upload is still a direct HTTP call (x-api-key, POST /Upload/TestDataFile) — the admin
panel that used to do it required Okta, so this keeps that second Okta dependency removed.

The environment slug (gtp537, ...) is needed *before* the browser starts, to build the upload host:
  - pass `env` explicitly, or
  - it is derived from the game URL's host when that host is <service>-<env>.installprogram.eu.
A local client (http://localhost:5241/...) has no env in its URL even though the game it plays
against is remote, so `env` must be passed for it — the tool says so instead of guessing.

UNVERIFIED against a live run: this rewrite is covered by unit tests on the protocol layer only.
The harness form's field selectors are unchanged in spirit from the Selenium version (several
formcontrolname/name/id strategies per field), and the harness-launched build is known to show an
extra "Mock Server / F2 Dev Panel" overlay that the production URL never shows — the retired
Selenium tool had to close it explicitly (_close_debug_panel_if_open). Watch the first live run for
that overlay landing on a touch point.
"""
from __future__ import annotations

import base64
import threading
from pathlib import Path
from typing import Any

import httpx

from server.game_session import (
    LaunchSpec, PlayResponse, PlayResult, SessionConfig, SessionError, open_session,
)
from server.game_session.env import axiomcore_host, require_env_before_launch
from server.game_session.launcher import TITAN_DEFAULT_PASSWORD
from server.infra.logger import log
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verify_common import (
    _check_key_matches_url,
    _extract_testdata_key,
    _extract_url_identity,
    _generate_html_report,
    _parse_testdata,
)

# The session's own defaults, read so the schema below cannot drift from them. A tool param only
# exists where a live run has shown a reason to change the value; everything else in SessionConfig
# stays whatever the session layer decided.
_SESSION_DEFAULTS = SessionConfig()


# ── result builders: every case yields the same dict the report renderer expects ──────────────

def _empty_result(source_file: str, verdict: str, issues: list[str]) -> dict:
    return {
        "passed": False, "verdict": verdict,
        "actualBatch": None, "actualIndex": None, "actualStage": "N/A",
        "actualWin": 0, "actualWager": 0,
        "issues": issues, "screenshot_b64": None, "source_file": source_file,
    }


def _error_result(error: SessionError, source_file: str) -> dict:
    """A play that never produced a response. The session's error code says why."""
    verdict = "PAGE_RELOADED" if error.code == "PAGE_RELOADED" else "TIMEOUT"
    detail = f"{error.code}: {error.message}" + (f" (state={error.state})" if error.state else "")
    return _empty_result(source_file, verdict, [detail])


def _not_run_reason(*, stopped: bool, abort_reason: str | None,
                    max_network_errors: int, max_seed_rejections: int) -> tuple[str, str]:
    """Verdict + issue line for a record that was never played, because the run ended first.

    The two abort causes are not interchangeable. A run stopped by timeouts/page reloads really was
    an environment failure; one stopped by rejected seeds was not — the server was refusing the
    seeds we queued. docs/p0-testdata-verification-findings.md records what produces that: a
    .testdata <Key> whose loginName/moduleID does not match the URL, or a drifted seed queue.
    Reporting it as "environment unavailable" sends the reader after the wrong problem, so the
    seed case gets its own verdict and points at the testdata instead.
    """
    if stopped:
        return "CANCELLED", "Stopped by the user"
    if abort_reason == "environment":
        return "NETWORK_ERROR", (
            f"Not verified: run stopped after {max_network_errors} consecutive timeouts/page "
            "reloads — the game environment became unavailable")
    return "SEED_REJECTED", (
        f"Not verified: run stopped after {max_seed_rejections} consecutive seeds rejected by the "
        "server — check the .testdata <Key> loginName/moduleID against the URL, and whether the "
        "seed queue has drifted")


def _spin_of(result: PlayResult) -> PlayResponse | None:
    """The player-initiated Spin response of a play. Only it carries the <TestData> echo."""
    for captured in result.responses:
        if captured.play is not None and captured.play.verb == "Spin":
            return captured.play
    return None


def _compare_play(record: dict, play: PlayResponse | None, source_file: str) -> dict:
    """Judge one .testdata record against the Spin response that consumed it.

    The expected seeds are read back out of that response's <TestData> echo, which repeats the whole
    record the server consumed: the base seed at path "Spin" and a nested feature seed at
    "Spin/Feature". Both are therefore verifiable from the one response (confirmed live).
    """
    feature_record = record["stage"] != "BaseGame"
    if play is None:
        return _empty_result(source_file, "TIMEOUT",
                             ["No Spin response with a <TestData> echo was captured for this record"])

    issues: list[str] = []
    by_path = {path: (batch, index) for path, batch, index in play.testdata_pregens}
    expected = (record["batch"], record["index"])
    nested = [seed for path, seed in by_path.items() if "/" in path]
    if feature_record:
        # A feature stage is consumed as part of the play its trigger started, so its seed is echoed
        # nested inside that Spin — it is not the seed at path "Spin".
        actual = expected if expected in by_path.values() else None
    else:
        actual = by_path.get("Spin") or play.pregen

    seed_ok = actual == expected
    if not seed_ok:
        issues.append(f"batch/index mismatch: expected={expected}, actual={actual}")

    bonus_ok = True
    if record["isBonus"] and not feature_record:
        want = (record["bonusBatch"], record["bonusIndex"])
        bonus_ok = want in nested
        if not bonus_ok:
            issues.append(f"feature seed mismatch: expected={want}, actual={nested or None}")

    stage_ok = feature_record or not play.testdata_stage or play.testdata_stage == record["stage"]
    if not stage_ok:
        issues.append(f"stage mismatch: expected={record['stage']!r}, actual={play.testdata_stage!r}")

    passed = seed_ok and bonus_ok
    verdict = "PASSED" if (passed and stage_ok) else ("SEED_MISMATCH" if not passed else "STAGE_MISMATCH")
    if play.is_error:
        passed, verdict = False, "SEED_REJECTED"
        issues.append(f"Server rejected seed: {play.error}")

    return {
        "passed": passed, "verdict": verdict,
        "actualBatch": actual[0] if actual else None,
        "actualIndex": actual[1] if actual else None,
        "actualStage": play.testdata_stage or play.stage or "N/A",
        "actualWin": play.win or 0, "actualWager": play.wager or 0,
        "actualPregens": [list(seed) for seed in by_path.values()],
        "transNumber": play.trans_number,
        "issues": issues, "screenshot_b64": None, "source_file": source_file,
    }


class TestdataVerifierHarnessTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier_harness",
            description=(
                "Browser-driven TestData verification with no interactive Okta/MFA prompt. Accepts "
                "either the QA-only Titan Harness launcher page (/harness/ in the path) or the "
                "game's own launch URL (which carries the account in its query string) — the URL "
                "decides which. Uploads testdata directly to Axiom over HTTP (x-api-key), then "
                "drives a real Chrome via Playwright to play every .testdata record and check the "
                "seed the server actually consumed. Keeps screenshots, unlike testdata_verifier_api."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=False,
                              description="Absolute path to a single .testdata XML file (backward compat)."),
                ToolParameter(name="testdata_files", type="array", required=False,
                              description="List of absolute paths to .testdata XML files. All files in one "
                                          "run must share the same <Key loginName>/<moduleID> — a single "
                                          "session only logs into one account/module at a time."),
                ToolParameter(name="harness_url", type="string", required=True,
                              description="Launch URL for this game version. Either the Titan Harness "
                                          "launcher page (…/htmlGames/4.54.0/harness/<gameId>) or the "
                                          "game's own /launch/<module>/… URL including the username / "
                                          "password / moduleId query params. A URL containing /harness/ is "
                                          "driven through the harness form; anything else is opened as-is."),
                ToolParameter(name="axiom_api_key", type="string", required=True,
                              description="Long-lived Axiom API Key ('x-api-key' header) — authenticates "
                                          "the testdata upload. Unrelated to the game login itself."),
                ToolParameter(name="env", type="string", default="",
                              description="Platform environment slug for the Axiom upload host "
                                          "(e.g. 'gtp603'). Derived from the URL's host when that host is "
                                          "<service>-<env>.installprogram.eu; pass it explicitly when the "
                                          "client runs locally (http://localhost:5241/…), where the URL "
                                          "carries no env even though the game is remote."),
                ToolParameter(name="product_id", type="string", required=False,
                              description="Harness form's Product Id field (harness URLs only). Fixed per "
                                          "game-module version, not derivable from the testdata file — "
                                          "confirmed 5001 for moduleId 105170 on gtp537."),
                ToolParameter(name="client_id", type="string", required=False,
                              description="Harness form's Client Id field (harness URLs only). Fixed per "
                                          "game-module version — confirmed 40300 for moduleId 105170 on gtp537."),
                ToolParameter(name="brand", type="string", default="IslandParadise",
                              description="Harness form's Brand field (harness URLs only)."),
                ToolParameter(name="harness_password", type="string", default=TITAN_DEFAULT_PASSWORD,
                              description="Harness form's Password field (harness URLs only). A single "
                                          "shared value for every QA test account on this platform, not a "
                                          "per-account secret — the page itself pre-fills this same value. "
                                          "The HARNESS_TESTER_PASSWORD environment variable overrides the "
                                          "default."),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
                ToolParameter(name="screenshot_on_bonus", type="boolean", default=True,
                              description="Take a screenshot for bonus-trigger spins."),
                ToolParameter(name="screenshot_on_fail", type="boolean", default=True,
                              description="Take a screenshot for failed spins."),
                ToolParameter(name="harness_load_timeout_sec", type="number", default=60,
                              description="Seconds to wait for the launch page, the game frame, and the "
                                          "game's own window.jftwTools to come up. No human MFA step is "
                                          "involved, so this stays short."),
                ToolParameter(name="time_scale", type="number", default=_SESSION_DEFAULTS.time_scale,
                              description="Game engine animation-clock speed in percent, applied via "
                                          "window.jftwTools (SessionConfig.time_scale; 100 = normal). Higher "
                                          "values make big-win celebrations resolve faster, which is what "
                                          "keeps the next spin from waiting on an animation."),
                ToolParameter(name="play_timeout_sec", type="number",
                              default=_SESSION_DEFAULTS.play_timeout_sec,
                              description="How long one play may take, spin to idle, before it is reported "
                                          "as a TIMEOUT (SessionConfig.play_timeout_sec). Long bonus chains "
                                          "are slow, so raise this on a loaded environment."),
            ]),
            permissions=["filesystem:write", "browser:automation", "network:outbound"],
            timeout_seconds=1800,
            version="2.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        import asyncio
        return await asyncio.to_thread(self._run_verification_sync, params, ctx)

    def _run_verification_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from server.infra import cancellation

        # ── Resolve + parse every testdata file, and enforce they share one identity ──
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

        game_url: str = params["harness_url"]
        axiom_api_key: str = params["axiom_api_key"]
        harness_password: str = params.get("harness_password") or TITAN_DEFAULT_PASSWORD
        screenshot_bonus: bool = bool(params.get("screenshot_on_bonus", True))
        screenshot_fail: bool = bool(params.get("screenshot_on_fail", True))
        load_timeout: float = float(params.get("harness_load_timeout_sec", 60))
        # Only these two are caller-tunable; the rest of SessionConfig stays at the session layer's
        # own defaults (see _SESSION_DEFAULTS).
        session_config = SessionConfig(
            time_scale=int(params.get("time_scale", _SESSION_DEFAULTS.time_scale)),
            play_timeout_sec=float(params.get("play_timeout_sec", _SESSION_DEFAULTS.play_timeout_sec)),
        )

        output = (
            Path(params["output_report"])
            if params.get("output_report")
            else (Path(ctx.work_dir) / "report.html")
        )
        output.parent.mkdir(parents=True, exist_ok=True)

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
                ) + " — a single session only logs into one account/module; run these as separate batches.",
            )
        login_name, module_id = next(iter(keys_seen))
        if not login_name or not module_id:
            return ToolResult(success=False, error="testdata_key_missing_loginName_or_moduleID")

        spec = LaunchSpec(
            url=game_url, username=login_name, module_id=module_id, password=harness_password,
            product_id=str(params.get("product_id") or ""), client_id=str(params.get("client_id") or ""),
            brand=params.get("brand") or "IslandParadise",
        )
        # A direct URL logs in with whatever account it carries, and the game silently serves that
        # account's queued seed rather than the uploaded one when the two disagree — so catch the
        # mismatch here instead of reporting PASS/FAIL against data the game never used.
        if spec.mode == "direct":
            url_identity = _extract_url_identity(game_url)
            if url_identity["username"] or url_identity["moduleId"]:
                mismatches = _check_key_matches_url(
                    {"loginName": login_name, "moduleID": module_id}, url_identity)
                if mismatches:
                    return ToolResult(success=False,
                                      error="testdata_key_does_not_match_launch_url:" + "; ".join(mismatches))
        elif not (spec.product_id and spec.client_id):
            # Only the harness form needs these, so they cannot be universally required parameters —
            # but an empty value would be typed into the form and submitted, failing later with a
            # confusing "no game" instead of saying what is actually missing.
            return ToolResult(
                success=False,
                error="harness_form_fields_missing:product_id and client_id are required for a "
                      "/harness/ URL — they are fixed per game-module version and not derivable from "
                      "the testdata file.",
            )

        # ── Env first: the upload host is built from it, and that happens before the browser ──
        try:
            env = require_env_before_launch(params.get("env"), game_url)
        except ValueError as e:
            return ToolResult(success=False, error=str(e))
        upload_host = axiomcore_host(env)

        log.info("verifier_harness.start", login_name=login_name, module_id=module_id, env=env,
                 mode=spec.mode, files=len(testdata_files_list))

        # ── Upload every testdata file over HTTP (no Okta, no browser needed) ──
        with httpx.Client(timeout=30.0) as client:
            for tf in testdata_files_list:
                try:
                    with open(tf, "rb") as fh:
                        upload_resp = client.post(
                            f"https://{upload_host}/Upload/TestDataFile",
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

        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        all_results: list[dict] = []
        all_records_flat: list[dict] = []
        artifacts: list[str] = []
        records_flat = [
            (Path(fp).name, rec) for fp, recs in all_records_by_file.items() for rec in recs
        ]
        max_consecutive_network_errors, max_consecutive_seed_rejections = 3, 2
        consecutive_network_errors = consecutive_seed_rejections = 0
        # Why the run stopped early, if it did: "environment" (timeouts/reloads) and "seeds"
        # (the server refusing the queued seeds) are unrelated causes and must not be reported
        # as each other — a rejected seed is testdata/seed-queue trouble, not a network fault.
        abort_reason: str | None = None
        cancel_event = threading.Event()
        cancellation.register(ctx.execution_id, cancel_event.set)

        try:
            with open_session(spec, headless=True, config=session_config, log=log.info,
                              cancel_event=cancel_event, enter_timeout_sec=load_timeout) as gs:
                restored = gs.finish_restored_play(screenshots_dir)
                if restored is not None:
                    # An unfinished play the page restored on load: played out first so the first
                    # .testdata record is not attributed to it.
                    log.info("verifier_harness.restored_play", responses=len(restored.responses),
                             error=restored.error.code if restored.error else None)

                last_spin: PlayResponse | None = None
                for file_name, rec in records_flat:
                    if cancel_event.is_set() or abort_reason is not None:
                        verdict, issue = _not_run_reason(
                            stopped=cancel_event.is_set(), abort_reason=abort_reason,
                            max_network_errors=max_consecutive_network_errors,
                            max_seed_rejections=max_consecutive_seed_rejections)
                        all_results.append(_empty_result(file_name, verdict, [issue]))
                        all_records_flat.append(rec)
                        continue

                    log.info("verifier_harness.record", spin=rec["spinIndex"], stage=rec["stage"],
                             batch=rec["batch"], index=rec["index"])
                    if rec["stage"] != "BaseGame":
                        # The game auto-plays this round after the spin that triggered it, so
                        # clicking Spin for it would be wrong — judge it against that Spin's echo.
                        result = _compare_play(rec, last_spin, file_name)
                    else:
                        play_result = gs.play(label=f"{file_name}:spin{rec['spinIndex']}")
                        if play_result.error is not None:
                            result = _error_result(play_result.error, file_name)
                        else:
                            last_spin = _spin_of(play_result)
                            result = _compare_play(rec, last_spin, file_name)

                    if result["verdict"] == "TIMEOUT" or result["verdict"] == "PAGE_RELOADED":
                        consecutive_network_errors += 1
                        consecutive_seed_rejections = 0
                    elif result["verdict"] == "SEED_REJECTED":
                        consecutive_seed_rejections += 1
                        consecutive_network_errors = 0
                    else:
                        consecutive_network_errors = 0
                        consecutive_seed_rejections = 0

                    need_screenshot = (rec["isBonus"] and screenshot_bonus) or (
                        not result["passed"] and screenshot_fail)
                    if need_screenshot:
                        shot = gs.screenshot(
                            screenshots_dir
                            / f"{file_name}_spin{rec['spinIndex']}_{'pass' if result['passed'] else 'fail'}.png")
                        if shot:
                            artifacts.append(str(Path(shot).resolve()))
                            result["screenshot_b64"] = base64.b64encode(
                                Path(shot).read_bytes()).decode("utf-8")

                    if consecutive_network_errors >= max_consecutive_network_errors:
                        abort_reason = "environment"
                        result["issues"].append(
                            f"Environment UNAVAILABLE: {max_consecutive_network_errors} consecutive "
                            "timeouts/page reloads — remaining records will not be verified")
                    elif consecutive_seed_rejections >= max_consecutive_seed_rejections:
                        abort_reason = "seeds"
                        result["issues"].append(
                            f"Seeds REJECTED by the server {max_consecutive_seed_rejections} times in a "
                            "row — remaining records will not be verified; this is a testdata/seed-queue "
                            "problem, not an environment failure")

                    all_results.append(result)
                    all_records_flat.append(rec)

            # ── Report, in the same format the other testdata tools produce ──
            passed_count = sum(1 for r in all_results if r["passed"])
            total = len(all_results)
            is_multi = len(testdata_files_list) > 1
            report_label = (
                f"{len(testdata_files_list)} files batch verification ({spec.mode} login: {login_name})"
                if is_multi else testdata_files_list[0].name
            )
            report_path = _generate_html_report(
                all_records_flat, all_results, game_url, report_label, output, multi_file=is_multi,
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
                    "mode": spec.mode,
                    "env": env,
                    "cases": [
                        {"spinIndex": rec["spinIndex"], "stage": rec["stage"],
                         "expectedBatch": rec["batch"], "expectedIndex": rec["index"],
                         "isBonus": rec["isBonus"], **r}
                        for rec, r in zip(all_records_flat, all_results)
                    ],
                },
                execution_ms=0, artifacts=artifacts,
            )

        except SessionError as e:
            return ToolResult(success=False, error=f"session_error:{e.code}:{e.message}")
        except Exception as e:
            return ToolResult(success=False, error=f"verification_error:{type(e).__name__}:{e}")
        finally:
            cancellation.unregister(ctx.execution_id)
