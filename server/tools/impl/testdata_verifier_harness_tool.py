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
    the triggering Spin's <TestData> echo, and a feature round written as its own
    <Spin stage="FreeSpin"> record is looked for in the echoes of that play (compare_feature);
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

Accounts: by default every file must already carry the same <Key loginName>/<moduleID>, and one
session plays them all. With `account_keyword` (+ `account_count`) each file instead gets its own
account, in file-name order, named the way Axiom's "Bulk Create Multiple Accounts" names them
(automate1, automate2, ...): the uploaded copy's loginName is set to it, and the file is played in its
own session logged in as that account (the harness form's Username, or the direct URL's username).
The tester creates the accounts in Axiom with the same keyword and count; nothing here creates them.

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
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import httpx

from server.game_session import (
    LaunchSpec, PlayResponse, SessionConfig, SessionError, open_session,
)
from server.game_session.env import axiomcore_host, require_env_before_launch
from server.game_session.launcher import TITAN_DEFAULT_PASSWORD
from server.infra.logger import log
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verify_common import (
    _check_key_matches_url,
    _empty_result,
    _extract_testdata_key,
    _extract_url_identity,
    _generate_html_report,
    _parse_testdata,
    compare_feature,
    compare_spin,
    is_base_stage,
    keyword_accounts,
    testdata_bytes_with_login,
    url_with_username,
)

# The session's own defaults, read so the schema below cannot drift from them. A tool param only
# exists where a live run has shown a reason to change the value; everything else in SessionConfig
# stays whatever the session layer decided.
_SESSION_DEFAULTS = SessionConfig()


# ── result builders: every case yields the same dict the report renderer expects ──────────────

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


def _upload_testdata(client: httpx.Client, upload_host: str, axiom_api_key: str,
                     name: str, content: bytes) -> str | None:
    """POST one .testdata file to Axiom. Returns an error string, or None on success."""
    try:
        resp = client.post(
            f"https://{upload_host}/Upload/TestDataFile",
            headers={"x-api-key": axiom_api_key},
            files={"testDataFormFile": (name, content, "application/octet-stream")},
        )
    except httpx.HTTPError as e:
        return f"testdata_upload_request_failed:{name}:{e}"
    if resp.status_code != 200:
        return f"testdata_upload_failed:{name}:HTTP{resp.status_code}:{resp.text[:500]}"
    return None


def _play_record(gs, rec: dict, file_name: str,
                 last_play: list[PlayResponse]) -> tuple[dict, list[PlayResponse]]:
    """Verify one .testdata record. Returns its result and the responses of the play the next
    feature record (if any) is judged against."""
    if not is_base_stage(rec["stage"]):
        # The game auto-plays this round after the spin that triggered it, so clicking Spin for it
        # would be wrong — judge it against that play's responses.
        return compare_feature(rec, last_play, file_name), last_play
    play_result = gs.play(label=f"{file_name}:spin{rec['spinIndex']}")
    if play_result.error is not None:
        return _error_result(play_result.error, file_name), []
    plays = [c.play for c in play_result.responses if c.play is not None]
    # Only the player-initiated Spin response carries the <TestData> echo.
    spin = next((p for p in plays if p.verb == "Spin"), None)
    return compare_spin(rec, spin, file_name), plays


def _attach_screenshot(gs, rec: dict, result: dict, file_name: str, screenshots_dir: Path,
                       artifacts: list[str], *, on_bonus: bool, on_fail: bool) -> None:
    if not ((rec["isBonus"] and on_bonus) or (not result["passed"] and on_fail)):
        return
    shot = gs.screenshot(
        screenshots_dir / f"{file_name}_spin{rec['spinIndex']}_{'pass' if result['passed'] else 'fail'}.png")
    if shot:
        artifacts.append(str(Path(shot).resolve()))
        result["screenshot_b64"] = base64.b64encode(Path(shot).read_bytes()).decode("utf-8")


MAX_CONSECUTIVE_NETWORK_ERRORS = 3
MAX_CONSECUTIVE_SEED_REJECTIONS = 2


@dataclass
class _Run:
    """Results of one verification run, which may span several game sessions (one per account).

    `play` verifies a list of records inside one session. Timeouts/page reloads three in a row mean
    the environment is down, which stops the whole run; seeds rejected twice in a row only stop the
    list being played, since a later list is a different upload (and possibly another account).
    """
    cancel_event: threading.Event
    screenshots_dir: Path
    on_bonus: bool
    on_fail: bool
    log_prefix: str
    results: list[dict] = field(default_factory=list)
    records: list[dict] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    environment_down: bool = False

    def skip(self, items: list[tuple[str, dict]], verdict: str, issue: str) -> None:
        for file_name, rec in items:
            self.results.append(_empty_result(file_name, verdict, [issue]))
            self.records.append(rec)

    def skip_not_run(self, items: list[tuple[str, dict]], abort_reason: str = "environment") -> None:
        verdict, issue = _not_run_reason(
            stopped=self.cancel_event.is_set(), abort_reason=abort_reason,
            max_network_errors=MAX_CONSECUTIVE_NETWORK_ERRORS,
            max_seed_rejections=MAX_CONSECUTIVE_SEED_REJECTIONS)
        self.skip(items, verdict, issue)

    @property
    def stopping(self) -> bool:
        return self.cancel_event.is_set() or self.environment_down

    def play(self, gs, items: list[tuple[str, dict]]) -> None:
        last_play: list[PlayResponse] = []
        network_errors = seed_rejections = 0
        abort_reason: str | None = None
        for i, (file_name, rec) in enumerate(items):
            if self.stopping or abort_reason is not None:
                self.skip_not_run(items[i:], abort_reason or "environment")
                return

            log.info(f"{self.log_prefix}.record", file=file_name, spin=rec["spinIndex"], stage=rec["stage"],
                     batch=rec["batch"], index=rec["index"])
            result, last_play = _play_record(gs, rec, file_name, last_play)

            if result["verdict"] in ("TIMEOUT", "PAGE_RELOADED"):
                network_errors, seed_rejections = network_errors + 1, 0
            elif result["verdict"] == "SEED_REJECTED":
                network_errors, seed_rejections = 0, seed_rejections + 1
            else:
                network_errors = seed_rejections = 0

            _attach_screenshot(gs, rec, result, file_name, self.screenshots_dir, self.artifacts,
                               on_bonus=self.on_bonus, on_fail=self.on_fail)

            if network_errors >= MAX_CONSECUTIVE_NETWORK_ERRORS:
                self.environment_down = True
                result["issues"].append(
                    f"Environment UNAVAILABLE: {MAX_CONSECUTIVE_NETWORK_ERRORS} consecutive "
                    "timeouts/page reloads — remaining records will not be verified")
            elif seed_rejections >= MAX_CONSECUTIVE_SEED_REJECTIONS:
                abort_reason = "seeds"
                result["issues"].append(
                    f"Seeds REJECTED by the server {MAX_CONSECUTIVE_SEED_REJECTIONS} times in a row — the "
                    "rest of these records will not be verified; this is a testdata/seed-queue problem, "
                    "not an environment failure")

            self.results.append(result)
            self.records.append(rec)

    def report(self, game_url: str, label: str, output: Path, ctx: HarnessContext, tool_name: str,
               file_accounts: dict[str, str] | None = None, **extra: Any) -> ToolResult:
        """Write the HTML report and build the ToolResult every testdata verifier returns."""
        passed = sum(1 for r in self.results if r["passed"])
        total = len(self.results)
        is_multi = len({r["source_file"] for r in self.results}) > 1
        report_path = _generate_html_report(self.records, self.results, game_url, label, output,
                                            multi_file=is_multi or bool(file_accounts),
                                            file_accounts=file_accounts)
        self.artifacts.append(str(output.resolve()))
        report_url = None
        try:
            rel = Path(report_path).resolve().relative_to(Path(ctx.work_dir).resolve())
            report_url = f"/api/executions/runs/{ctx.execution_id}/{tool_name}/{rel.as_posix()}"
        except ValueError:
            pass
        return ToolResult(
            success=passed == total,
            content={
                "total": total, "passed": passed, "failed": total - passed,
                "passRate": round(passed / total * 100, 1) if total else 0,
                "report_html": report_path,
                "report_url": report_url,
                **extra,
                "cases": [
                    {"spinIndex": rec["spinIndex"], "stage": rec["stage"],
                     "expectedBatch": rec["batch"], "expectedIndex": rec["index"],
                     "isBonus": rec["isBonus"], **r}
                    for rec, r in zip(self.records, self.results)
                ],
            },
            execution_ms=0, artifacts=self.artifacts,
        )


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
                              description="List of absolute paths to .testdata XML files. Without "
                                          "account_keyword they must all share the same <Key loginName>/"
                                          "<moduleID> — a single session only logs into one account/module."),
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
                ToolParameter(name="account_keyword", type="string", default="",
                              description="Username keyword used in Axiom's 'Bulk Create Multiple Accounts' "
                                          "(e.g. 'automate' -> automate1, automate2, ...). When set, files are "
                                          "taken in name order and each gets the next account: its uploaded "
                                          "copy's loginName is set to it and it is played in its own session "
                                          "as that account. Empty: every file must share one <Key> identity."),
                ToolParameter(name="account_count", type="number", default=0,
                              description="Number of accounts created in Axiom with account_keyword. Must be "
                                          "at least the number of files."),
            ]),
            permissions=["filesystem:write", "browser:automation", "network:outbound"],
            timeout_seconds=1800,
            version="2.2.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        import asyncio
        return await asyncio.to_thread(self._run_verification_sync, params, ctx)

    def _run_verification_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from server.infra import cancellation

        # ── Resolve + parse every testdata file ──
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
        load_timeout: float = float(params.get("harness_load_timeout_sec", 60))
        account_keyword = str(params.get("account_keyword") or "").strip()
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

        if account_keyword:
            # Axiom numbers the accounts in creation order; files take them in name order.
            testdata_files_list.sort(key=lambda p: p.name.lower())

        all_records_by_file: dict[str, list[dict]] = {}
        keys: dict[str, dict] = {}
        for tf in testdata_files_list:
            try:
                records = _parse_testdata(tf)
            except Exception as e:
                return ToolResult(success=False, error=f"testdata_parse_error:{tf.name}:{e}")
            if not records:
                return ToolResult(success=False, error=f"testdata_file_contains_no_spins:{tf.name}")
            all_records_by_file[str(tf)] = records
            keys[str(tf)] = _extract_testdata_key(tf)

        base_spec = LaunchSpec(
            url=game_url, password=harness_password,
            product_id=str(params.get("product_id") or ""), client_id=str(params.get("client_id") or ""),
            brand=params.get("brand") or "IslandParadise",
        )
        if base_spec.mode == "titan" and not (base_spec.product_id and base_spec.client_id):
            # Only the harness form needs these, so they cannot be universally required parameters —
            # but an empty value would be typed into the form and submitted, failing later with a
            # confusing "no game" instead of saying what is actually missing.
            return ToolResult(
                success=False,
                error="harness_form_fields_missing:product_id and client_id are required for a "
                      "/harness/ URL — they are fixed per game-module version and not derivable from "
                      "the testdata file.",
            )
        url_identity = _extract_url_identity(game_url)

        # ── Who plays which file: one (spec, files) group per session ──
        groups: list[tuple[LaunchSpec, list[Path]]] = []
        file_accounts: dict[str, str] = {}
        if account_keyword:
            try:
                accounts = keyword_accounts(account_keyword, int(params.get("account_count") or 0),
                                            len(testdata_files_list))
            except ValueError as e:
                return ToolResult(success=False, error=str(e))
            for tf, account in zip(testdata_files_list, accounts):
                module_id = keys[str(tf)]["moduleID"]
                if not module_id:
                    return ToolResult(success=False, error=f"testdata_key_missing_moduleID:{tf.name}")
                if base_spec.mode == "direct" and url_identity["moduleId"] and module_id != url_identity["moduleId"]:
                    return ToolResult(
                        success=False,
                        error=f"testdata_key_does_not_match_launch_url:{tf.name}: moduleID={module_id!r} "
                              f"!= URL moduleId={url_identity['moduleId']!r}")
                url = url_with_username(game_url, account) if base_spec.mode == "direct" else game_url
                groups.append((replace(base_spec, url=url, username=account, module_id=module_id), [tf]))
                file_accounts[tf.name] = account
        else:
            keys_seen = {(k["loginName"], k["moduleID"]) for k in keys.values()}
            if len(keys_seen) > 1:
                return ToolResult(
                    success=False,
                    error="testdata_files_have_different_identities:" + "; ".join(
                        f"loginName={ln!r},moduleID={mid!r}" for ln, mid in keys_seen
                    ) + " — a single session only logs into one account/module; run these as separate "
                        "batches, or set account_keyword to give every file its own account.",
                )
            login_name, module_id = next(iter(keys_seen))
            if not login_name or not module_id:
                return ToolResult(success=False, error="testdata_key_missing_loginName_or_moduleID")
            # A direct URL logs in with whatever account it carries, and the game silently serves that
            # account's queued seed rather than the uploaded one when the two disagree — so catch the
            # mismatch here instead of reporting PASS/FAIL against data the game never used.
            if base_spec.mode == "direct" and (url_identity["username"] or url_identity["moduleId"]):
                mismatches = _check_key_matches_url(
                    {"loginName": login_name, "moduleID": module_id}, url_identity)
                if mismatches:
                    return ToolResult(success=False,
                                      error="testdata_key_does_not_match_launch_url:" + "; ".join(mismatches))
            groups.append((replace(base_spec, username=login_name, module_id=module_id), testdata_files_list))

        # ── Env first: the upload host is built from it, and that happens before the browser ──
        try:
            env = require_env_before_launch(params.get("env"), game_url)
        except ValueError as e:
            return ToolResult(success=False, error=str(e))
        upload_host = axiomcore_host(env)

        log.info("verifier_harness.start", env=env, mode=base_spec.mode, files=len(testdata_files_list),
                 sessions=len(groups), account_keyword=account_keyword or None)

        # ── Upload every testdata file over HTTP (no Okta, no browser needed). Every file either
        # shares the one account of a single session, or has an account of its own. ──
        with httpx.Client(timeout=30.0) as client:
            for tf in testdata_files_list:
                account = file_accounts.get(tf.name)
                content = testdata_bytes_with_login(tf, account) if account else tf.read_bytes()
                upload_error = _upload_testdata(client, upload_host, axiom_api_key, tf.name, content)
                if upload_error:
                    return ToolResult(success=False, error=upload_error)
                log.info("verifier_harness.uploaded", file=tf.name, login=account)

        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)
        cancel_event = threading.Event()
        cancellation.register(ctx.execution_id, cancel_event.set)
        run = _Run(cancel_event=cancel_event, screenshots_dir=screenshots_dir,
                   on_bonus=bool(params.get("screenshot_on_bonus", True)),
                   on_fail=bool(params.get("screenshot_on_fail", True)), log_prefix="verifier_harness")

        try:
            for spec, files in groups:
                items = [(tf.name, rec) for tf in files for rec in all_records_by_file[str(tf)]]
                if run.stopping:
                    run.skip_not_run(items)
                    continue
                try:
                    with open_session(spec, headless=True, config=session_config, log=log.info,
                                      cancel_event=cancel_event, enter_timeout_sec=load_timeout) as gs:
                        restored = gs.finish_restored_play(screenshots_dir)
                        if restored is not None:
                            # An unfinished play the page restored on load: played out first so the
                            # first .testdata record is not attributed to it.
                            log.info("verifier_harness.restored_play", responses=len(restored.responses),
                                     error=restored.error.code if restored.error else None)
                        run.play(gs, items)
                except SessionError as e:
                    if len(groups) == 1:
                        raise
                    # One account that cannot get into the game (not created in Axiom, say) must not
                    # cost the other files their verification.
                    run.skip(items, "LOGIN_FAILED",
                             f"Not verified: could not start a game session as {spec.username!r} — "
                             f"{e.code}: {e.message}")

            # ── Report, in the same format the other testdata tools produce ──
            if len(testdata_files_list) == 1:
                report_label = testdata_files_list[0].name
            elif account_keyword:
                report_label = (f"{len(testdata_files_list)} files, one account each "
                                f"({account_keyword}1..{account_keyword}{len(testdata_files_list)})")
            else:
                report_label = (f"{len(testdata_files_list)} files batch verification "
                                f"({base_spec.mode} login: {groups[0][0].username})")
            return run.report(
                game_url, report_label, output, ctx, "testdata_verifier_harness",
                file_accounts=file_accounts or None,
                files_processed=len(testdata_files_list), mode=base_spec.mode, env=env,
                accounts=[{"file": f, "loginName": a} for f, a in file_accounts.items()],
            )

        except SessionError as e:
            return ToolResult(success=False, error=f"session_error:{e.code}:{e.message}")
        except Exception as e:
            return ToolResult(success=False, error=f"verification_error:{type(e).__name__}:{e}")
        finally:
            cancellation.unregister(ctx.execution_id)
