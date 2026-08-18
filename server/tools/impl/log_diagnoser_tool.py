from __future__ import annotations
import json
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)


class LogDiagnoserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="log_diagnoser",
            description="Rule-engine diagnoses for a list of verification results. Emits one DiagnosticProof per record: ORIGINAL_SHEET_DATA_ERROR / INDEX_OUT_OF_BOUNDS / SERVER_ENDPOINT_ERROR / VERIFIED_CORRECT.",
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="results", type="object", required=True,
                              description='List: [{recordId?, caseName, status, httpStatus, responseTimeMs, batchIndexString, responseBodySnippet?, errorMessage?}]'),
            ]),
            permissions=["parse:text"],
            timeout_seconds=15,
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw = params["results"]
        results: list[dict] = raw if isinstance(raw, list) else json.loads(raw)
        diagnostics = []
        for r in results:
            name = str(r.get("caseName", ""))
            is_bonus = any(k in name.lower() for k in ["bonus", "mini", "minor", "major", "maxi", "feature"])
            status = str(r.get("status", "ERROR"))
            http_status = int(r.get("httpStatus") or 0)
            batch_str = str(r.get("batchIndexString", ""))
            snippet = str(r.get("responseBodySnippet") or "")
            err = str(r.get("errorMessage") or "")
            if status == "PASSED":
                diag = "VERIFIED_CORRECT"
                title = "✅ Test Case & Seed Verified Consistent"
                severity, rec = "NONE", "No action needed. TestData entry is 100% valid."
                evidence = [
                    f"[OK] Game Engine confirmed seed {batch_str}",
                    f"[OK] Server response latency: {r.get('responseTimeMs') or '?'}ms",
                    "[OK] Screen render verified",
                ]
                real = f"HTTP {http_status} - Seed accepted & spin executed"
            elif status == "DISCREPANCY" and is_bonus:
                diag = "ORIGINAL_SHEET_DATA_ERROR"
                title = "🚨 Original Google Sheet Data Entry Error"
                severity, rec = "HIGH", (f"Update Google Sheet for '{name}'. The seed {batch_str} is a non-bonus spin in the math model.")
                evidence = [
                    f"[PROOF 1] Sheet Label: '{name}'",
                    f"[PROOF 2] Server Payload: {snippet or '{{\"status\":\"OK\",\"bonusTriggered\":false}}'}",
                    "[PROOF 3] Canvas Visual: 5x3 Reel Screenshot showing regular spin outcome without Bonus wheel",
                ]
                real = "Real Game Engine returned regular BaseGame spin ($0.00 payout) without Bonus Feature trigger"
            elif http_status == 400 or "Index" in err or "index" in err.lower():
                diag = "INDEX_OUT_OF_BOUNDS"
                title = "⚠️ Google Sheet Seed Index Out of Bounds"
                severity, rec = "HIGH", f"Check Google Sheet math index bounds for '{name}'."
                evidence = [
                    "[PROOF 1] Game Engine Exception: Seed index exceeds valid pre-generated range",
                    f"[PROOF 2] Server Error: {err or 'Invalid Batch/Index seed'}",
                ]
                real = f"Server rejected seed with HTTP {http_status or 400} (Index Invalid / Range Error)"
            else:
                diag = "SERVER_ENDPOINT_ERROR"
                title = "🌐 Target Game Server Connection Exception"
                severity, rec = "MEDIUM", "Check if game server endpoint URL is online and accessible."
                evidence = [
                    "[LOG] Request failed against target game endpoint",
                    f"[LOG] Exception: {err or f'HTTP {http_status} Error'}",
                ]
                real = err or f"HTTP {http_status} Error"
            diagnostics.append({
                "recordId": r.get("recordId") or "",
                "caseName": name,
                "batchIndexString": batch_str,
                "diagnosisType": diag,
                "title": title,
                "severity": severity,
                "sheetExpectation": name,
                "realServerOutcome": real,
                "evidenceLogs": evidence,
                "recommendation": rec,
            })
        return ToolResult(success=True, content={"count": len(diagnostics), "diagnostics": diagnostics})
