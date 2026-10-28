"""
TestData verification of a whole folder through a local game link, one file at a time.

The link is the game's own launch URL served by a locally running client, e.g.
  http://localhost:5240/launch/mgs/luckyJourneyPowerCombo?moduleId=102554&clientId=40302
      &productId=5001&brand=IslandParadise&username=lijunt&password=...
It logs itself in from its query string, so there is no Okta and no harness form. The game it plays
against is still remote (gtp603, ...), which is where testdata is uploaded.

How this differs from testdata_verifier_harness, which can open the same URL:
  - The server keeps one active .testdata per (loginName, moduleID) — see
    assign_testdata_accounts.py. testdata_verifier_harness uploads every file first and then plays
    them all, which only works when each file has its own account. Here every file is uploaded *and
    played* before the next one is uploaded, so a single account can verify the whole folder. Each
    upload also replaces whatever was left queued, so a file whose plays went wrong cannot shift the
    seeds of the files after it.
  - Each file's <Key loginName> is rewritten in the uploaded copy (the file on disk is never
    touched), so a folder generated for any account — or with an empty loginName — can be verified:
      * by default to the link's own username, all files in one browser session;
      * with `account_keyword` (+ `account_count`), to the accounts Axiom's "Bulk Create Multiple
        Accounts" made from that keyword (automate1, automate2, ...), one per file in name order —
        each file then gets its own session, opened with the link's username replaced by its account.
        The tester creates the accounts in Axiom with the same keyword and count.
    moduleID is *not* rewritten: a file for another module (an RTP variant, another game) would be
    served seeds from the wrong pregen pool, so its records are reported MODULE_MISMATCH and not
    played; the rest of the folder still runs.
  - The env (gtp603, ...) does not have to be passed: the first upload happens after the page has
    loaded, by which time the game's own /casino/play|user traffic names its host.
  - One file's rejected seeds stop that file, not the run; timeouts/page reloads still stop the run
    (that is the environment, and every later file would fail the same way).

UNVERIFIED against a live run: uploading while the game page is already open. The server reads the
seed queue when a Spin arrives, so a page loaded before the upload is expected to pick it up on its
next Spin — watch the first live run for the first record of each file reporting the previous
file's seed.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx

from server.game_session import LaunchSpec, SessionConfig, SessionError, open_session
from server.game_session.env import axiomcore_host, resolve_env
from server.infra.logger import log
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verifier_harness_tool import _Run, _upload_testdata
from server.tools.impl.testdata_verify_common import (
    _extract_testdata_key, _extract_url_identity, _parse_testdata, keyword_accounts,
    testdata_bytes_with_login, url_with_username,
)

_SESSION_DEFAULTS = SessionConfig()


def _redact_url(url: str) -> str:
    """The launch URL with its password query param masked — it goes into the report and logs."""
    parsed = urlparse(url)
    query = [(k, "***" if k.lower() == "password" else v) for k, v in parse_qsl(parsed.query)]
    return parsed._replace(query=urlencode(query)).geturl()


def _collect_files(params: dict[str, Any]) -> list[Path] | str:
    """The .testdata files to verify, in case-insensitive name order, or an error string."""
    if params.get("testdata_files"):
        files = [Path(fp) for fp in params["testdata_files"]]
        missing = [str(p) for p in files if not p.exists()]
        if missing:
            return f"testdata_file_not_found:{missing[0]}"
    elif params.get("testdata_folder"):
        folder = Path(params["testdata_folder"])
        if not folder.is_dir():
            return f"testdata_folder_not_found:{folder}"
        files = list(folder.glob("*.testdata"))
        if not files:
            return f"testdata_folder_has_no_testdata_files:{folder}"
    else:
        return "No testdata_folder or testdata_files provided"
    return sorted(files, key=lambda p: p.name.lower())


class TestdataVerifierLocalTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_verifier_local",
            description=(
                "Verifies every .testdata file of a folder through a local game link "
                "(http://localhost:<port>/launch/mgs/<game>?moduleId=..&username=..&password=..). "
                "Each file is uploaded to Axiom with its loginName rewritten — to the link's username, or "
                "to its own account from account_keyword — then all of its records are played before the "
                "next file is uploaded."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="game_url", type="string", required=True,
                              description="The local game launch URL, including its username / password / "
                                          "moduleId query params. A /harness/ URL is not accepted here — "
                                          "use testdata_verifier_harness for the Titan launcher."),
                ToolParameter(name="testdata_folder", type="string", required=False,
                              description="Absolute path of a folder; every *.testdata file in it is verified."),
                ToolParameter(name="testdata_files", type="array", required=False,
                              description="Absolute paths of .testdata files, used instead of testdata_folder."),
                ToolParameter(name="axiom_api_key", type="string", required=True,
                              description="Long-lived Axiom API Key ('x-api-key' header) for the testdata upload."),
                ToolParameter(name="env", type="string", default="",
                              description="Platform environment slug for the upload host (e.g. 'gtp603'). "
                                          "Optional: read from the game's own traffic once the page has "
                                          "loaded when left empty."),
                ToolParameter(name="account_keyword", type="string", default="",
                              description="Username keyword used in Axiom's 'Bulk Create Multiple Accounts' "
                                          "(e.g. 'automate' -> automate1, automate2, ...). When set, each file "
                                          "in name order is uploaded and played as the next account instead "
                                          "of the link's username. The link's password is used for all of them."),
                ToolParameter(name="account_count", type="number", default=0,
                              description="Number of accounts created in Axiom with account_keyword. Must be "
                                          "at least the number of files to play."),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
                ToolParameter(name="screenshot_on_bonus", type="boolean", default=True,
                              description="Take a screenshot for bonus-trigger spins."),
                ToolParameter(name="screenshot_on_fail", type="boolean", default=True,
                              description="Take a screenshot for failed spins."),
                ToolParameter(name="load_timeout_sec", type="number", default=60,
                              description="Seconds to wait for the game page and window.jftwTools."),
                ToolParameter(name="time_scale", type="number", default=_SESSION_DEFAULTS.time_scale,
                              description="Game engine animation-clock speed in percent (100 = normal)."),
                ToolParameter(name="play_timeout_sec", type="number",
                              default=_SESSION_DEFAULTS.play_timeout_sec,
                              description="How long one play may take, spin to idle, before it is a TIMEOUT."),
            ]),
            permissions=["filesystem:write", "browser:automation", "network:outbound"],
            timeout_seconds=3600,
            version="1.1.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        import asyncio
        return await asyncio.to_thread(self._run_verification_sync, params, ctx)

    def _run_verification_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from server.infra import cancellation

        game_url: str = params["game_url"]
        if LaunchSpec(url=game_url).mode != "direct":
            return ToolResult(success=False, error="local_link_is_a_harness_url: use testdata_verifier_harness "
                                                   "for a /harness/ launcher page")
        identity = _extract_url_identity(game_url)
        username, module_id = identity["username"], identity["moduleId"]
        if not username or not module_id:
            return ToolResult(success=False, error="local_link_missing_username_or_moduleId: the link must "
                                                   "carry both as query params — it is what logs the game in")

        files = _collect_files(params)
        if isinstance(files, str):
            return ToolResult(success=False, error=files)

        # Parse everything up front: a malformed file fails the run before the browser starts.
        parsed: list[tuple[Path, list[dict], dict]] = []
        for tf in files:
            try:
                records = _parse_testdata(tf)
                key = _extract_testdata_key(tf)
            except Exception as e:
                return ToolResult(success=False, error=f"testdata_parse_error:{tf.name}:{e}")
            if not records:
                return ToolResult(success=False, error=f"testdata_file_contains_no_spins:{tf.name}")
            parsed.append((tf, records, key))

        # A file for another module is reported, not played, and takes no account.
        playable = [(tf, records) for tf, records, key in parsed if key["moduleID"] == module_id]
        account_keyword = str(params.get("account_keyword") or "").strip()
        if account_keyword:
            try:
                accounts = keyword_accounts(account_keyword, int(params.get("account_count") or 0), len(playable))
            except ValueError as e:
                return ToolResult(success=False, error=str(e))
        else:
            accounts = [username] * len(playable)
        file_accounts = {tf.name: account for (tf, _), account in zip(playable, accounts)}

        # One session per account: the whole folder with the link's own login, or one file per account.
        sessions: list[tuple[str, list[tuple[Path, list[dict]]]]] = []
        for (tf, records), account in zip(playable, accounts):
            if sessions and sessions[-1][0] == account:
                sessions[-1][1].append((tf, records))
            else:
                sessions.append((account, [(tf, records)]))

        axiom_api_key: str = params["axiom_api_key"]
        load_timeout = float(params.get("load_timeout_sec", 60))
        session_config = SessionConfig(
            time_scale=int(params.get("time_scale", _SESSION_DEFAULTS.time_scale)),
            play_timeout_sec=float(params.get("play_timeout_sec", _SESSION_DEFAULTS.play_timeout_sec)),
        )
        output = Path(params["output_report"]) if params.get("output_report") else Path(ctx.work_dir) / "report.html"
        output.parent.mkdir(parents=True, exist_ok=True)
        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        log.info("verifier_local.start", url=_redact_url(game_url), module_id=module_id, files=len(parsed),
                 sessions=len(sessions), account_keyword=account_keyword or None)

        cancel_event = threading.Event()
        cancellation.register(ctx.execution_id, cancel_event.set)
        run = _Run(cancel_event=cancel_event, screenshots_dir=screenshots_dir,
                   on_bonus=bool(params.get("screenshot_on_bonus", True)),
                   on_fail=bool(params.get("screenshot_on_fail", True)), log_prefix="verifier_local")
        env: str | None = (params.get("env") or "").strip().lower() or None

        for tf, records, key in parsed:
            if key["moduleID"] != module_id:
                run.skip([(tf.name, rec) for rec in records], "MODULE_MISMATCH",
                         f"Not verified: testdata Key moduleID={key['moduleID']!r} but the link plays "
                         f"moduleId={module_id!r} — the game would serve seeds from another pool")

        try:
            with httpx.Client(timeout=30.0) as client:
                for account, session_files in sessions:
                    all_items = [(tf.name, rec) for tf, records in session_files for rec in records]
                    if run.stopping:
                        run.skip_not_run(all_items)
                        continue
                    url = url_with_username(game_url, account) if account != username else game_url
                    try:
                        with open_session(LaunchSpec(url=url), headless=True, config=session_config,
                                          log=log.info, cancel_event=cancel_event,
                                          enter_timeout_sec=load_timeout) as gs:
                            restored = gs.finish_restored_play(screenshots_dir)
                            if restored is not None:
                                log.info("verifier_local.restored_play", login=account,
                                         responses=len(restored.responses),
                                         error=restored.error.code if restored.error else None)
                            env = env or resolve_env(None, game_url, gs.capture.platform_hosts)
                            if not env:
                                return ToolResult(
                                    success=False,
                                    error="env_required: the game page loaded but made no /casino/play|user "
                                          "request on an <service>-<env>.installprogram.eu host; pass env "
                                          "explicitly (e.g. 'gtp603' — the local client's jft.manifest.json "
                                          "has it as axiomGTP)")
                            upload_host = axiomcore_host(env)

                            for tf, records in session_files:
                                items = [(tf.name, rec) for rec in records]
                                if run.stopping:
                                    run.skip_not_run(items)
                                    continue
                                upload_error = _upload_testdata(client, upload_host, axiom_api_key, tf.name,
                                                                testdata_bytes_with_login(tf, account))
                                if upload_error:
                                    run.skip(items, "UPLOAD_FAILED", f"Not verified: {upload_error}")
                                    continue
                                log.info("verifier_local.uploaded", file=tf.name, login=account, env=env)
                                run.play(gs, items)
                    except SessionError as e:
                        if len(sessions) == 1:
                            raise
                        # One account that cannot get into the game (not created in Axiom, say) must
                        # not cost the other files their verification.
                        done = {id(rec) for rec in run.records}
                        run.skip([item for item in all_items if id(item[1]) not in done], "LOGIN_FAILED",
                                 f"Not verified: could not start a game session as {account!r} — "
                                 f"{e.code}: {e.message}")

            # Report in file-name order, whatever order the files were skipped/played in.
            order = {tf.name: i for i, (tf, _, _) in enumerate(parsed)}
            paired = sorted(zip(run.records, run.results), key=lambda rr: order[rr[1]["source_file"]])
            run.records, run.results = [r for r, _ in paired], [r for _, r in paired]

            label = (f"{len(parsed)} file(s) via local link, one account each "
                     f"({account_keyword}1..{account_keyword}{len(playable)}, env: {env})"
                     if account_keyword else
                     f"{len(parsed)} file(s) via local link (login: {username}, env: {env})")
            return run.report(
                _redact_url(game_url), label, output, ctx, "testdata_verifier_local",
                file_accounts=file_accounts if account_keyword else None,
                files_processed=len(parsed), mode="local", env=env,
                accounts=[{"file": f, "loginName": a} for f, a in file_accounts.items()],
            )

        except SessionError as e:
            return ToolResult(success=False, error=f"session_error:{e.code}:{e.message}")
        except Exception as e:
            return ToolResult(success=False, error=f"verification_error:{type(e).__name__}:{e}")
        finally:
            cancellation.unregister(ctx.execution_id)
