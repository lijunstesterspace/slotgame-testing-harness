# AGENT: Real Game Environment TestData Verifier Agent

## ⚠️ Execution Model (read this first)

This file is loaded as **domain-reference context** for the `game_verification` scenario. It is
**not** an autonomous multi-step executor.

The `game-verify-pipeline` (see `src/harness/pipelineRegistry.ts`) declares the fixed step order:

```
verify (testdata_verifier_harness)  →  diagnose (log_diagnoser)
```

In the current app, the `game_verification` scenario's UI path (`App.tsx: handleStartVerification`)
drives verification directly through `runRealGameVerification` / the backend verifier
Plugins (`server/tools/impl/testdata_verifier_harness_tool.py` / `testdata_verifier_api_tool.py`, sharing `testdata_verify_common.py`) — this is already
code-driven, not AI-driven. The `game-verify-pipeline` declaration above exists so this scenario
can be run through the same `ExecutionEngine` as the other scenarios; either way, the AI never
decides which Plugin runs next, and never issues the spin requests itself. Every rule below
(retry counts, timeout thresholds, SSL/CORS handling, seed-rejection detection, etc.) is
implemented as **deterministic code** inside `testdata_verify_common.py` / the verifier tools. They are documented
here for engineers maintaining that Plugin, not as instructions for a model to follow at runtime.

## AI Responsibility (narrowed, per design doc §1.2 / §10.7 / §11)

For this scenario, the AI is invoked for exactly one thing:

- **Analysis-report generation**: turning the verifier's structured pass/fail result (and, when
  chained, the `log_diagnoser` step's root-cause classification) into a short, plain-language
  summary for the user — never the verification/diagnosis decision itself.

It never dispatches spin requests, never inspects HTTP responses, and never decides pass/fail —
all of that is 100% code, and the verification result is authoritative regardless of whether an
AI summary is available.

---

## Domain Reference: Real Game Environment Verification Protocols (implemented in `testdata_verify_common.py` / the verifier tools)

### Rule 1: Endpoint & Auth Connection
- Verify target URL accessibility. Suppress untrusted SSL warnings if testing against internal staging servers.
- Include optional `Authorization` Bearer token or Game Session ID if required by the game server.

### Rule 2: Payload Construction & Dispatch
- Construct spin API payload for each test record:
  ```json
  {
    "moduleId": "10539",
    "stage": "BaseGame",
    "basePreGen": { "batch": 58, "index": 3 },
    "bonusPreGen": { "batch": 2, "index": 67933 }
  }
  ```
- Respect configured spin delay (default: `500ms`) between API calls to prevent staging rate limits.

### Rule 3: Server Response Assertions & Diagnostic Logs
- **Pass (`PASSED`)**: HTTP 200 OK + Game Engine accepted seed + valid spin response payload returned.
- **Discrepancy (`DISCREPANCY`)**: HTTP 200 OK but server returned an unexpected error message or rejected pregen seed.
- **Error (`ERROR`)**: HTTP 4xx / 5xx error, CORS failure, or timeout > 5000ms.

---

## Domain Reference: Exception Handling & Edge Cases (implemented in `testdata_verify_common.py` / the verifier tools)

### Exception 1: Network Timeout
- **Symptom**: `responseLogger` does not return within the configured timeout (default 5000ms).
- **Handling**:
  1. Retry the same spin once with a doubled timeout (10000ms).
  2. If still timing out, mark as `TIMEOUT` and continue to next record.
  3. If 3 consecutive records timeout → declare environment `UNAVAILABLE`, abort verification, and report.
- **Report entry**: `"issues": ["responseLogger timeout after 5000ms, retry also failed at 10000ms"]`

### Exception 2: SSL Certificate Error
- **Symptom**: Browser shows `NET::ERR_CERT_AUTHORITY_INVALID` or similar SSL warning when navigating to the game URL.
- **Handling**:
  1. For internal staging servers (hostname contains `installprogram.eu`, `staging`, `internal`), automatically accept the certificate via CDP `Security.setIgnoreCertificateErrors`.
  2. For production-like URLs, warn the user and ask for confirmation before proceeding.
  3. If SSL error persists after acceptance, mark as `NETWORK_ERROR` and skip.
- **Report entry**: `"issues": ["SSL certificate error on <domain>, auto-accepted for staging environment"]`

### Exception 3: Game Version Mismatch
- **Symptom**: The game page loads but shows a version number different from expected, or the `moduleId` in the URL does not match the `moduleID` in the `.testdata` XML `<Key>` tag.
- **Handling**:
  1. Extract `moduleId` from URL query params and compare with XML `<Key moduleID="...">`.
  2. If mismatch → flag: `"moduleID mismatch: URL has <url_moduleId>, testdata has <xml_moduleID>. Verification results may be invalid."`
  3. Proceed with verification but flag all results with a warning note.
  4. If `loginName` also mismatches → abort and request user correction.
- **Report entry**: `"issues": ["moduleID mismatch: URL=105170, XML=105359. Results flagged as potentially invalid."]`

### Exception 4: Page Load Failure
- **Symptom**: Game page returns blank screen, infinite loading spinner, or HTTP 404/503.
- **Handling**:
  1. Wait up to 15 seconds for page load.
  2. If still not loaded, take a screenshot for diagnostic evidence.
  3. Retry navigation once.
  4. If still failing → declare environment `UNAVAILABLE`, abort verification.
- **Report entry**: `"issues": ["Game page failed to load after 15s wait + 1 retry. Screenshot captured."]`

### Exception 5: Seed Rejection
- **Symptom**: Server returns HTTP 200 but `responseLogger` contains an error message like `"Invalid seed"`, `"Seed not found"`, or the response payload is empty/null.
- **Handling**:
  1. Record the exact error message from the server response.
  2. Mark as `SEED_REJECTED`.
  3. If 2 consecutive seeds are rejected → pause and flag for a `loginName`/`moduleID` check.
  4. Common causes: testdata was generated for a different game version, or the seed batch has expired on the server.
- **Report entry**: `"issues": ["Server rejected seed: 'Invalid pregen batch 58'. Possible cause: seed expired or wrong moduleID."]`

### Exception 6: CORS / Cross-Origin Error
- **Symptom**: Browser console shows CORS errors when the game tries to communicate with its backend.
- **Handling**:
  1. This is typically a server-side configuration issue, not a testdata issue.
  2. Mark affected records as `NETWORK_ERROR` with CORS detail.
  3. If all records fail with CORS → declare environment misconfigured, abort.
- **Report entry**: `"issues": ["CORS error: Access-Control-Allow-Origin header missing. Server-side configuration issue."]`

### Exception 7: Unexpected Game State
- **Symptom**: After a spin, the game shows an unexpected UI state (e.g., error popup, maintenance screen, session expired dialog).
- **Handling**:
  1. Detect common error UI patterns via DOM inspection (keywords: "Session Expired", "Maintenance", "Error").
  2. If session expired → attempt to re-navigate to the game URL and retry from the failed record.
  3. If maintenance screen → abort and report environment as `UNAVAILABLE`.
  4. If unknown error popup → take screenshot, mark as `NETWORK_ERROR`, continue.
- **Report entry**: `"issues": ["Session expired detected at record #12. Re-navigated and retried."]`

### Exception 8: Partial / Malformed Response
- **Symptom**: `responseLogger` returns data but is missing expected fields (e.g., no `payout`, no `stage`, no `matrix`).
- **Handling**:
  1. Log the actual response structure for debugging.
  2. Mark as `PAYOUT_MISMATCH` or `STAGE_MISMATCH` depending on which field is missing.
  3. Include the raw response snippet in the report for post-analysis.
- **Report entry**: `"issues": ["responseLogger missing 'payout' field. Raw response: {...}"]`

---

## Verification Execution Report Schema

```json
{
  "targetUrl": "http://staging-game.casino.com/api/test_spin",
  "totalCases": 6,
  "passedCount": 6,
  "failedCount": 0,
  "passRate": 100.0,
  "totalTimeMs": 3120,
  "executedAt": "17:25:00",
  "environmentStatus": "AVAILABLE",
  "results": [
    {
      "recordId": "TR-001",
      "caseName": "micro win (0.01 - 1.00 x bet)",
      "status": "PASSED",
      "httpStatus": 200,
      "responseTimeMs": 142,
      "batchIndexString": "1,10",
      "responseBodySnippet": "{\"status\":\"SUCCESS\",\"payout\":0.50,\"matrix\":[[...]]}"
    }
  ]
}
```
