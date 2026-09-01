from __future__ import annotations
import json
from pathlib import Path
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)

def _write_xml(records: list[dict], file_name: str, module_id: str, login_name: str) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             "<Test>",
             f'  <Key moduleID="{module_id}" loginName="{login_name}" />',
             "  <Slot>"]
    for r in records:
        lines.append(f'    <!-- Case: {r["case_name"]} -->')
        if r.get("bonus_batch") is not None:
            lines += [
                '    <Spin stage="BaseGame">',
                f'      <PreGen batch="{r["base_batch"]}" index="{r["base_index"]}"></PreGen>',
                '      <Feature stage="Bonus">',
                f'        <PreGen batch="{r["bonus_batch"]}" index="{r["bonus_index"]}"></PreGen>',
                "      </Feature>",
                "    </Spin>",
            ]
        else:
            lines += [
                f'    <Spin stage="{r.get("stage") or "BaseGame"}" comment="{r.get("comment") or r["case_name"]}">',
                f'      <PreGen batch="{r["base_batch"]}" index="{r["base_index"]}" />',
                "    </Spin>",
            ]
    lines += ["  </Slot>", "</Test>"]
    out_path = Path(file_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return str(out_path.resolve())


class TestdataGeneratorTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="testdata_generator",
            description="Writes a structured list of test records (from testdata_parser) into one or more .testdata XML files, grouped by record.file_name. Returns created file paths.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="records", type="object", required=True,
                              description="Records array from testdata_parser output: [{case_name, format_type, module_id, base_batch, base_index, bonus_batch?, bonus_index?, file_name, xml_snippet}]"),
                ToolParameter(name="login_name", type="string", default="",
                              description="loginName attribute on the output XML <Key> tag."),
            ]),
            permissions=["filesystem:write"],
            timeout_seconds=30,
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        records_raw = params["records"]
        records: list[dict] = records_raw if isinstance(records_raw, list) else json.loads(records_raw)
        login_name: str = str(params.get("login_name") or "")
        work_dir = Path(ctx.work_dir)
        groups: dict[str, list[dict]] = {}
        for r in records:
            fn = r.get("file_name") or ("P5P_Bonus_Feature.testdata" if r.get("bonus_batch") is not None else "P5P_Base_Spins.testdata")
            groups.setdefault(fn, []).append(r)
        artifacts: list[str] = []
        module_id = str(records[0].get("module_id") or "105359") if records else "105359"
        for fn, recs in groups.items():
            out = _write_xml(recs, str(work_dir / fn), module_id, login_name)
            artifacts.append(out)
        return ToolResult(success=True,
                           content={"files": artifacts, "module_id": module_id,
                                    "total_files": len(artifacts), "total_records": sum(len(v) for v in groups.values())},
                           artifacts=artifacts)
