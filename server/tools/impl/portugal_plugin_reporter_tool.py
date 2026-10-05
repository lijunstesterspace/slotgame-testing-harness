"""Plugin: portugal_plugin_reporter — 对 portugal_plugin_parser 结果做一致性检查并输出 TXT / JSON / HTML 报告

The TXT report is the exact "Parsed Results" text of ppvACCR1.0.py. The consistency checks are
advisory only (they add findings, they never fail the step) — the original tool had no checks, so
nothing here changes what counts as a valid parse.
"""
from __future__ import annotations
import html
import json
from datetime import datetime
from typing import Any

from server.config import ARTIFACTS_DIR
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)
from server.tools.impl.portugal_plugin_parser_tool import format_report


def check_spins(spins: list[dict], symbol_map: dict[str, str]) -> list[dict]:
    """Advisory checks per spin. Each finding: {spin, check, message}."""
    known = set(symbol_map.values())
    findings: list[dict] = []
    for s in spins:
        sid = s.get("SPIN", "?")
        rows = s.get("ROWS") or []

        unknown = sorted({c for row in rows for c in row if c not in known}) if known else []
        if unknown:
            findings.append({"spin": sid, "check": "unmapped_symbol",
                             "message": f"Row cells not in symbol map: {', '.join(unknown)}"})

        widths = {len(r) for r in rows}
        if len(widths) > 1:
            findings.append({"spin": sid, "check": "row_width_mismatch",
                             "message": f"Rows have different cell counts: {sorted(widths)}"})

        # A win's symbol field is either one letter (mapped by the parser) or one letter per
        # symbol of the line, e.g. R#ahhh (kept raw, like the original tools) — valid when every
        # letter is in the map.
        bad_win_syms = sorted({
            w for w in s.get("WINNING_SYM") or []
            if w not in known and not (w.isalpha() and all(ch.upper() in symbol_map for ch in w))
        }) if known else []
        if bad_win_syms:
            findings.append({"spin": sid, "check": "unmapped_winning_symbol",
                             "message": f"Winning symbols not in symbol map: {', '.join(bad_win_syms)}"})

        # MV/MT/MG come once per spin (also on losing spins, as MG#0); R only appears per win,
        # so R is checked against whether the spin actually won, not against the MV/MT/MG count.
        counts = {
            "MV": len(s.get("BETS") or []),
            "MT": len(s.get("MULTIPLIERS") or []),
            "MG": len(s.get("WIN_AMOUNTS") or []),
        }
        if len(set(counts.values())) > 1:
            findings.append({"spin": sid, "check": "param_count_mismatch",
                             "message": "MV/MT/MG counts differ: " + ", ".join(f"{k}={v}" for k, v in counts.items())})
        spin_win = sum(s.get("WIN_AMOUNTS") or [])
        has_r = bool(s.get("WINNING_SYM"))
        if spin_win > 0 and not has_r:
            findings.append({"spin": sid, "check": "win_without_winning_symbol",
                             "message": f"MG total {spin_win:g} but no R (winning symbol) entry"})
        elif has_r and spin_win == 0:
            findings.append({"spin": sid, "check": "winning_symbol_without_win",
                             "message": f"R {', '.join(s['WINNING_SYM'])} present but MG total is 0"})
    return findings


def check_against_playcheck(spins: list[dict], total_win: float, divisor: float,
                            expected_payout: Any, expected_wager: Any, game_win: Any) -> list[dict]:
    """Hard checks for fetched outcomes: MG / MV are in minor units (e.g. 525740 → $5,257.40)."""
    out: list[dict] = []
    if expected_payout is not None:
        got = round(total_win / divisor, 2)
        out.append({"check": "payout_matches_playcheck", "passed": abs(got - float(expected_payout)) < 0.005,
                    "message": f"sum(MG)/{divisor:g} = {got:.2f} vs PlayCheck PAYOUT {float(expected_payout):.2f}"})
    first_bet = next((b for s in spins for b in (s.get("BETS") or [])), None)
    if expected_wager is not None and first_bet is not None:
        try:
            got = round(float(first_bet) / divisor, 2)
            out.append({"check": "wager_matches_playcheck", "passed": abs(got - float(expected_wager)) < 0.005,
                        "message": f"first MV/{divisor:g} = {got:.2f} vs PlayCheck WAGERED {float(expected_wager):.2f}"})
        except ValueError:
            out.append({"check": "wager_matches_playcheck", "passed": False, "message": f"MV not numeric: {first_bet}"})
    if game_win is not None:
        gw = float(game_win)
        ok = abs(total_win - gw) < 0.005 or abs(total_win / divisor - gw) < 0.005
        out.append({"check": "payout_matches_game", "passed": ok,
                    "message": f"sum(MG) = {total_win:g} vs game financials.win {gw:g}"})
    return out


def _render_html(game_title: str, game_code: str, spins: list[dict], total_win: float,
                 findings: list[dict], warnings: list[str], generated_at: str,
                 hard_checks: list[dict], source: dict) -> str:
    e = html.escape
    by_spin: dict[str, list[dict]] = {}
    for f in findings:
        by_spin.setdefault(str(f["spin"]), []).append(f)

    cards: list[str] = []
    for s in spins:
        rows_html = "".join(
            "<tr><th>Row %d</th>%s</tr>" % (i, "".join(f"<td>{e(c)}</td>" for c in row))
            for i, row in enumerate(s["ROWS"], 1)
        )
        wins = list(zip(s["WINNING_SYM"], s["WINNING_POS"]))
        n = max(len(wins), len(s["BETS"]), len(s["MULTIPLIERS"]), len(s["WIN_AMOUNTS"]))
        win_rows = ""
        for i in range(n):
            sym, pos = wins[i] if i < len(wins) else ("", "")
            bet = s["BETS"][i] if i < len(s["BETS"]) else ""
            mult = s["MULTIPLIERS"][i] if i < len(s["MULTIPLIERS"]) else ""
            amt = f"${s['WIN_AMOUNTS'][i]:.2f}" if i < len(s["WIN_AMOUNTS"]) else ""
            win_rows += f"<tr><td>{e(sym)}</td><td>{e(pos)}</td><td>{e(bet)}</td><td>{e(mult)}</td><td>{e(amt)}</td></tr>"
        spin_total = sum(s["WIN_AMOUNTS"])
        flags = "".join(f"<li>{e(f['check'])}: {e(f['message'])}</li>" for f in by_spin.get(str(s["SPIN"]), []))
        cards.append(f"""
<section class="spin{' flagged' if flags else ''}">
  <h2>SPIN {e(str(s['SPIN']))} <span class="amt">${spin_total:.2f}</span></h2>
  <table class="grid">{rows_html}</table>
  {'<table class="wins"><tr><th>Symbol</th><th>Position</th><th>Bet</th><th>Multiplier</th><th>Amount</th></tr>' + win_rows + '</table>' if n else '<p class="muted">No winning lines</p>'}
  {'<ul class="flags">' + flags + '</ul>' if flags else ''}
</section>""")

    warn_html = "".join(f"<li>{e(w)}</li>" for w in warnings)
    checks_html = "".join(
        f"<li class=\"{'ok' if c['passed'] else 'bad'}\">{'PASS' if c['passed'] else 'FAIL'} · {e(c['check'])}: {e(c['message'])}</li>"
        for c in hard_checks)
    src_html = " · ".join(f"{e(k)} {e(str(v))}" for k, v in source.items() if v not in (None, ""))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portugal Plugin Report {e(game_code)}</title>
<style>
body{{font-family:system-ui,Segoe UI,sans-serif;margin:24px;background:#0f1115;color:#e6e6e6}}
h1{{font-size:20px}} h2{{font-size:15px;margin:0 0 8px}} .muted{{color:#8a8f98}}
.summary{{display:flex;gap:24px;margin:12px 0 20px}} .summary div{{background:#181b22;padding:10px 14px;border-radius:8px}}
.summary b{{display:block;font-size:18px}}
.spin{{background:#181b22;border:1px solid #262a33;border-radius:8px;padding:12px 14px;margin-bottom:12px}}
.spin.flagged{{border-color:#a86b1a}} .amt{{float:right;color:#6fcf97}}
table{{border-collapse:collapse;margin:6px 0}} td,th{{border:1px solid #2c313c;padding:3px 8px;font-size:13px;text-align:left}}
th{{color:#8a8f98;font-weight:500}} .flags{{color:#f2b56b;font-size:13px;margin:6px 0 0}}
.checks{{font-size:13px}} .ok{{color:#6fcf97}} .bad{{color:#eb5757}}
</style></head><body>
<h1>{e(game_title)} — Portugal Plugin Verification</h1>
<p class="muted">Generated {e(generated_at)} · game code {e(game_code)}{(' · ' + src_html) if src_html else ''}</p>
<div class="summary">
  <div>Total Win Amount<b>{total_win:.2f}</b></div>
  <div>Spins<b>{len(spins)}</b></div>
  <div>Advisory findings<b>{len(findings)}</b></div>
  <div>Parse warnings<b>{len(warnings)}</b></div>
</div>
{'<h2>PlayCheck checks</h2><ul class="checks">' + checks_html + '</ul>' if hard_checks else ''}
{'<h2>Parse warnings</h2><ul class="flags">' + warn_html + '</ul>' if warnings else ''}
{''.join(cards)}
</body></html>"""


class PortugalPluginReporterTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="portugal_plugin_reporter",
            description=(
                "Runs advisory consistency checks on portugal_plugin_parser output (unmapped symbols, row width, "
                "R/MV/MT/MG count mismatch) and writes TXT (identical to ppvACCR1.0 output), JSON and HTML reports."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="spins", type="array", required=True,
                              description="portugal_plugin_parser content.spins"),
                ToolParameter(name="total_win", type="number", required=True,
                              description="portugal_plugin_parser content.total_win"),
                ToolParameter(name="symbol_map", type="object", required=True,
                              description="portugal_plugin_parser content.symbol_map"),
                ToolParameter(name="game_code", type="string", default="ACCR",
                              description="Game code, used in report file names"),
                ToolParameter(name="game_title", type="string",
                              description="Game display name for the HTML report"),
                ToolParameter(name="warnings", type="array",
                              description="portugal_plugin_parser content.warnings"),
                ToolParameter(name="expected_payout", type="number",
                              description="PlayCheck PAYOUT of the transaction (fetched mode)"),
                ToolParameter(name="expected_wager", type="number",
                              description="PlayCheck WAGERED of the transaction (fetched mode)"),
                ToolParameter(name="game_win", type="number",
                              description="financials.win captured from the game response (fetched mode)"),
                ToolParameter(name="money_divisor", type="number", default=100,
                              description="MG/MV minor units per currency unit"),
                ToolParameter(name="source", type="object",
                              description="Where the outcome came from (session/transaction), shown in the report"),
            ]),
            permissions=["filesystem:write"],
            timeout_seconds=30,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        spins: list[dict] = params["spins"] if isinstance(params["spins"], list) else json.loads(params["spins"])
        if not spins:
            return ToolResult(success=False, error="no_spins: nothing to report")
        symbol_map: dict[str, str] = params["symbol_map"] or {}
        total_win = float(params["total_win"])
        game_code = str(params.get("game_code") or "ACCR").upper()
        game_title = str(params.get("game_title") or game_code)
        warnings = list(params.get("warnings") or [])

        findings = check_spins(spins, symbol_map)
        hard_checks = check_against_playcheck(
            spins, total_win, float(params.get("money_divisor") or 100),
            params.get("expected_payout"), params.get("expected_wager"), params.get("game_win"))
        source = params.get("source") or {}
        failed = [c for c in hard_checks if not c["passed"]]
        generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        text = format_report(spins, total_win)

        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        stem = f"portugal_plugin_{game_code}_{ctx.execution_id}"
        txt_path = ARTIFACTS_DIR / f"{stem}.txt"
        json_path = ARTIFACTS_DIR / f"{stem}.json"
        html_path = ARTIFACTS_DIR / f"{stem}.html"

        txt_path.write_text(text, encoding="utf-8")
        json_path.write_text(json.dumps({
            "generated_at": generated_at, "execution_id": ctx.execution_id,
            "game_code": game_code, "game_title": game_title,
            "total_win": round(total_win, 2), "spin_count": len(spins),
            "spins": spins, "findings": findings, "warnings": warnings,
            "playcheck_checks": hard_checks, "source": source,
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        html_path.write_text(
            _render_html(game_title, game_code, spins, total_win, findings, warnings, generated_at,
                         hard_checks, source),
            encoding="utf-8",
        )

        base = "/api/records/artifacts/"
        return ToolResult(
            success=True,
            content={
                "game_code": game_code,
                "spin_count": len(spins),
                "total_win": round(total_win, 2),
                "findings": findings,
                "finding_count": len(findings),
                "warning_count": len(warnings),
                "playcheck_checks": hard_checks,
                "verdict": "FAIL" if failed else ("CLEAN" if not findings and not warnings else "REVIEW"),
                "txt_url": base + txt_path.name,
                "json_url": base + json_path.name,
                "html_url": base + html_path.name,
            },
            artifacts=[str(p.resolve()) for p in (txt_path, json_path, html_path)],
        )
