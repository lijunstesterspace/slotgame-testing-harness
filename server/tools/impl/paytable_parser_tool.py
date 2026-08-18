from __future__ import annotations
import re
from typing import Any
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)

class PaytableParserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="paytable_parser",
            description="Parses raw Google Sheets / CSV / pasted paytable text with case names, Bet Lines ID blocks, and (batch,index) pairs. Emits structured records + fileMap grouped by game prefix.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="raw_text", type="string", required=True,
                              description="Raw pasted paytable text. May contain headers like '[File]', 'Bet Lines ID' lines, tab-separated case + batch,index rows."),
                ToolParameter(name="game_prefix", type="string", default="P5P",
                              description="File name prefix, e.g. 'P5P_' or 'YGG_'"),
                ToolParameter(name="default_module_id", type="string", default="105359",
                              description="Fallback Module ID if none found via regex Module ID xxx in raw_text."),
            ]),
            permissions=["parse:text"],
            timeout_seconds=15,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw: str = params["raw_text"]
        prefix: str = params["game_prefix"]
        default_module: str = str(params["default_module_id"])

        m = re.search(r"Module\s*ID\s*#?:?\s*(\d+)", raw, re.I)
        module_id = m.group(1) if m else default_module

        records: list[dict] = []
        file_map: dict[str, list[dict]] = {}
        counter = 0
        lines = raw.splitlines()
        in_bet = False

        def _group_file(name: str) -> str:
            lname = name.lower()
            if any(k in lname for k in ["micro win", "small win", "medium win", "large win"]):
                return f"{prefix}_Base game_Regular Wins.testdata"
            if any(k in lname for k in ["big win", "mega win", "epic win", "super win"]):
                return f"{prefix}_Base game_Big Wins.testdata"
            return f"{prefix}_{name}.testdata"

        def _add_rec(scenario: str, bb: int, bi: int, bonus_batch: int | None, bonus_index: int | None, filename: str):
            nonlocal counter
            counter += 1
            is_double = bonus_batch is not None and bonus_index is not None
            if is_double:
                xml = (
                    f'<Spin stage="BaseGame" comment="{scenario}">\n'
                    f'  <PreGen batch="{bb}" index="{bi}" />\n'
                    f'  <Feature stage="Bonus">\n'
                    f'    <PreGen batch="{bonus_batch}" index="{bonus_index}" />\n'
                    f'  </Feature>\n</Spin>'
                )
            else:
                xml = (
                    f'<Spin stage="BaseGame" comment="{scenario}">\n'
                    f'  <PreGen batch="{bb}" index="{bi}" />\n</Spin>'
                )
            rec = {
                "id": f"TR-{counter:03d}",
                "case_name": scenario,
                "format_type": "DOUBLE_PREGEN" if is_double else "SINGLE",
                "module_id": module_id,
                "stage": "BaseGame",
                "comment": scenario,
                "base_batch": int(bb), "base_index": int(bi),
                "bonus_batch": bonus_batch, "bonus_index": bonus_index,
                "file_name": filename,
                "game_prefix": prefix,
                "xml_snippet": xml,
            }
            records.append(rec)
            file_map.setdefault(filename, []).append(rec)

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if "bet lines id" in line.lower():
                in_bet = True
                continue
            if in_bet:
                bm = re.match(r"^(\d+)\s+(\d+)\s*,\s*(\d+)", line)
                if bm:
                    line_num, bb, bi = bm.group(1), int(bm.group(2)), int(bm.group(3))
                    fname = f"{prefix}_Base game_Betlines.testdata"
                    _add_rec(f"BetLine Line {line_num}", bb, bi, None, None, fname)
                    continue
            parts = [p.strip() for p in re.split(r"\t| {2,}", line) if p.strip()]
            if len(parts) >= 2:
                scenario = parts[0]
                base_str = parts[1]
                bonus_str = parts[2] if len(parts) >= 3 else ""
            else:
                m2 = re.match(r"^(.+?)\s+(\d+[\s,]+\d+)(?:\s+(\d+[\s,]+\d+))?$", line)
                if not m2:
                    continue
                scenario, base_str, bonus_str = m2.group(1).strip(), m2.group(2).strip(), m2.group(3) or ""
            if not scenario or not base_str or not any(c.isalpha() for c in scenario):
                continue
            bm1 = re.match(r"(\d+)\s*[, ]\s*(\d+)", base_str)
            if not bm1:
                continue
            bb, bi = int(bm1.group(1)), int(bm1.group(2))
            bb2 = bi2 = None
            if bonus_str:
                bm2 = re.match(r"(\d+)\s*[, ]\s*(\d+)", bonus_str)
                if bm2:
                    bb2, bi2 = int(bm2.group(1)), int(bm2.group(2))
            fname = _group_file(scenario)
            _add_rec(scenario, bb, bi, bb2, bi2, fname)

        # Fallback: empty → default P5P minimal suite
        if not records:
            default_cases = [
                ("micro win", 1, 10, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Small win", 1, 17, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Medium win", 2, 2, None, None, f"{prefix}_Base game_Regular Wins.testdata"),
                ("Bonus Feature_MINI Prize", 58, 3, 2, 67933, f"{prefix}_Bonus Feature_MINI Prize.testdata"),
                ("Bonus Feature_MINOR Prize", 58, 3, 4, 145, f"{prefix}_Bonus Feature_MINOR Prize.testdata"),
            ]
            for c in default_cases:
                _add_rec(c[0], c[1], c[2], c[3], c[4], c[5])

        return ToolResult(
            success=True,
            content={
                "module_id": module_id,
                "game_prefix": prefix,
                "total_records": len(records),
                "file_count": len(file_map),
                "file_list": sorted(file_map.keys()),
                "records": records,
            },
        )
