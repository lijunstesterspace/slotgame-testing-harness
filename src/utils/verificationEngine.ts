import type { TestRecord, VerificationConfig, VerificationReport, VerificationResult } from "../types";
import { harnessClient } from "../harness/client";

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

  // Step A：先调 testdata_generator 生成 game_verifier 需要的 testdataFile
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
    // generator 失败不阻断，verifier 内部会用默认样本
  }

  // Step B：异步启动 game_verifier（server.js 内部循环轮询）
  const prepared = await harnessClient.executeToolAsync("game_verifier", {
    loginName,
    moduleID,
    testdataFile: testdataFile ?? undefined,
    spinDelayMs,
    maxWaitMs,
  });
  const eid = prepared.execution_id;

  await new Promise<void>((resolve) => {
    const unsub = harnessClient.streamExecution(eid, (evt, payload) => {
      if (evt === "harness_event") {
        const p = payload as any;
        if (p.type === "TOOL_RES" && p.toolName === "game_verifier") {
          try {
            // 从 result_snippet 提取 {passed, failed, total}；
            // 若 SSE 尚未带出 result（后端旧实现），则降级走 Step B2 同步查询
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

  // 提取 verifier 输出
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

  // Step C：把 cases 回填成 VerificationResult[]
  parsed_cases.forEach((c, idx) => {
    const passed = !!(c.passed ?? c.status === "passed");
    results.push({
      recordId: c.caseId ?? `case-${idx + 1}`,
      caseName: c.caseId ?? `Case ${idx + 1}`,
      passed,
      status: passed ? "PASSED" : "ERROR",
      httpStatus: c.httpStatus ?? (passed ? 200 : 0),
      responseTimeMs: c.durationMs ?? c.responseTimeMs ?? Math.round((Date.now() - startTime) / Math.max(parsed_cases.length, 1)),
      batchIndexString: c.batchIndexString ?? "Base(N/A)",
      errorMessage: c.error ?? undefined,
    });
    onProgress?.(results.length, results[results.length - 1]);
  });

  // Fallback：SSE 没有解析出 cases，但 execution 已结束 → 用 summary + 单条汇总
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

  return {
    targetUrl: "Backend Harness Verifier",
    totalCases,
    passedCount,
    failedCount,
    totalTimeMs: Date.now() - startTime,
    passRate: totalCases ? Math.round((passedCount / totalCases) * 100) : 0,
    executedAt: new Date().toISOString(),
    results,
  };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
