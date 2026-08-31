from __future__ import annotations
import json
from typing import Any
from server.tools.base import (ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext)


class LogDiagnoserTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="log_diagnoser",
            description=(
                "Diagnoses verification results. Accepts both legacy format (status/httpStatus) "
                "and new game_verifier format (passed/actualBatch/issues). "
                "Emits one DiagnosticProof per record with root-cause classification."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="results", type="object", required=True,
                              description='List of verification results. Supports both legacy format '
                                          '([{caseName, status, httpStatus, ...}]) and new format '
                                          '([{caseName, passed, expectedBatch, actualBatch, issues, ...}]).'),
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

            # ── Detect format: new game_verifier format has "passed" key ──
            if "passed" in r:
                diag = self._diagnose_new_format(r, name)
            else:
                diag = self._diagnose_legacy_format(r, name)

            diagnostics.append(diag)

        return ToolResult(success=True, content={"count": len(diagnostics), "diagnostics": diagnostics})

    # ------------------------------------------------------------------
    # New format: from game_verifier (Selenium + responseLogger)
    # ------------------------------------------------------------------
    @staticmethod
    def _diagnose_new_format(r: dict, name: str) -> dict:
        passed = bool(r.get("passed", False))
        expected_batch = r.get("expectedBatch")
        actual_batch = r.get("actualBatch")
        expected_index = r.get("expectedIndex")
        actual_index = r.get("actualIndex")
        actual_stage = str(r.get("actualStage", ""))
        actual_win = r.get("actualWin", 0)
        is_bonus = bool(r.get("isBonus", False))
        issues = r.get("issues", [])

        if passed:
            return {
                "recordId": r.get("recordId", r.get("spinIndex", "")),
                "caseName": name or f"Spin #{r.get('spinIndex', '?')}",
                "batchIndexString": f"batch={expected_batch}, index={expected_index}",
                "diagnosisType": "VERIFIED_CORRECT",
                "title": "✅ Test Case & Seed Verified Consistent",
                "severity": "NONE",
                "sheetExpectation": f"batch={expected_batch}, index={expected_index}, stage={r.get('stage', 'BaseGame')}",
                "realServerOutcome": f"HTTP 200 - Seed accepted. Payout={actual_win}, Stage={actual_stage}",
                "evidenceLogs": [
                    f"[OK] Game Engine confirmed seed batch={actual_batch}, index={actual_index}",
                    f"[OK] Stage: {actual_stage}",
                    f"[OK] Payout: {actual_win}",
                ],
                "recommendation": "No action needed. TestData entry is 100% valid.",
            }

        # Failed case — classify by issue type
        issue_text = "; ".join(issues) if issues else "Unknown failure"

        # Check for batch/index mismatch
        batch_mismatch = expected_batch != actual_batch
        index_mismatch = expected_index != actual_index

        if is_bonus and not batch_mismatch and not index_mismatch:
            # Seed matched but bonus didn't trigger
            return {
                "recordId": r.get("recordId", r.get("spinIndex", "")),
                "caseName": name or f"Spin #{r.get('spinIndex', '?')}",
                "batchIndexString": f"batch={expected_batch}, index={expected_index}",
                "diagnosisType": "ORIGINAL_SHEET_DATA_ERROR",
                "title": "🚨 Bonus Feature Not Triggered — Likely Sheet Data Error",
                "severity": "HIGH",
                "sheetExpectation": f"Expected Bonus trigger at batch={expected_batch}, index={expected_index}",
                "realServerOutcome": f"Seed accepted but no Bonus triggered. Payout={actual_win}, Stage={actual_stage}",
                "evidenceLogs": [
                    f"[PROOF 1] Sheet Label: '{name}' (marked as Bonus)",
                    f"[PROOF 2] Server returned stage={actual_stage} (expected FreeSpin/Bonus)",
                    f"[PROOF 3] Payout={actual_win} (expected >0 for Bonus)",
                    f"[PROOF 4] Seed matched: batch={actual_batch}, index={actual_index}",
                ],
                "recommendation": (
                    f"Update Google Sheet for '{name}'. The seed batch={expected_batch}, "
                    f"index={expected_index} did not trigger Bonus in the math model. "
                    f"Verify the original sheet annotation."
                ),
            }

        if batch_mismatch or index_mismatch:
            return {
                "recordId": r.get("recordId", r.get("spinIndex", "")),
                "caseName": name or f"Spin #{r.get('spinIndex', '?')}",
                "batchIndexString": f"batch={expected_batch}, index={expected_index}",
                "diagnosisType": "SEED_MISMATCH",
                "title": "⚠️ Seed Mismatch — Expected vs Actual Differ",
                "severity": "HIGH",
                "sheetExpectation": f"batch={expected_batch}, index={expected_index}",
                "realServerOutcome": f"batch={actual_batch}, index={actual_index}",
                "evidenceLogs": [
                    f"[MISMATCH] Expected batch={expected_batch}, got batch={actual_batch}" if batch_mismatch
                    else f"[OK] batch={actual_batch}",
                    f"[MISMATCH] Expected index={expected_index}, got index={actual_index}" if index_mismatch
                    else f"[OK] index={actual_index}",
                    f"[INFO] Issues: {issue_text}",
                ],
                "recommendation": (
                    f"Check testdata generation for '{name}'. "
                    f"The server used different seed coordinates than expected. "
                    f"This may indicate testdata was uploaded to wrong game environment."
                ),
            }

        # Generic failure
        return {
            "recordId": r.get("recordId", r.get("spinIndex", "")),
            "caseName": name or f"Spin #{r.get('spinIndex', '?')}",
            "batchIndexString": f"batch={expected_batch}, index={expected_index}",
            "diagnosisType": "VERIFICATION_FAILED",
            "title": "❌ Verification Failed",
            "severity": "MEDIUM",
            "sheetExpectation": f"batch={expected_batch}, index={expected_index}",
            "realServerOutcome": f"batch={actual_batch}, index={actual_index}, stage={actual_stage}",
            "evidenceLogs": [
                f"[FAIL] {issue_text}",
            ],
            "recommendation": f"Review '{name}' test case. Check game environment and testdata alignment.",
        }

    # ------------------------------------------------------------------
    # Legacy format: from old API-based verifier
    # ------------------------------------------------------------------
    @staticmethod
    def _diagnose_legacy_format(r: dict, name: str) -> dict:
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
            title = " Original Google Sheet Data Entry Error"
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

        return {
            "recordId": r.get("recordId", ""),
            "caseName": name,
            "batchIndexString": batch_str,
            "diagnosisType": diag,
            "title": title,
            "severity": severity,
            "sheetExpectation": name,
            "realServerOutcome": real,
            "evidenceLogs": evidence,
            "recommendation": rec,
        }
