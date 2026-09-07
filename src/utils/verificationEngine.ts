import type {
  TestRecord,
  VerificationConfig,
  VerificationReport,
  VerificationResult,
  VerificationStatus,
  AIDiagnosisResult,
  AIDiagnosis,
} from "../types";
import { harnessClient } from "../harness/client";
import { loadStoredLlmConfig, streamUniversalLlmChat } from "./llmGateway";

export async function runRealGameVerification(
  records: TestRecord[],
  config: VerificationConfig,
  onProgress?: (completedCount: number, currentResult: VerificationResult) => void
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

  // Step B: launch testdata_verifier ONCE with all files (batch mode)
  const prepared = await harnessClient.executeToolAsync("testdata_verifier", {
    testdata_files: testdataFiles,
    target_url: config.targetUrl,
    spin_delay_sec: spinDelayMs / 1000,
  });
  const eid = prepared.execution_id;

  await new Promise<void>((resolve) => {
    const unsub = harnessClient.streamExecution(eid, (evt, payload) => {
      if (evt === "harness_event") {
        const p = payload as any;
        if (p.type === "TOOL_RES" && p.toolName === "testdata_verifier") {
          try {
            // Extract {passed, failed, total} from result_snippet
          } catch {}
        }
      }
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
    .find((tc) => tc.tool_name === "testdata_verifier");

  // Extract verifier output
  let totalSummary = { passed: 0, failed: 0, total: 0 };
  let allParsedCases: any[] = [];
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
        }
      }
    }
  } catch {}

  // Step C: map cases back into VerificationResult[]
  allParsedCases.forEach((c, idx) => {
      const passed = !!(c.passed ?? c.status === "passed");
      const caseName = c.caseName ?? c.stage ?? `Spin #${c.spinIndex ?? idx + 1}`;

      // Derive fine-grained status from backend issues / verdict
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
      // Attach source file for progress display
      (result as any).sourceFile = c.source_file ?? undefined;
      results.push(result);
      onProgress?.(results.length, result);
  });

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
    targetUrl: config.targetUrl,
    totalCases,
    passedCount,
    failedCount,
    totalTimeMs: Date.now() - startTime,
    passRate: totalCases ? Math.round((passedCount / totalCases) * 100) : 0,
    executedAt: new Date().toISOString(),
    results,
    aiDiagnosis,
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
// Rule-based fallback diagnosis (when AI is unavailable)
// ---------------------------------------------------------------------------
async function runRuleBasedDiagnosis(
  results: VerificationResult[]
): Promise<AIDiagnosisResult> {
  const failedResults = results.filter((r) => !r.passed);
  const diagnoses: AIDiagnosis[] = failedResults.map((r) => {
    const isBonus = r.caseName.toLowerCase().includes("bonus") || r.caseName.toLowerCase().includes("feature");
    const hasMismatch = r.errorMessage?.toLowerCase().includes("mismatch");

    if (isBonus && !hasMismatch) {
      return {
        caseName: r.caseName,
        diagnosisType: "ORIGINAL_SHEET_DATA_ERROR",
        title: "🚨 Bonus Feature Not Triggered — Likely Sheet Data Error",
        severity: "HIGH",
        evidenceLogs: [
          `[PROOF] Sheet Label: '${r.caseName}' (marked as Bonus)`,
          `[PROOF] Server did not trigger Bonus feature`,
        ],
        recommendation: `Update Google Sheet for '${r.caseName}'. The seed did not trigger Bonus in the math model.`,
      };
    }

    if (hasMismatch) {
      return {
        caseName: r.caseName,
        diagnosisType: "SEED_MISMATCH",
        title: "⚠️ Seed Mismatch — Expected vs Actual Differ",
        severity: "HIGH",
        evidenceLogs: [
          `[MISMATCH] ${r.errorMessage}`,
        ],
        recommendation: `Check testdata generation for '${r.caseName}'. The server used different seed coordinates.`,
      };
    }

    return {
      caseName: r.caseName,
      diagnosisType: "VERIFICATION_FAILED",
      title: "❌ Verification Failed",
      severity: "MEDIUM",
      evidenceLogs: [
        `[FAIL] ${r.errorMessage ?? "Unknown failure"}`,
      ],
      recommendation: `Review '${r.caseName}' test case.`,
    };
  });

  return {
    summary: `Rule-based diagnosis: ${failedResults.length} failed case(s) detected. ${diagnoses.filter((d) => d.severity === "HIGH").length} high severity.`,
    failedDiagnoses: diagnoses,
    recommendations: diagnoses.map((d) => d.recommendation),
  };
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
