"""Plugin: portugal_plugin_parser — 解析 Portugal Plugin 输出字符串 → 结构化 SPIN 数据

Ported from the standalone Tk tool `portugal-playcheck-plugin/ppvACCR1.0.py`
("Amazing Catch Cold Rush Portugal Plugin Verification Tool v1.0"). The parsing rules and the
formatted text report are kept byte-for-byte identical to that tool, so QA can cross-check the
Harness output against the old exe.

Input format example:
    1:A;B#C;D#E;F#R#A#POS1#MV#10#MT#2#MG#5.0 2:...
      - `N:`            SPIN number, starts a new spin
      - `X;Y;Z` blocks  one reel row each (letters are mapped to SYMn via the game profile)
      - `R#<sym>#<pos>` winning symbol + position
      - `MV#<v>`        bet
      - `MT#<v>`        multiplier
      - `MG#<v>`        win amount (summed into the total win)
"""
from __future__ import annotations
import re
from typing import Any

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)

# ── Game profiles (letter → SYM mapping) ─────────────────────────────
# Every ppv*.py tool in portugal-playcheck-plugin differed only in its LETTER_TO_SYM table. Those
# tables now live in symbol_profiles/<GAME>.json (imported from the backend team's Google Doc via
# portugal_plugin_symbol_map, stage 0 of the pipeline); ACCR / RAW stay built in. See server/tools/impl/symbol_profiles.py.
from server.tools.impl import symbol_profiles
from server.tools.impl.symbol_profiles import profile_for  # noqa: F401  (re-exported)

PARAM_MARKERS = {'R', 'MV', 'MT', 'MG'}
SPIN_PATTERN = re.compile(r'(\d+):(.*?)(?=\s*\d+:|$)', re.DOTALL)


def replace_with_sym(letter: str, mapping: dict[str, str]) -> str:
    """Replace a letter with its SYM value; unmapped values pass through unchanged."""
    return mapping.get(letter.upper(), letter)


def parse_portugal_plugin(input_str: str, mapping: dict[str, str]) -> tuple[list[dict], float, list[str]]:
    """Same rules as ppvACCR1.0.py's parse_string(); parameter errors are collected as warnings
    instead of printed. Returns (spins, total_win, warnings)."""
    result: list[dict] = []
    warnings: list[str] = []
    total_win = 0.0

    for spin_num, spin_content in SPIN_PATTERN.findall(input_str):
        spin: dict[str, Any] = {
            'SPIN': spin_num.strip(),
            'ROWS': [],
            'WINNING_SYM': [],
            'WINNING_POS': [],
            'BETS': [],
            'MULTIPLIERS': [],
            'WIN_AMOUNTS': [],
        }

        cleaned = spin_content.replace('\n', '').strip()
        if not cleaned:
            continue

        all_parts = [p.strip() for p in cleaned.split('#') if p.strip()]
        param_start = next((i for i, p in enumerate(all_parts) if p in PARAM_MARKERS), None)

        # Row data: everything before the first parameter marker
        row_data = all_parts[:param_start] if param_start is not None else all_parts
        for row_str in row_data:
            if ';' in row_str:
                spin['ROWS'].append([replace_with_sym(c, mapping) for c in row_str.split(';')])
            else:
                spin['ROWS'].append([replace_with_sym(row_str, mapping)])

        # Parameters
        if param_start is not None:
            params = all_parts[param_start:]
            i = 0
            while i < len(params):
                param = params[i]
                try:
                    if param == 'R' and i + 2 < len(params):
                        spin['WINNING_SYM'].append(replace_with_sym(params[i + 1], mapping))
                        spin['WINNING_POS'].append(params[i + 2])
                        i += 2
                    elif param == 'MV' and i + 1 < len(params):
                        spin['BETS'].append(params[i + 1])
                        i += 1
                    elif param == 'MT' and i + 1 < len(params):
                        spin['MULTIPLIERS'].append(params[i + 1])
                        i += 1
                    elif param == 'MG' and i + 1 < len(params):
                        amount = float(params[i + 1])
                        spin['WIN_AMOUNTS'].append(amount)
                        total_win += amount
                        i += 1
                except (IndexError, ValueError) as e:
                    warnings.append(f"SPIN {spin['SPIN']}: Parameter parsing error: {e}")
                finally:
                    i += 1

        result.append(spin)

    return result, total_win, warnings


def format_report(spins: list[dict], total_win: float) -> str:
    """Render the exact text the Tk tool shows in its "Parsed Results" box."""
    out: list[str] = [f"Total Win Amount: {total_win:.2f}\n", "=" * 50 + "\n"]
    for spin in spins:
        out.append(f"SPIN {spin['SPIN']}\n")
        for row_idx, row in enumerate(spin['ROWS'], 1):
            out.append(f"Row {row_idx}: {' | '.join(row)}\n")
        out.append("-" * 50 + "\n")
        if spin['WINNING_SYM']:
            out.append(f"Winning Symbols: {', '.join(spin['WINNING_SYM'])}\n")
        if spin['WINNING_POS']:
            out.append(f"Positions: {', '.join(spin['WINNING_POS'])}\n")
        if spin['BETS']:
            out.append(f"Bets: {', '.join(spin['BETS'])}\n")
        if spin['MULTIPLIERS']:
            out.append(f"Multipliers: {', '.join(spin['MULTIPLIERS'])}\n")
        if spin['WIN_AMOUNTS']:
            out.append(f"Amounts: {', '.join(f'${x:.2f}' for x in spin['WIN_AMOUNTS'])}\n")
        out.append("-" * 50 + "\n")
    return "".join(out)


def resolve_symbol_map(game_code: str, override: Any) -> tuple[dict[str, str] | None, str]:
    """Profile map merged with an optional per-call override. Returns (map, error)."""
    profiles = symbol_profiles.load_all()
    profile = profiles.get(game_code.upper())
    if profile is None and not override:
        return None, f"unknown_game_code:{game_code} (known: {', '.join(profiles)}; or pass symbol_map)"
    mapping = dict(profile["symbol_map"]) if profile else {}
    if override:
        if not isinstance(override, dict):
            return None, "symbol_map_must_be_object"
        mapping.update({str(k).upper(): str(v) for k, v in override.items()})
    return mapping, ""


class PortugalPluginParserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="portugal_plugin_parser",
            description=(
                "Parses a Portugal Plugin output string (e.g. '1:A;B#C;D#R#A#POS1#MV#10#MT#2#MG#5.0') "
                "into structured spins: reel rows mapped to SYM names, winning symbols/positions, bets, "
                "multipliers and win amounts, plus the total win and the same text report as ppvACCR1.0."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(
                    name="raw_text", type="string", required=True,
                    description="Portugal Plugin output string; one or more 'N:...' spin blocks",
                ),
                ToolParameter(
                    name="game_code", type="string",
                    description="Game profile (symbol_profiles/<code>.json, or built-in ACCR/RAW); default: by module_id, else ACCR",
                ),
                ToolParameter(
                    name="module_id", type="string",
                    description="Game module id (from portugal_plugin_fetcher) used to pick the profile",
                ),
                ToolParameter(
                    name="symbol_map", type="object",
                    description="Optional letter → SYM overrides merged on top of the game profile",
                ),
            ]),
            permissions=[],
            timeout_seconds=30,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw_text = str(params.get("raw_text") or "").strip()
        if not raw_text:
            return ToolResult(success=False, error="empty_input: Please input valid data")

        game_code = profile_for(params.get("game_code"), params.get("module_id"))
        mapping, err = resolve_symbol_map(game_code, params.get("symbol_map"))
        if mapping is None:
            return ToolResult(success=False, error=err)

        spins, total_win, warnings = parse_portugal_plugin(raw_text, mapping)
        if not spins:
            return ToolResult(success=False, error="no_spins_found: expected one or more 'N:...' spin blocks")

        return ToolResult(
            success=True,
            content={
                "game_code": game_code,
                "game_title": (symbol_profiles.get(game_code) or {}).get("title", game_code),
                "symbol_map": mapping,
                "spins": spins,
                "spin_count": len(spins),
                "total_win": round(total_win, 2),
                "warnings": warnings,
                "formatted_text": format_report(spins, total_win),
            },
        )
