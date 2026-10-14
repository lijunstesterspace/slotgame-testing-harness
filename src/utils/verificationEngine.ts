import type {
  TestRecord,
  VerificationConfig,
  VerificationReport,
  VerificationResult,
  VerificationStatus,
  AIDiagnosisResult,
  AIDiagnosis,
} from "../types";
import type { ExecutionDetailResponse, ToolCallRow } from "../harness/sharedTypes";
import { harnessClient } from "../harness/client";
import { loadStoredLlmConfig, streamUniversalLlmChat } from "./llmGateway";

/** Pull {passed, failed, total, cases, report_url} out of a testdata_verifier tool_call's
 * result_snippet — shared by the live-run path and the history-reopen path below. */
function parseVerifierResultSnippet(lastCall: ToolCallRow | undefined): {
  totalSummary: { passed: number; failed: number; total: number };
  allParsedCases: any[];
  reportUrl?: string;
} {
  let totalSummary = { passed: 0, failed: 0, total: 0 };
  let allParsedCases: any[] = [];
  let reportUrl: string | undefined;
  try {
    const snippet = lastCall?.result_snippet ?? "";
    if (snippet) {
      const parsed = JSON.parse(snippet);
      if (parsed && typeof parsed === "object") {
        const inner = typeof parsed.output === "string" ? safeParse(parsed.output) : parsed.output ?? parsed;
        if (inner && typeof inner === "object") {
          totalSummary = {
            passed: Number(inner.passed ?? 0),
            failed: Number(inner.failed ?? 0),
            total: Number(inner.total ?? (inner.passed ?? 0) + (inner.failed ?? 0)),
          };
          if (Array.isArray(inner.cases)) allParsedCases = inner.cases;
          if (typeof inner.report_url === "string") reportUrl = inner.report_url;
        }
      }
    }
  } catch {}
  return { totalSummary, allParsedCases, reportUrl };
}

/** Map testdata_verifier's raw per-case objects into VerificationResult[] — shared by the
 * live-run path and the history-reopen path below. */
function mapCasesToResults(allParsedCases: any[]): VerificationResult[] {
  return allParsedCases.map((c, idx) => {
    const passed = !!(c.passed ?? c.status === "passed");
    const caseName = c.caseName ?? c.stage ?? `Spin #${c.spinIndex ?? idx + 1}`;
    const status = deriveStatus(c, passed);
    const result: VerificationResult = {
      recordId: c.recordId ?? c.caseId ?? `case-${idx + 1}`,
      caseName,
      passed,
      status,
      httpStatus: c.httpStatus ?? (passed ? 200 : 0),
      responseTimeMs: c.durationMs ?? c.responseTimeMs ?? 0,
      serverPayout: c.actualWin,
      batchIndexString: `batch=${c.expectedBatch ?? c.batch ?? "?"}, index=${c.expectedIndex ?? c.index ?? "?"}`,
      responseBodySnippet: c.actualStage ? `stage=${c.actualStage}` : undefined,
      errorMessage: c.issues?.join("; ") ?? c.error ?? undefined,
      screenshotB64: c.screenshot_b64 ?? undefined,
      isBonus: c.isBonus ?? false,
      actualBatch: c.actualBatch ?? null,
      actualIndex: c.actualIndex ?? null,
      actualStage: c.actualStage ?? undefined,
      expectedBatch: c.expectedBatch ?? c.batch ?? undefined,
      expectedIndex: c.expectedIndex ?? c.index ?? undefined,
    };
    (result as any).sourceFile = c.source_file ?? undefined;
    return result;
  });
}

/**
 * Rebuild a VerificationReport from an already-finished execution's detail — used to reopen a
 * past TestData Verification run from the History page. Unlike runRealGameVerification, this:
 *   - never throws (a history view has no live try/catch banner to route errors into — a failed
 *     run is surfaced via `runError` on the returned report instead, rendered as a banner in
 *     VerificationReportModal);
 *   - never re-runs AI diagnosis (that would mean waiting on the local LLM again, every single
 *     time someone just wants to glance back at an old report — the report shows the raw
 *     verification data; a fresh diagnosis was never persisted anywhere to "restore" instead).
 */
export function buildReportFromExecutionDetail(detail: ExecutionDetailResponse): VerificationReport {
  const lastCall = detail.tool_calls
    .slice()
    .reverse()
    .find((tc) =>
      // "testdata_verifier" is the removed Selenium tool — kept so its old runs still reopen.
      tc.tool_name === "testdata_verifier" ||
      tc.tool_name === "testdata_verifier_api" ||
      tc.tool_name === "testdata_verifier_harness"
    );

  let targetUrl = "";
  try {
    const params = lastCall ? JSON.parse(lastCall.params_json) : null;
    // testdata_verifier_harness has no target_url — harness_url is the closest analog.
    if (params && typeof params.target_url === "string") targetUrl = params.target_url;
    else if (params && typeof params.harness_url === "string") targetUrl = params.harness_url;
  } catch {}

  const { totalSummary, allParsedCases, reportUrl } = parseVerifierResultSnippet(lastCall);
  const results = mapCasesToResults(allParsedCases);

  const runError =
    results.length === 0 && totalSummary.total === 0 && lastCall && !lastCall.success
      ? lastCall.error_message || "testdata_verifier failed with no result data"
      : undefined;

  const failedCount = results.filter((r) => !r.passed).length;
  const passedCount = results.filter((r) => r.passed).length;
  const totalCases = totalSummary.total || results.length;

  return {
    targetUrl,
    totalCases,
    passedCount,
    failedCount,
    totalTimeMs: lastCall?.execution_ms ?? detail.execution.total_ms ?? 0,
    passRate: totalCases ? Math.round((passedCount / totalCases) * 100) : 0,
    executedAt: new Date(detail.execution.started_at).toISOString(),
    results,
    reportUrl,
    runError,
  };
}

export async function runRealGameVerification(
  records: TestRecord[],
  config: VerificationConfig,
  onProgress?: (completedCount: number, currentResult: VerificationResult) => void,
  onStarted?: (executionId: string) => void
): Promise<VerificationReport> {
  const startTime = Date.now();
  const results: VerificationResult[] = [];

  const loginName = config.loginName ?? "tester1";
  const spinDelayMs = config.spinDelayMs ?? 500;
  const maxWaitMs = config.timeoutSeconds ? config.timeoutSeconds * 1000 : 120_000;

  // Step A: Use testdata file(s) from folder
  // Support both single file (testdataFilePath) and multiple files (testdataFilePaths)
  const testdataFiles = config.testdataFilePaths && config.testdataFilePaths.length > 0
    ? config.testdataFilePaths
    : config.testdataFilePath
    ? [config.testdataFilePath]
    : [];

  if (testdataFiles.length === 0) {
    throw new Error("No testdata file selected. Please select a folder with .testdata files.");
  }

  // Step B: launch the verifier tool ONCE with all files (batch mode). Same backend contract
  // (params in, ToolResult.content shape out) for all three tools — see each tool's module
  // docstring — so everything below this point (waiting, parsing, report building) is identical
  // regardless of which one actually ran.
  const method = config.verificationMethod ?? "harness";
  const toolName = method === "api" ? "testdata_verifier_api" : "testdata_verifier_harness";
  const toolParams: Record<string, unknown> = {
    testdata_files: testdataFiles,
    spin_delay_sec: spinDelayMs / 1000,
  };
  if (method === "api") {
    if (!config.oktaAccessToken) {
      throw new Error("API-direct verification needs an Okta access_token — paste one in before running.");
    }
    if (!config.axiomApiKey) {
      throw new Error("API-direct verification needs an Axiom API Key — paste one in before running.");
    }
    toolParams.target_url = config.targetUrl;
    toolParams.okta_access_token = config.oktaAccessToken;
    toolParams.axiom_api_key = config.axiomApiKey;
  } else if (method === "harness") {
    if (!config.harnessUrl) {
      throw new Error("Harness verification needs the Titan Harness launcher page URL — paste one in before running.");
    }
    if (!config.axiomApiKey) {
      throw new Error("Harness verification needs an Axiom API Key — paste one in before running.");
    }
    if (!config.harnessProductId || !config.harnessClientId) {
      throw new Error("Harness verification needs the harness form's Product Id and Client Id — fill both in before running.");
    }
    toolParams.harness_url = config.harnessUrl;
    toolParams.axiom_api_key = config.axiomApiKey;
    toolParams.product_id = config.harnessProductId;
    toolParams.client_id = config.harnessClientId;
    if (config.harnessBrand) toolParams.brand = config.harnessBrand;
  }
  const prepared = await harnessClient.executeToolAsync(toolName, toolParams);
  const eid = prepared.execution_id;
  onStarted?.(eid);

  await new Promise<void>((resolve) => {
    const unsub = harnessClient.streamExecution(eid, (evt) => {
      if (evt === "done") {
        resolve();
        setTimeout(unsub, 100);
      }
    });
    setTimeout(() => {
      unsub();
      resolve();
    }, maxWaitMs + 20_000);
  });

  const detail = await harnessClient.getExecution(eid);

  const lastCall = detail.tool_calls
    .slice()
    .reverse()
    .find((tc) => tc.tool_name === toolName);

  const { totalSummary, allParsedCases, reportUrl } = parseVerifierResultSnippet(lastCall);

  // Step C: map cases back into VerificationResult[], reporting progress as each one lands
  for (const result of mapCasesToResults(allParsedCases)) {
    results.push(result);
    onProgress?.(results.length, result);
  }

  // The tool failed before producing a single case (e.g. it errored out during admin-panel
  // login, before ever uploading a file or spinning). Neither the per-case mapping above nor
  // the aggregate fallback below has anything to work with in that situation, and silently
  // falling through to a "0%, 0/0 cases" report looks exactly like a normal, successful, empty
  // run — the tester has no way to tell "nothing needed verifying" apart from "verification
  // never actually started". Throwing here routes the real backend error message into
  // handleStartVerification's existing catch block (an error banner) instead.
  if (results.length === 0 && totalSummary.total === 0 && lastCall && !lastCall.success) {
    throw new Error(lastCall.error_message || "testdata_verifier failed with no result data");
  }

  // Fallback: SSE did not parse cases
  if (results.length === 0 && totalSummary.total > 0) {
    const passed = totalSummary.failed === 0;
    results.push({
      recordId: "aggregate",
      caseName: `Aggregated ${totalSummary.total} cases`,
      passed,
      status: passed ? "PASSED" : "ERROR",
      httpStatus: passed ? 200 : lastCall?.error_message?.includes("400") ? 400 : 0,
      responseTimeMs: Date.now() - startTime,
      batchIndexString: "Aggregated",
      errorMessage: passed ? undefined : lastCall?.error_message ?? `${totalSummary.failed}/${totalSummary.total} cases failed`,
    });
    onProgress?.(1, results[0]);
  }

  const failedCount = results.filter((r) => !r.passed).length;
  const passedCount = results.filter((r) => r.passed).length;
  const totalCases = totalSummary.total ?? results.length;

  // Step D: AI-enhanced diagnosis for failed cases
  let aiDiagnosis: AIDiagnosisResult | undefined;
  if (failedCount > 0) {
    try {
      aiDiagnosis = await runAIDiagnosis(results, allParsedCases);
    } catch (e) {
      console.warn("[verificationEngine] AI diagnosis failed, using rule-based fallback", e);
      aiDiagnosis = await runRuleBasedDiagnosis(results);
    }
  }

  return {
    targetUrl: method === "harness" ? config.harnessUrl ?? "" : config.targetUrl,
    totalCases,
    passedCount,
    failedCount,
    totalTimeMs: Date.now() - startTime,
    passRate: totalCases ? Math.round((passedCount / totalCases) * 100) : 0,
    executedAt: new Date().toISOString(),
    results,
    aiDiagnosis,
    reportUrl,
  };
}

// ---------------------------------------------------------------------------
// AI Diagnosis: uses local LLM (Ollama) to analyze failed cases
// ---------------------------------------------------------------------------
async function runAIDiagnosis(
  results: VerificationResult[],
  rawCases: any[]
): Promise<AIDiagnosisResult> {
  const failedResults = results.filter((r) => !r.passed);
  const failedRaw = rawCases.filter((c: any) => !(c.passed ?? false));

  const config = loadStoredLlmConfig();

  // Build prompt with failed case details
  const caseDetails = failedResults
    .map((r, i) => {
      const raw = failedRaw[i];
      return `Case ${i + 1}: "${r.caseName}"
  Expected: batch=${raw?.expectedBatch ?? "?"}, index=${raw?.expectedIndex ?? "?"}, stage=${raw?.stage ?? "BaseGame"}
  Actual: batch=${raw?.actualBatch ?? "?"}, index=${raw?.actualIndex ?? "?"}, stage=${raw?.actualStage ?? "?"}
  Win: ${raw?.actualWin ?? 0}
  Issues: ${r.errorMessage ?? "Unknown"}
  Is Bonus: ${raw?.isBonus ?? false}`;
    })
    .join("\n\n");

  const systemPrompt = `You are a SLOT game test data verification expert.
Analyze the failed verification cases below and provide:
1. A brief overall summary (2-3 sentences)
2. For each failed case: root cause analysis with probability estimates
3. Actionable recommendations

Respond in this JSON format:
{
  "summary": "overall assessment",
  "diagnoses": [
    {
      "caseName": "...",
      "diagnosisType": "ORIGINAL_SHEET_DATA_ERROR | SEED_MISMATCH | SERVER_ERROR | UNKNOWN",
      "title": "short title",
      "severity": "HIGH | MEDIUM | LOW",
      "evidenceLogs": ["evidence 1", "evidence 2"],
      "recommendation": "what to do",
      "aiAnalysis": "detailed analysis with probability estimates"
    }
  ],
  "recommendations": ["action 1", "action 2"]
}`;

  const userPrompt = `Failed verification cases:

${caseDetails}

Total: ${results.length} cases, ${failedResults.length} failed, ${results.filter((r) => r.passed).length} passed.

Please analyze and provide diagnosis in the JSON format specified.`;

  let fullText = "";
  await streamUniversalLlmChat(
    config,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    (chunk) => {
      fullText += chunk;
    }
  );

  // Parse AI response
  try {
    // Try to extract JSON from the response
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary ?? "AI analysis completed.",
        failedDiagnoses: (parsed.diagnoses ?? []).map((d: any) => ({
          caseName: d.caseName ?? "",
          diagnosisType: d.diagnosisType ?? "UNKNOWN",
          title: d.title ?? "",
          severity: d.severity ?? "MEDIUM",
          evidenceLogs: d.evidenceLogs ?? [],
          recommendation: d.recommendation ?? "",
          aiAnalysis: d.aiAnalysis ?? "",
        })),
        recommendations: parsed.recommendations ?? [],
        rawText: fullText,
      };
    }
  } catch {}

  // Fallback: return raw text as summary
  return {
    summary: fullText || "AI analysis completed but could not parse structured output.",
    failedDiagnoses: [],
    recommendations: [],
    rawText: fullText,
  };
}

// ---------------------------------------------------------------------------
// Rule-based fallback diagnosis (when AI is unavailable) — delegates to the backend
// log_diagnoser Plugin (server/tools/impl/log_diagnoser_tool.py) instead of duplicating its
// classification rules here. That Python tool already implements a more complete rule set
// (seed mismatch, bonus-not-triggered, out-of-bounds index, generic failure) driven off the same
// structured fields (expectedBatch/actualBatch/issues/isBonus/...) testdata_verifier already
// produces — the version this replaced only pattern-matched on caseName/errorMessage substrings,
// which is strictly weaker (e.g. it only recognized "bonus" when the word literally appeared in
// the case name). This also gives log_diagnoser a real caller again: the standalone "Log
// Diagnosis" scenario that used to invoke it was retired (diagnosis is now just part of every
// verification report, not its own scenario) — see intentRouter.ts.
// ---------------------------------------------------------------------------
async function runRuleBasedDiagnosis(
  results: VerificationResult[]
): Promise<AIDiagnosisResult> {
  const failedResults = results.filter((r) => !r.passed);
  if (failedResults.length === 0) {
    return { summary: "No failed cases to diagnose.", failedDiagnoses: [], recommendations: [] };
  }

  // Map VerificationResult's field names onto the shape log_diagnoser_tool.py's
  // _diagnose_new_format expects (the same shape testdata_verifier's own cases already have —
  // VerificationResult is just this same data after mapCasesToResults reshapes it for the UI).
  const backendInput = failedResults.map((r) => ({
    recordId: r.recordId,
    caseName: r.caseName,
    passed: r.passed,
    expectedBatch: r.expectedBatch,
    actualBatch: r.actualBatch,
    expectedIndex: r.expectedIndex,
    actualIndex: r.actualIndex,
    actualStage: r.actualStage,
    actualWin: r.serverPayout,
    isBonus: r.isBonus,
    issues: r.errorMessage ? [r.errorMessage] : [],
  }));

  try {
    const res = await harnessClient.executeTool("log_diagnoser", { results: backendInput });
    if (!res.success) throw new Error(res.error ?? "log_diagnoser tool call failed");
    const diagnostics = (res.content as { diagnostics?: Record<string, unknown>[] } | undefined)?.diagnostics ?? [];
    const diagnoses: AIDiagnosis[] = diagnostics.map((d) => ({
      caseName: (d.caseName as string) ?? "",
      diagnosisType: (d.diagnosisType as string) ?? "UNKNOWN",
      title: (d.title as string) ?? "",
      severity: (d.severity as string) ?? "MEDIUM",
      evidenceLogs: (d.evidenceLogs as string[]) ?? [],
      recommendation: (d.recommendation as string) ?? "",
    }));
    return {
      summary: `Rule-based diagnosis: ${failedResults.length} failed case(s) detected. ${diagnoses.filter((d) => d.severity === "HIGH").length} high severity.`,
      failedDiagnoses: diagnoses,
      recommendations: diagnoses.map((d) => d.recommendation),
    };
  } catch (e) {
    // This IS the fallback path already — if the backend call itself fails too (server down,
    // network error), there's nothing further to fall back to. Surface a minimal, honest
    // diagnosis instead of throwing and losing the report entirely.
    console.warn("[verificationEngine] log_diagnoser tool call failed, returning minimal diagnosis", e);
    return {
      summary: `${failedResults.length} case(s) failed verification. Diagnosis service was unavailable: ${e instanceof Error ? e.message : String(e)}`,
      failedDiagnoses: failedResults.map((r) => ({
        caseName: r.caseName,
        diagnosisType: "VERIFICATION_FAILED",
        title: "❌ Verification Failed",
        severity: "MEDIUM",
        evidenceLogs: [`[FAIL] ${r.errorMessage ?? "Unknown failure"}`],
        recommendation: `Review '${r.caseName}' test case.`,
      })),
      recommendations: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Derive fine-grained VerificationStatus from backend case data
// ---------------------------------------------------------------------------
function deriveStatus(c: any, passed: boolean): VerificationStatus {
  if (passed) return "PASSED";

  // Backend may already provide a verdict field
  if (c.verdict) {
    const v = String(c.verdict).toUpperCase();
    const validStatuses: VerificationStatus[] = [
      "SEED_MISMATCH", "STAGE_MISMATCH", "PAYOUT_MISMATCH",
      "SEED_REJECTED", "TIMEOUT", "NETWORK_ERROR",
    ];
    if (validStatuses.includes(v as VerificationStatus)) {
      return v as VerificationStatus;
    }
  }

  // Infer from issues text
  const issues: string = (c.issues ?? []).join(" ").toLowerCase();
  if (issues.includes("timeout") || issues.includes("no game response")) return "TIMEOUT";
  if (issues.includes("cors") || issues.includes("network") || issues.includes("http")) return "NETWORK_ERROR";
  if (issues.includes("rejected") || issues.includes("invalid seed")) return "SEED_REJECTED";
  if (issues.includes("stage mismatch") || issues.includes("stage")) return "STAGE_MISMATCH";
  if (issues.includes("batch mismatch") || issues.includes("index mismatch")) return "SEED_MISMATCH";

  return "DISCREPANCY";
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
