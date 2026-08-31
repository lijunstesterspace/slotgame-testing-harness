import type {
  TestRecord,
  VerificationConfig,
  VerificationReport,
  VerificationResult,
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

  const moduleID = records[0]?.moduleID ?? "105359";
  const loginName = config.loginName ?? "tester1";
  const spinDelayMs = config.spinDelayMs ?? 500;
  const maxWaitMs = config.timeoutSeconds ? config.timeoutSeconds * 1000 : 120_000;

  // Step A: call testdata_generator to produce the testdataFile needed by game_verifier
  let testdataFile: string | null = null;
  try {
    const genRes = await harnessClient.executeTool("testdata_generator", {
      action: "convert",
      records,
      loginName,
    });
    if (Array.isArray(genRes.content)) {
      testdataFile = (genRes.content as any[])[0] as string;
    }
  } catch {
    // generator failure does not block; verifier uses default samples internally
  }

  // Step B: asynchronously launch game_verifier
  const prepared = await harnessClient.executeToolAsync("game_verifier", {
    testdata_file: testdataFile ?? undefined,
    target_url: config.targetUrl,
    spin_delay_sec: spinDelayMs / 1000,
  });
  const eid = prepared.execution_id;

  await new Promise<void>((resolve) => {
    const unsub = harnessClient.streamExecution(eid, (evt, payload) => {
      if (evt === "harness_event") {
        const p = payload as any;
        if (p.type === "TOOL_RES" && p.toolName === "game_verifier") {
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
    .find((tc) => tc.tool_name === "game_verifier");

  // Extract verifier output
  let summary: { passed: number; failed: number; total: number } | null = null;
  let parsed_cases: any[] = [];
  try {
    const snippet = lastCall?.result_snippet ?? "";
    if (snippet) {
      const parsed = JSON.parse(snippet);
      if (parsed && typeof parsed === "object") {
        const inner = typeof parsed.output === "string" ? safeParse(parsed.output) : parsed.output ?? parsed;
        if (inner && typeof inner === "object") {
          summary = {
            passed: Number(inner.passed ?? 0),
            failed: Number(inner.failed ?? 0),
            total: Number(inner.total ?? (inner.passed ?? 0) + (inner.failed ?? 0)),
          };
          if (Array.isArray(inner.cases)) parsed_cases = inner.cases;
        }
      }
    }
  } catch {}

  // Step C: map cases back into VerificationResult[]
  parsed_cases.forEach((c, idx) => {
    const passed = !!(c.passed ?? c.status === "passed");
    const caseName = c.caseName ?? c.stage ?? `Spin #${c.spinIndex ?? idx + 1}`;
    results.push({
      recordId: c.recordId ?? c.caseId ?? `case-${idx + 1}`,
      caseName,
      passed,
      status: passed ? "PASSED" : "DISCREPANCY",
      httpStatus: c.httpStatus ?? (passed ? 200 : 0),
      responseTimeMs: c.durationMs ?? c.responseTimeMs ?? 0,
      serverPayout: c.actualWin,
      batchIndexString: `batch=${c.expectedBatch ?? c.batch ?? "?"}, index=${c.expectedIndex ?? c.index ?? "?"}`,
      responseBodySnippet: c.actualStage ? `stage=${c.actualStage}` : undefined,
      errorMessage: c.issues?.join("; ") ?? c.error ?? undefined,
    });
    onProgress?.(results.length, results[results.length - 1]);
  });

  // Fallback: SSE did not parse cases
  if (results.length === 0 && summary) {
    const passed = summary.failed === 0;
    results.push({
      recordId: "aggregate",
      caseName: `Aggregated ${summary.total} cases`,
      passed,
      status: passed ? "PASSED" : "ERROR",
      httpStatus: passed ? 200 : lastCall?.error_message?.includes("400") ? 400 : 0,
      responseTimeMs: Date.now() - startTime,
      batchIndexString: "Aggregated",
      errorMessage: passed ? undefined : lastCall?.error_message ?? `${summary.failed}/${summary.total} cases failed`,
    });
    onProgress?.(1, results[0]);
  }

  const failedCount = results.filter((r) => !r.passed).length;
  const passedCount = results.filter((r) => r.passed).length;
  const totalCases = summary?.total ?? results.length;

  // Step D: AI-enhanced diagnosis for failed cases
  let aiDiagnosis: AIDiagnosisResult | undefined;
  if (failedCount > 0) {
    try {
      aiDiagnosis = await runAIDiagnosis(results, parsed_cases);
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

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
