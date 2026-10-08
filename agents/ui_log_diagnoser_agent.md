# AGENT: Visual UI & Log Diagnosis Agent

## ⚠️ Execution Model (read this first)

This file is loaded as **domain-reference context** for the `log_diagnosis` scenario (and the
`diagnose` step of `game-verify-pipeline`). It is **not** an autonomous multi-step executor.

The `log-diagnose-pipeline` (see `src/harness/pipelineRegistry.ts`) is a single fixed step:

```
diagnose (log_diagnoser)
```

`ExecutionEngine` calls the `log_diagnoser` Plugin directly; the AI never decides whether to run
it, and never inspects the verification results itself to produce the root-cause classification.
Every diagnostic rule below (batch/index mismatch, out-of-bounds index, client-render bugs, etc.)
is implemented as **deterministic code** inside `server/tools/impl/log_diagnoser_tool.py`. They
are documented here for engineers maintaining that Plugin, not as instructions for a model to
follow at runtime.

## AI Responsibility (narrowed, per design doc §1.2 / §10.7 / §11)

For this scenario, the AI is invoked for exactly one thing:

- **Analysis-report generation**: turning the `log_diagnoser` Plugin's structured
  `DiagnosticProof` array into a short, plain-language root-cause summary a QA engineer can read
  at a glance (e.g. "3 of 6 failures trace back to Google Sheet seed errors; 1 is a client render
  bug — see step detail for the exact rows").

It never classifies a failure's root cause itself — that classification (`ORIGINAL_SHEET_DATA_ERROR`,
`INDEX_OUT_OF_BOUNDS`, `CLIENT_RENDER_BUG`, ...) is 100% code, and the classification result is
authoritative regardless of whether an AI summary is available.

---

## Domain Reference: Diagnostic Rules (implemented in `log_diagnoser_tool.py`)

When a test case fails or behaves unexpectedly during real-game verification, `log_diagnoser`
builds a complete root-cause attribution proof, e.g.:

```text
[Google Sheet Input]
Case Name: "Bonus Feature_MINI Prize"
Input Seed: Batch 58, Index 3

         ▼ (Dispatch to Game Server)

[Real Game Engine Response & Canvas Screenshot]
Returned Spin Outcome: BaseGame Normal Spin (Payout: $0.00)
Captured Canvas Screen: Regular reel layout, No Bonus Feature triggered

         ▼ (Code-level cross-examination)

[Evidence Proof Report]
Conclusion: 🚨 ORIGINAL GOOGLE SHEET DATA ENTRY ERROR
Proof: Google Sheet entry (58, 3) is labeled as "Bonus Feature_MINI Prize",
       but real Game Server response and screen capture confirm seed (58, 3)
       is a BaseGame 0-payout spin.
Action Item: Correct Google Sheet row 4 to valid Mini Prize seed (e.g. Batch 58, Index 4).
```

### Rule 1: Batch & Index Mismatch Detection (Seed Mismatch Diagnosis)
- **Symptom**: The Google Sheet description says `Bonus Feature` or `High Win`, but the server's response payload or the on-screen visuals show `BaseGame` or a `$0.00` payout.
- **Conclusion**: `ORIGINAL_SHEET_DATA_ERROR` (original sheet data-entry error).

### Rule 2: Out of Bounds Index (Seed Index Out of Range)
- **Symptom**: The server returns HTTP 400 or an `Invalid Index` error.
- **Conclusion**: `INDEX_OUT_OF_BOUNDS` (the Index entered in the sheet exceeds the maximum range of the algorithm library).

### Rule 3: Client / WebGL Rendering Error (Front-End Rendering Error)
- **Symptom**: The server returns a successful payout, but the console throws `WebGL Context Lost` or the screen goes black.
- **Conclusion**: `CLIENT_RENDER_BUG` (front-end client rendering crash, not a sheet data problem).

---

## Diagnostic Report Schema

```json
{
  "recordId": "TR-004",
  "caseName": "Bonus Feature_MINI Prize",
  "inputSeed": { "batch": 58, "index": 3 },
  "diagnosisType": "ORIGINAL_SHEET_DATA_ERROR",
  "severity": "CRITICAL",
  "summary": "Google Sheet batch/index data mismatch",
  "proofDetails": {
    "sheetExpectation": "Bonus Feature_MINI Prize",
    "realServerOutcome": "BaseGame Normal Spin ($0.00)",
    "httpStatus": 200,
    "logEvidence": "[SERVER_RES] seed (58,3) resolved to stage: BaseGame, bonusTriggered: false",
    "visualEvidence": "Canvas screenshot shows 5x3 reels with no Mini Prize overlay"
  },
  "recommendedFix": "Update Google Sheet Row for 'Bonus Feature_MINI Prize' to Batch 58, Index 4."
}
```
