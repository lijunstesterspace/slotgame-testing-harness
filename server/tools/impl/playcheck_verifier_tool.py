"""Plugin: playcheck_verifier — compare a game play's reel results against PlayCheck.

Manual tester flow (now automated):
  1. enter one or more cheats into the game
  2. spin
  3. open Game History → PlayCheck
  4. compare the game screen against PlayCheck's Reel Positions
  5. for bonus spins (one transaction, multiple Spin blocks), record the whole
     bonus and compare each Spin block against PlayCheck one by one

This tool drives the same browser context through both sides:
  - game side:  launch the game, apply cheats, spin, capture each /casino/play
                response's reel symbols + financials (via game_session)
  - playcheck side: open PlayCheck directly (same Axiom cookie), locate the
                transaction by transNumber, read its GameDetail page
  - compare:    financial summary (wagered / payout) and the reel symbol grids
                one Spin block at a time

The icon → SYM mapping is required for reel comparison and is loaded from
symbol_profiles/<module>.json (the same store portugal_plugin_symbol_map uses);
until a profile exists the reel check is skipped and only financials + structure
are compared.

UNVERIFIED against a live run: the cheat-application path (setCheat / URL hash)
and the PlayCheck GameDetail DOM selector for reel images
(playcheck._PC_GAME_DETAIL_JS). Both are best-effort heuristics that only a real
run can confirm; when the selector misses, the reel grid comes back empty and is
reported as a "no_grid" finding (REVIEW) rather than a silent pass.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from server.game_session import LaunchSpec, SessionConfig, open_session
from server.game_session.launcher import TITAN_DEFAULT_PASSWORD, launch_chromium
from server.game_session.protocol import PlayResponse
from server.infra.logger import log
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.playcheck import PlayCheckClient, PlayCheckError, _js_fn

_DEFAULT_TOLERANCE = 0.005
_DEFAULT_DIVISOR = 100


def _cheat_js(cheats: list[str]) -> str:
    """Build the page-side call that applies cheats.

    Different games expose different cheat APIs; try the common ones in order
    and report which (if any) accepted the call. The caller can read the
    returned string from the diag dict.

    The body uses `return`, so it is wrapped in an arrow function (playcheck._js_fn): handed to
    frame.evaluate as a bare statement list it raises "SyntaxError: Illegal return statement" and
    the whole run fails before the first spin.
    """
    payload = json.dumps(cheats)
    return _js_fn(f"""
const cheats = {payload};
let tried = [], ok = null;
const try_ = (label, fn) => {{ tried.push(label); try {{ const r = fn(); if (r !== undefined) ok = label + ':' + JSON.stringify(r); }} catch (e) {{}} }};
try_('jftwTools.common.setCheat', () => window.jftwTools.common.setCheat(cheats));
try_('jftwTools.common.setCheats', () => window.jftwTools.common.setCheats(cheats));
try_('jftwTools.cheat.set', () => window.jftwTools.cheat.set(cheats));
try_('hash', () => {{ location.hash = '#cheat=' + encodeURIComponent(cheats.join(',')); return true; }});
return {{ tried, ok }};
""")


def _game_financials(resp: PlayResponse) -> dict[str, float | None]:
    """Sum wagered / won across all stages of one response (one transaction)."""
    wagered = won = 0.0
    has = False
    for st in resp.stages:
        for key in ("totalWager", "wager"):
            v = st.financials.get(key)
            if isinstance(v, (int, float)):
                wagered += v
                has = True
                break
        for key in ("totalWin", "win"):
            v = st.financials.get(key)
            if isinstance(v, (int, float)):
                won += v
                has = True
                break
    # Fall back to top-level financials if stages had no money data.
    if not has:
        return {"wagered": resp.wager, "won": resp.total_win if resp.total_win is not None else resp.win}
    return {"wagered": wagered, "won": won}


def _game_spins(resp: PlayResponse) -> list[dict]:
    """Flatten all stages' spins into one ordered list for PlayCheck comparison."""
    out: list[dict] = []
    for st in resp.stages:
        for sp in st.spins:
            out.append({"stage": st.name, "symbols": sp.symbols, "width": sp.width,
                        "height": sp.height, "seed": sp.seed, "grid": sp.grid()})
    return out


def _compare_financials(game_fin: dict, pc_fin: dict, tolerance: float, divisor: int) -> list[dict]:
    findings: list[dict] = []
    for label, gkey, pkey in (("wagered", "wagered", "wagered"), ("payout", "won", "payout")):
        gv = game_fin.get(gkey)
        pv = pc_fin.get(pkey)
        if gv is None or pv is None:
            findings.append({"check": label, "ok": False, "expected": gv, "actual": pv,
                             "reason": "missing_value"})
            continue
        # Game financials are in the game's own unit; PlayCheck shows the
        # display unit. The divisor (default 100: cents → dollars) converts
        # the game side; we accept either raw or divided.
        gv_div = gv / divisor if divisor else gv
        ok = abs(gv_div - pv) <= tolerance or abs(gv - pv) <= tolerance
        findings.append({"check": label, "ok": ok, "expected": gv, "actual": pv,
                         "expected_display": gv_div})
    return findings


def _compare_reels(game_spins: list[dict], pc_spins: list[dict], symbol_map: dict[str, str]) -> list[dict]:
    """Compare each Spin block's reel grid, cell by cell.

    `symbol_map` maps PlayCheck icon URL → game SYM id (string). Until a real
    profile exists this is empty and each reel check is recorded as skipped.

    A cell whose PlayCheck icon is not in the map cannot be judged: it makes the
    spin's finding inconclusive (`ok: None` → REVIEW) instead of being silently
    dropped, so an unmapped/profile-less run can never report a false PASS. A
    frame whose dimensions differ is a hard FAIL — comparing only the overlap
    would hide a reflowed/short reel.
    """
    findings: list[dict] = []
    if not symbol_map:
        findings.append({"check": "reels", "ok": None, "reason": "no_symbol_map_profile"})
        return findings
    if len(game_spins) != len(pc_spins):
        findings.append({"check": "spin_count", "ok": False,
                         "expected": len(game_spins), "actual": len(pc_spins)})
    for i in range(min(len(game_spins), len(pc_spins))):
        stage = game_spins[i].get("stage")
        g = game_spins[i].get("grid") or []
        pc = pc_spins[i].get("reel_images") or []
        if not g or not pc:
            findings.append({"check": f"reels_spin_{i}", "ok": None, "reason": "no_grid", "stage": stage})
            continue
        g_rows, g_cols = len(g), len(g[0])
        pc_rows = len(pc)
        pc_cols = max((len(r) for r in pc), default=0)
        if (g_rows, g_cols) != (pc_rows, pc_cols) or any(len(r) != g_cols for r in pc):
            findings.append({"check": f"reels_spin_{i}", "ok": False, "reason": "dimension_mismatch",
                             "expected": f"{g_rows}x{g_cols}", "actual": f"{pc_rows}x{pc_cols}",
                             "stage": stage})
            continue
        mismatches = unmapped = 0
        for r in range(g_rows):
            for c in range(g_cols):
                mapped = symbol_map.get(pc[r][c])
                if mapped is None:
                    unmapped += 1
                elif mapped != str(g[r][c]):
                    mismatches += 1
        if mismatches:
            findings.append({"check": f"reels_spin_{i}", "ok": False, "mismatches": mismatches,
                             "unmapped": unmapped, "stage": stage})
        elif unmapped:
            # Every cell matched what we could map, but some icons have no mapping —
            # inconclusive, never a PASS.
            findings.append({"check": f"reels_spin_{i}", "ok": None, "reason": "unmapped_icons",
                             "unmapped": unmapped, "stage": stage})
        else:
            findings.append({"check": f"reels_spin_{i}", "ok": True, "mismatches": 0, "stage": stage})
    return findings


def _verdict(findings: list[dict]) -> str:
    if any(f.get("ok") is False for f in findings):
        return "FAIL"
    if any(f.get("ok") is None for f in findings):
        return "REVIEW"
    return "PASS"


def _render_html(trans_number: int, findings: list[dict], game_spins: list[dict],
                 pc_spins: list[dict], game_fin: dict, pc_fin: dict) -> str:
    rows = "\n".join(
        f"<tr><td>{html.escape(str(f.get('check','')))}</td>"
        f"<td>{'✓' if f.get('ok') is True else ('✗' if f.get('ok') is False else '—')}</td>"
        f"<td>{html.escape(json.dumps(f, default=str))}</td></tr>"
        for f in findings
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>PlayCheck Verification — trans {trans_number}</title>
<style>body{{font-family:system-ui,sans-serif;margin:24px}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:6px 10px}}</style>
</head><body>
<h1>PlayCheck Verification</h1>
<p>Transaction: <b>{trans_number}</b> · Verdict: <b>{_verdict(findings)}</b></p>
<h2>Financials</h2>
<table><tr><th>Side</th><th>Wagered</th><th>Payout</th></tr>
<tr><td>Game</td><td>{game_fin.get('wagered')}</td><td>{game_fin.get('won')}</td></tr>
<tr><td>PlayCheck</td><td>{pc_fin.get('wagered')}</td><td>{pc_fin.get('payout')}</td></tr>
</table>
<h2>Findings ({len(findings)})</h2>
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>{rows}</table>
<h2>Game Spins: {len(game_spins)} · PlayCheck Spins: {len(pc_spins)}</h2>
</body></html>"""


class PlaycheckVerifierTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="playcheck_verifier",
            description=(
                "Launch the game, apply cheats, spin, then open PlayCheck in the same browser "
                "session and compare the reel results + financials against PlayCheck's GameDetail "
                "page. Verdict: PASS / FAIL / REVIEW."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="game_url", type="string", required=True,
                              description="Game launch URL (harness or direct /launch/)."),
                ToolParameter(name="cheats", type="array", default=[],
                              description="Cheat codes to apply before spinning (game-specific)."),
                ToolParameter(name="spin_count", type="number", default=1,
                              description="Number of spins to play (each = one PlayCheck transaction)."),
                ToolParameter(name="trans_number", type="number", default=0,
                              description="Specific transaction to verify; 0 = use the latest spun."),
                ToolParameter(name="module_id", type="string", default="",
                              description="Module id for the symbol-map profile lookup, and the harness "
                                          "form's Module Id field (harness URLs only)."),
                ToolParameter(name="username", type="string", default="",
                              description="Harness form's Username field — the QA account to log in as "
                                          "(harness URLs only). Ignored for direct URLs, which carry the "
                                          "account in their own query string."),
                ToolParameter(name="harness_password", type="string", default=TITAN_DEFAULT_PASSWORD,
                              description="Harness form's Password field (harness URLs only). A single "
                                          "shared value for every QA test account on this platform, not a "
                                          "per-account secret — the page itself pre-fills this same value. "
                                          "The HARNESS_TESTER_PASSWORD environment variable overrides the "
                                          "default."),
                ToolParameter(name="product_id", type="string", default="",
                              description="Harness form's Product Id field (harness URLs only). Fixed per "
                                          "game-module version, not derivable from the URL."),
                ToolParameter(name="client_id", type="string", default="",
                              description="Harness form's Client Id field (harness URLs only). Fixed per "
                                          "game-module version, not derivable from the URL."),
                ToolParameter(name="brand", type="string", default="IslandParadise",
                              description="Harness form's Brand field (harness URLs only)."),
                ToolParameter(name="tolerance", type="number", default=_DEFAULT_TOLERANCE,
                              description="Money comparison tolerance in display units."),
                ToolParameter(name="money_divisor", type="number", default=_DEFAULT_DIVISOR,
                              description="Divide game-side money by this to match PlayCheck display units."),
                ToolParameter(name="headless", type="boolean", default=False,
                              description="Run the browser headless."),
                ToolParameter(name="time_scale", type="number", default=400,
                              description="Game engine animation speed percent."),
            ]),
            timeout_seconds=300,
            version="0.2.2",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        # Playwright's sync API blocks; run it off the event loop so the server stays responsive.
        import asyncio
        return await asyncio.to_thread(self._run_sync, params, ctx)

    def _run_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        out_dir = Path(ctx.work_dir) / "playcheck_verifier"
        out_dir.mkdir(parents=True, exist_ok=True)
        diag: dict[str, Any] = {}
        cheats: list[str] = list(params.get("cheats") or [])
        spin_count = max(1, int(params.get("spin_count") or 1))
        tolerance = float(params.get("tolerance") or _DEFAULT_TOLERANCE)
        divisor = int(params.get("money_divisor") or _DEFAULT_DIVISOR)
        module_id = str(params.get("module_id") or "")

        # The game URL is either a direct launch URL (carries the account in its query string) or
        # the Titan Harness form page (/harness/), which needs every field supplied explicitly.
        spec = LaunchSpec(
            url=str(params["game_url"]),
            username=str(params.get("username") or ""),
            password=str(params.get("harness_password") or TITAN_DEFAULT_PASSWORD),
            module_id=module_id,
            client_id=str(params.get("client_id") or ""),
            product_id=str(params.get("product_id") or ""),
            brand=str(params.get("brand") or "IslandParadise"),
        )
        if spec.mode == "titan":
            missing = [name for name, value in (("username", spec.username), ("product_id", spec.product_id),
                                                ("client_id", spec.client_id)) if not value]
            if missing:
                # An empty value would be typed into the form and submitted, failing later with a
                # confusing "no game" instead of saying what is actually missing. These are fixed per
                # game-module version (or the QA account to log in as), so none is derivable from the URL.
                return ToolResult(
                    success=False,
                    error=f"harness_form_fields_missing:{','.join(missing)} are required for a /harness/ "
                          f"URL — they are fixed per game-module version (or the QA account) and are not "
                          f"derivable from the URL.",
                )

        # ── Stage A: game side ──────────────────────────────────────
        game_responses: list[PlayResponse] = []
        trans_numbers: list[int] = []
        cfg = SessionConfig(time_scale=int(params.get("time_scale") or 400))
        try:
            with open_session(spec,
                              headless=bool(params.get("headless")),
                              config=cfg, log=log.info) as gs:
                # Apply cheats (best-effort; the page reports which API worked).
                if cheats:
                    cheat_res = gs.frame.evaluate(_cheat_js(cheats))
                    diag["cheat"] = cheat_res
                    log.info("playcheck_verifier.cheat_applied", result=cheat_res)
                # Spin and capture.
                for i in range(spin_count):
                    result = gs.play(f"spin_{i}")
                    for cap in result.responses:
                        if cap.play and cap.play.trans_number:
                            game_responses.append(cap.play)
                            trans_numbers.append(cap.play.trans_number)
                # Keep the page + browser alive: we need the same context for PlayCheck.
                # open_session closes the browser on exit, so we re-open below with a fresh
                # browser that shares the storage state. (In a future iteration we can keep
                # the same browser by refactoring open_session; for the skeleton we snapshot
                # storage state and reuse it.)
                storage_state = out_dir / "storage_state.json"
                try:
                    gs.page.context.storage_state(path=str(storage_state))
                    diag["storage_state"] = str(storage_state)
                except Exception as e:
                    diag["storage_state_error"] = str(e)
        except Exception as e:
            return ToolResult(success=False, error=f"game_session_failed:{type(e).__name__}:{e}",
                              content={"diag": diag})

        if not trans_numbers:
            return ToolResult(success=False, error="no_transactions_captured",
                              content={"diag": diag})

        target_trans = int(params.get("trans_number") or trans_numbers[-1])
        game_resp = next((r for r in game_responses if r.trans_number == target_trans), None)
        if game_resp is None:
            return ToolResult(success=False, error=f"trans_number_not_in_capture:{target_trans}",
                              content={"captured": trans_numbers, "diag": diag})

        game_fin = _game_financials(game_resp)
        game_spins = _game_spins(game_resp)

        # ── Stage B: PlayCheck side ────────────────────────────────
        # Derive the PlayCheck origin from the game URL's env slug.
        pc_origin = _playcheck_origin_from_game_url(params["game_url"])
        if not pc_origin:
            return ToolResult(success=False, error="cannot_derive_playcheck_origin_from_url",
                              content={"game_url": params["game_url"], "diag": diag})

        # Load the icon → SYM profile for this module (if any).
        symbol_map = _load_symbol_map(module_id) if module_id else {}

        # Open a fresh browser with the saved storage state (same Axiom cookies).
        from playwright.sync_api import sync_playwright  # local import: keeps the async tool signature
        with sync_playwright() as pw:
            browser = launch_chromium(pw, headless=bool(params.get("headless")))
            context = browser.new_context(storage_state=str(out_dir / "storage_state.json")
                                          if (out_dir / "storage_state.json").exists() else None)
            page = context.new_page()
            try:
                pc = PlayCheckClient(page, pc_origin, timeout=60)
                pc.open()
                found = pc.find_transaction(target_trans)
                if not found:
                    return ToolResult(success=False,
                                      error=f"trans_number_not_in_playcheck:{target_trans}",
                                      content={"captured": trans_numbers, "diag": diag})
                session_id, game_row = found
                detail = pc.get_game_detail(session_id, target_trans)
                pc_fin = detail.get("financials") or {}
                pc_spins = detail.get("spins") or []
            except PlayCheckError as e:
                return ToolResult(success=False, error=f"playcheck_error:{e}",
                                  content={"diag": diag})
            finally:
                context.close()
                browser.close()

        # ── Stage C: compare ───────────────────────────────────────
        findings = _compare_financials(game_fin, pc_fin, tolerance, divisor)
        findings += _compare_reels(game_spins, pc_spins, symbol_map)
        verdict = _verdict(findings)

        # ── Stage D: report ────────────────────────────────────────
        report_path = out_dir / f"playcheck_verification_trans{target_trans}.html"
        report_path.write_text(_render_html(target_trans, findings, game_spins, pc_spins,
                                            game_fin, pc_fin), encoding="utf-8")
        # The UI needs a URL it can fetch: the report sits under this tool's work_dir, which the
        # executions router serves at /api/executions/runs/<eid>/<tool_name>/<rel>.
        report_url = None
        try:
            rel = report_path.resolve().relative_to(Path(ctx.work_dir).resolve())
            report_url = f"/api/executions/runs/{ctx.execution_id}/{self.info.name}/{rel.as_posix()}"
        except ValueError:
            pass
        # A FAIL/REVIEW verdict is a *result*, not a tool failure: the report was produced and must be
        # shown. Marking success=False here would make the engine fail the step and the pipeline end
        # with status "failed", hiding the report behind a "Pipeline ended with status: failed" error.
        return ToolResult(
            success=True,
            content={
                "trans_number": target_trans,
                "verdict": verdict,
                "findings": findings,
                "game_financials": game_fin,
                "playcheck_financials": pc_fin,
                "game_spin_count": len(game_spins),
                "playcheck_spin_count": len(pc_spins),
                "report_html": str(report_path.resolve()),
                "report_url": report_url,
                "diag": diag,
            },
            artifacts=[str(report_path.resolve())],
        )


def _playcheck_origin_from_game_url(game_url: str) -> str | None:
    """Derive the PlayCheck origin from a game launch URL.

    Game URL:  https://mobile-app1-gtp601.installprogram.eu/htmlGames/...
    PlayCheck: https://playcheck-app1-gtp601.installprogram.eu
    The env slug (gtp601) is the second dash-separated token in the host.
    """
    try:
        host = urlparse(game_url).hostname or ""
        m = re.search(r"mobile-app1-(\w+)\.", host)
        if not m:
            m = re.search(r"app1-(\w+)\.", host)
        if not m:
            return None
        env = m.group(1)
        return f"https://playcheck-app1-{env}.installprogram.eu"
    except Exception:
        return None


def _load_symbol_map(module_id: str) -> dict[str, str]:
    """Load the PlayCheck icon-url → SYM map for a module from symbol_profiles/.

    Returns an empty dict if no profile (or no icon map on it) exists, in which case the reel
    comparison is skipped and only the financials + structure are compared. The icon map is an
    optional top-level "playcheck_icons" key — the store's own symbol_map is letter → SYM and is
    not usable against PlayCheck's icon URLs.
    """
    from server.tools.impl import symbol_profiles
    try:
        profile = symbol_profiles.get(symbol_profiles.profile_for(None, module_id)) or {}
        icons = profile.get("playcheck_icons")
        return {str(k): str(v) for k, v in icons.items()} if isinstance(icons, dict) else {}
    except Exception:
        return {}
