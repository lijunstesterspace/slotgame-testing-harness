from __future__ import annotations
import json
from pathlib import Path
import sys
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)

# ROOT_DIR from server package if available; fallback below
try:
    from server import ROOT_DIR  # will be defined in server/__init__.py next Task
    from server.config import ROOT_DIR as _ROOT
except Exception:
    _ROOT = Path(__file__).resolve().parents[3]

VERIFY_SCRIPT = _ROOT / "verify_testdata.py"


class GameVerifierTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="game_verifier",
            description="Runs verify_testdata.py (Selenium + Chrome) against a .testdata file and a real game URL. Returns parsed HTML report path + parsed per-case results.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="testdata_file", type="string", required=True,
                              description="Absolute path to .testdata file (from testdata_generator output)."),
                ToolParameter(name="target_url", type="string", required=True,
                              description="Real game environment URL (http/https)."),
                ToolParameter(name="auto_spin", type="boolean", default=True),
                ToolParameter(name="spin_delay_sec", type="number", default=5.0),
                ToolParameter(name="output_report", type="string", default="",
                              description="Optional absolute HTML report output path. Defaults to <work_dir>/report.html."),
            ]),
            permissions=["filesystem:write", "selenium", "network:outbound"],
            timeout_seconds=900,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from server.infra import process_runner
        from server.infra.logger import log

        testdata_file = Path(params["testdata_file"])
        if not testdata_file.exists():
            return ToolResult(success=False, error=f"testdata_file_not_found:{testdata_file}")
        target_url: str = params["target_url"]
        auto_spin: bool = bool(params["auto_spin"])
        spin_delay: float = float(params["spin_delay_sec"])
        output = Path(params["output_report"]) if params.get("output_report") else (Path(ctx.work_dir) / "report.html")
        output.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable, str(VERIFY_SCRIPT),
            "-f", str(testdata_file),
            "-u", target_url,
            "-o", str(output),
        ]
        if auto_spin:
            cmd += ["--auto-spin", "--spin-delay", str(spin_delay)]

        stdout_lines: list[str] = []
        def _on_stdout(line: str):
            stdout_lines.append(line)
            log.info("verify.stdout", line=line)

        completed = await process_runner.run(cmd, Path(ctx.work_dir), timeout_sec=self.info.timeout_seconds,
                                              on_stdout=_on_stdout)
        artifacts: list[str] = []
        if output.exists():
            artifacts.append(str(output.resolve()))
        screenshots_dir = Path(ctx.work_dir) / "screenshots"
        if screenshots_dir.exists():
            for p in screenshots_dir.glob("*.png"):
                artifacts.append(str(p.resolve()))
        parsed_cases = self._parse_stdout(stdout_lines)
        success = completed.returncode == 0 and output.exists()
        return ToolResult(
            success=success,
            error=(None if success else (completed.stderr.splitlines()[-1] if completed.stderr else f"exit_code:{completed.returncode}")),
            content={
                "stdout_tail": stdout_lines[-40:],
                "exit_code": completed.returncode,
                "timed_out": completed.timed_out,
                "report_html": str(output),
                "parsed_cases": parsed_cases,
            },
            execution_ms=completed.execution_ms,
            artifacts=artifacts,
        )

    @staticmethod
    def _parse_stdout(lines: list[str]) -> list[dict]:
        """Best-effort parse PASS/FAIL lines from verify_testdata stdout."""
        out: list[dict] = []
        for l in lines:
            m = __import__("re").match(r".*?\[(\d+)/(\d+)\].*\[(PASS|FAIL|ERROR)\].*batch[: ]+(\d+).*index[: ]+(\d+)", l)
            if m:
                out.append({"idx": int(m.group(1)), "total": int(m.group(2)),
                            "status": m.group(3), "batch": int(m.group(4)), "index": int(m.group(5))})
        return out
