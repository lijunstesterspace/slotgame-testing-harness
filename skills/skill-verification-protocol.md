# SKILL: SLOT TestData Verification Protocol Rules

## 1. Core Purpose
Dedicated verification skill for the TestData Verification scenario; defines the verification execution flow, boundary condition handling, exception classification and result criteria, ensuring accurate and reliable verification results.

## 2. Verification Execution Flow Constraints

### Rule 1: Pre-verification Environment Check
Before verification, the following checks must be completed:
1. **URL reachability**: target game URL is accessible and returns HTTP 200
2. **TestData file integrity**: confirm the .testdata XML file exists and is well-formed (contains `<Key>`, `<Slot>`, `<Spin>`, `<PreGen>` tags)
3. **loginName consistency**: `loginName` in XML `<Key>` matches the `username` parameter in the URL
4. **moduleID match**: `moduleID` in XML `<Key>` matches the `moduleId` parameter in the URL

### Rule 2: Seed Injection and Spin Execution
- Inject an interception script via Selenium CDP to capture the `responseLogger` object
- After each Spin, wait for `responseLogger` to return; default timeout threshold 5000ms
- Default interval between Spins 300ms, to avoid triggering server rate limiting
- For Double PreGen records (with bonus), execute the base spin first, then the bonus spin

### Rule 3: Result Criteria
Each Spin record is judged by the following rules:

| Result | Condition |
|---------|------|
| **PASSED** | HTTP 200 + seed accepted + responseLogger returns valid data + batch/index match |
| **SEED_MISMATCH** | seed accepted but returned batch/index differ from expected |
| **STAGE_MISMATCH** | seed matches but game stage differs (e.g. expected FreeSpin but returned BaseGame) |
| **PAYOUT_MISMATCH** | seed and stage match but payout amount differs from expected |
| **SEED_REJECTED** | server rejects the seed (returns error message or empty response) |
| **TIMEOUT** | responseLogger did not return within the timeout threshold |
| **NETWORK_ERROR** | HTTP 4xx/5xx, CORS failure, page crash |

## 3. Boundary Condition Handling

### Rule 4: Bonus Trigger Verification
- For test cases marked Bonus/FreeSpin, must verify:
  1. Whether the bonus stage was successfully triggered after the base spin
  2. Whether the bonus spin's batch/index match the second `<PreGen>` in the XML
  3. If the base spin did not trigger the bonus, mark `STAGE_MISMATCH` and do not execute the bonus spin

### Rule 5: Consecutive Failure Handling
- 3 consecutive records with `NETWORK_ERROR` or `TIMEOUT` → environment judged unavailable, abort verification
- 2 consecutive records with `SEED_REJECTED` → pause and report; possibly loginName/moduleID mismatch

### Rule 6: Partial Data Missing Handling
- `bonusBatch`/`bonusIndex` missing in XML → treat as Single PreGen, execute base spin only
- `stage` field missing in XML → default to `BaseGame`
- responseLogger data missing payout field → mark `PAYOUT_MISMATCH`, record the actual returned content

## 4. Verification Report Output Constraints

### Rule 7: Report Format
Must output a verification report in standard JSON format:
```json
{
  "targetUrl": "game URL",
  "testdataFile": "testdata file path",
  "totalCases": total count,
  "passedCount": passed count,
  "failedCount": failed count,
  "passRate": pass rate percentage,
  "totalTimeMs": total elapsed time,
  "environmentStatus": "AVAILABLE" | "DEGRADED" | "UNAVAILABLE",
  "results": [
    {
      "recordId": "record ID",
      "caseName": "case name",
      "passed": true/false,
      "expectedBatch": expected batch,
      "actualBatch": actual batch,
      "expectedIndex": expected index,
      "actualIndex": actual index,
      "expectedStage": "expected stage",
      "actualStage": "actual stage",
      "actualWin": actual payout,
      "isBonus": whether bonus case,
      "issues": ["list of issue descriptions"],
      "responseTimeMs": response time
    }
  ]
}
```

### Rule 8: Environment Status Criteria
- **AVAILABLE**: passRate >= 90% and no consecutive failures
- **DEGRADED**: passRate between 50%-89%, or intermittent timeouts exist
- **UNAVAILABLE**: passRate < 50%, or 3 consecutive network errors exist

## 5. Mandatory Tool Call Format Constraint

**The only valid format (must be followed strictly):**
```xml
<tool_call>
<name>testdata_verifier_harness</name>
<params>{"harness_url": "...", "testdata_files": ["..."], "axiom_api_key": "...", "product_id": "...", "client_id": "..."}</params>
</tool_call>
