import type { LlmProviderConfig } from "../types";
import { createPlannerProvider, PlannerProvider, ChatMessage } from "./plannerProvider";
import { harnessClient, HarnessClient } from "./client";
import type { FunctionCallingSchema, TestRecordDto } from "./sharedTypes";
import { getScenarioSystemPrompt } from "./intentRouter";

export interface PlannerCallbacks {
  onThought: (content: string) => void;
  onToolCall: (toolName: string, params: Record<string, unknown>) => void;
  onToolResult: (toolName: string, resultSnippet: string, ok: boolean) => void;
  onSelfHeal: (content: string) => void;
  onHarnessEvent: (content: string) => void;
  onProgress?: (records: TestRecordDto[], artifacts: { zipUrl?: string; files?: string[] }) => void;
}

export interface PlannerRunOptions {
  /** 场景 ID，用于获取对应的 System Prompt */
  scenarioId: string;
  /** 用户意图描述 */
  intent: string;
  sheetUrl?: string;
  targetUrl?: string;
  loginName: string;
  spinDelayMs?: number;
  maxCycles?: number;
  signal?: AbortSignal;
  /** 可选：自定义 System Prompt（覆盖场景默认值） */
  customSystemPrompt?: string;
  /** 可选：预过滤的工具列表（按 scenario 的 requiredPlugins 过滤） */
  availableTools?: FunctionCallingSchema[];
}

export interface PlannerRunOutcome {
  success: boolean;
  executionId: string | null;
  records: TestRecordDto[];
  zipUrl?: string;
  message?: string;
}

// ── XML 标签常量（避免字面量被工具解析） ──
const TC_OPEN = "<tool_call>";
const TC_CLOSE = "</tool_call>";
const TC_NAME = "<name>";
const TC_NAME_CLOSE = "</name>";
const TC_PARAMS = "<params>";
const TC_PARAMS_CLOSE = "</params>";
const TASK_DONE = "<task_complete />";
const TOOL_CALL_REGEX_SRC = [
  /<tool_call\s*<name>\s*([\w-]+)\s*<\/name>\s*/,
  /<params>\s*(\{[\s\S]*?\})\s*<\/params>\s*/,
  /<\/tool_call>/,
];
const TASK_COMPLETE_RE = /<task_complete\s*\/>|<task_complete\s+success\s*=\s*(["']?)true\1/;
const TASK_FAIL_RE = /<task_complete[^>]*success\s*=\s*(["']?)false\1/;
const TASK_FAIL_REASON_RE = /reason\s*=\s*(["'])([^"']+)\1/;

/**
 * PlannerAgent — 语义推理单元
 *
 * 职责：
 *   - 接收场景化 System Prompt（来自 intentRouter）
 *   - 驱动 AI 对话循环（流式输出 → 解析 tool_call → 执行 → 反馈）
 *   - 不控制业务流程（流程由 ExecutionEngine 编排）
 *
 * 4B 模型在此的角色是"语义传感器"：
 *   - 解析用户意图 → 输出结构化的工具调用
 *   - 对工具返回结果做简单语义理解
 *   - 所有流程控制、重试、状态机均由代码处理
 */
export class PlannerAgent {
  private readonly provider: PlannerProvider;
  private readonly client: HarnessClient;

  constructor(
    llmConfig: LlmProviderConfig,
    private readonly callbacks: PlannerCallbacks,
    client: HarnessClient = harnessClient,
  ) {
    this.provider = createPlannerProvider(llmConfig);
    this.client = client;
  }

  get complianceRisk(): boolean {
    return this.provider.complianceRisk;
  }
  get providerType() {
    return this.provider.providerType;
  }

  async run(opts: PlannerRunOptions): Promise<PlannerRunOutcome> {
    const maxCycles = opts.maxCycles ?? 12;
    const basePrompt = opts.customSystemPrompt ?? getScenarioSystemPrompt(opts.scenarioId);

    // Resolve available tools: use pre-filtered list or fetch all from backend
    let tools: FunctionCallingSchema[];
    if (opts.availableTools) {
      tools = opts.availableTools;
    } else {
      const listRes = await this.client.listTools();
      tools = listRes.schema;
    }

    // Compose full system prompt: agent+skills + tool schemas + format
    const sys = this._composeSystemPrompt(basePrompt, tools);

    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      { role: "user", content: this._buildUserMessage(opts) },
    ];

    const eid = await this._createExecution(opts);

    let lastRecords: TestRecordDto[] = [];
    let lastFiles: string[] = [];
    let lastZipUrl: string | undefined;
    let totalIn = 0;
    let totalOut = 0;
    const startTime = performance.now();

    try {
      for (let i = 0; i < maxCycles; i++) {
        opts.signal?.throwIfAborted();
        this.callbacks.onHarnessEvent(
          `Cycle ${i + 1}/${maxCycles} — invoking ${this.provider.displayName}`,
        );

        let thoughtAccumulator = "";
        const streamed = await this.provider.streamChat(
          messages,
          (tok) => {
            thoughtAccumulator += tok;
            this.callbacks.onThought(thoughtAccumulator);
          },
          opts.signal,
        );
        totalIn += streamed.meta.tokensInEstimate;
        totalOut += streamed.meta.tokensOutEstimate;
        const text = streamed.fullText;

        // 解析 tool_call
        const toolCall = this._parseToolCall(text);
        if (toolCall) {
          this.callbacks.onToolCall(toolCall.name, toolCall.params);
          let result: Awaited<ReturnType<HarnessClient["executeTool"]>>;
          try {
            result = await this.client.executeTool(toolCall.name, {
              ...toolCall.params,
              __execution_id: eid,
            } as Record<string, unknown>);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.callbacks.onSelfHeal(
              `Tool ${toolCall.name} failed: ${errMsg}, letting model reflect and retry.`,
            );
            messages.push({ role: "assistant", content: text });
            messages.push({
              role: "user",
              content: `[TOOL ERROR] ${toolCall.name} call failed: ${errMsg}\nPlease self-correct parameters and retry, or output ${TASK_DONE} with success=false.`,
            });
            continue;
          }
          const snippet = this._snippetOf(result);
          this.callbacks.onToolResult(toolCall.name, snippet, result.success);
          this._collectSideEffects(toolCall.name, result, eid, (recs, files, zipUrl) => {
            if (recs) lastRecords = recs;
            if (files) lastFiles = files;
            if (zipUrl) lastZipUrl = zipUrl;
            this.callbacks.onProgress?.(lastRecords, { zipUrl: lastZipUrl, files: lastFiles });
          });

          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `[TOOL RESULT from ${toolCall.name}] (success=${result.success})\n\n${snippet}`,
          });
          continue;
        }

        // 检查 task_complete
        if (TASK_COMPLETE_RE.test(text)) {
          this.callbacks.onHarnessEvent("Agent output <task_complete />.");
          break;
        }
        if (TASK_FAIL_RE.test(text)) {
          const m = TASK_FAIL_REASON_RE.exec(text);
          this.callbacks.onSelfHeal(`Agent reported failure: ${m?.[2] ?? "Unknown reason"}`);
          return {
            success: false,
            executionId: eid,
            records: lastRecords,
            zipUrl: lastZipUrl,
            message: m?.[2] ?? "Agent aborted",
          };
        }

        // 无有效标签 → self-heal
        this.callbacks.onSelfHeal(
          `Model output does not contain valid ${TC_OPEN} or ${TASK_DONE} tags; asking to retry.`,
        );
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `Please strictly follow the output format: when calling a tool, output ${TC_OPEN}${TC_NAME}...${TC_NAME_CLOSE}${TC_PARAMS}{...}${TC_PARAMS_CLOSE}${TC_CLOSE}, and after task completion, output ${TASK_DONE}. Please retry now.`,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.callbacks.onSelfHeal(`Execution interrupted: ${errMsg}`);
      throw err;
    } finally {
      fetch(`${this.client.base}/api/executions/mine`, {
        headers: { Authorization: `Bearer ${window.sessionStorage.getItem("harness_token") ?? ""}` },
      }).catch(() => {});
    }

    const durationMs = Math.round(performance.now() - startTime);
    await this.client
      .auditLlm({
        provider: this.provider.providerType,
        model: this.provider.config.selectedModel ?? "",
        tokens_in: totalIn,
        tokens_out: totalOut,
        duration_ms: durationMs,
        success: true,
      })
      .catch(() => {});

    return {
      success: true,
      executionId: eid,
      records: lastRecords,
      zipUrl: lastZipUrl,
      message: `Completed in ${maxCycles} cycles or earlier.`,
    };
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * Compose the full system prompt: base prompt (agent+skills) + tool schemas + format reminder.
   * The tool schema section tells the LLM exactly which tools are available and their parameters.
   */
  private _composeSystemPrompt(basePrompt: string, tools: FunctionCallingSchema[]): string {
    const toolSection = tools.map((t) => {
      const fn = t.function;
      const params = Object.entries(fn.parameters.properties)
        .map(([k, v]) => `  - ${k} (${v.type}): ${v.description}`)
        .join("\n");
      const required = fn.parameters.required.length
        ? `\n  Required: ${fn.parameters.required.join(", ")}`
        : "";
      return `### ${fn.name}\n${fn.description}\nParameters:\n${params}${required}`;
    }).join("\n\n");

    return [
      basePrompt,
      "",
      "=== AVAILABLE TOOLS ===",
      `You have access to the following ${tools.length} tool(s). Only use these tools:`,
      "",
      toolSection,
    ].join("\n");
  }

  private _parseToolCall(text: string): { name: string; params: Record<string, unknown> } | null {
    const re = TOOL_CALL_REGEX_SRC;
    const m = text.match(new RegExp(re.map((r) => r.source).join("")));
    if (!m) return null;
    const name = m[1];
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(m[2]);
    } catch {
      return null;
    }
    return { name, params };
  }

  private _snippetOf(result: { content: unknown }): string {
    const raw = JSON.stringify(result.content);
    if (raw.length <= 4000) return raw;
    return raw.slice(0, 2000) + `\n…[truncated ${raw.length - 4000} chars]…\n` + raw.slice(-2000);
  }

  private _collectSideEffects(
    toolName: string,
    result: { success: boolean; content: unknown },
    eid: string,
    collect: (recs: TestRecordDto[] | null, files: string[] | null, zipUrl: string | null) => void,
  ): void {
    if (!result.success) return;
    const content = (result.content as Record<string, unknown>) ?? {};

    if (toolName === "testdata_parser") {
      const recs = this._coerceRecords((content.records as Record<string, unknown>[]) ?? [], eid);
      void this.client.saveRecords(recs as unknown as Parameters<HarnessClient["saveRecords"]>[0]);
      collect(recs, null, null);
    }
    if (toolName === "testdata_generator") {
      const files = content.files as string[] | undefined;
      collect(null, files ?? null, null);
    }
    if (toolName === "zip_packager") {
      const url = content.download_url as string | undefined;
      collect(null, null, url ? `${this.client.base}${url}` : null);
    }
  }

  private async _createExecution(opts: PlannerRunOptions): Promise<string> {
    const res = await fetch(`${this.client.base}/api/executions/new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("harness_token") ?? ""}`,
      },
      body: JSON.stringify({
        intent: opts.intent,
        workflow_stage: 1,
        llm_provider: this.providerType,
        llm_model: this.provider.config.selectedModel ?? "",
      }),
    });
    if (!res.ok) throw new Error(`create execution failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.execution_id as string;
  }

  private _coerceRecords(arr: Record<string, unknown>[], eid: string): TestRecordDto[] {
    return arr.map((r, i) => ({
      id: (r.id as string) ?? `rec-${eid}-${i}`,
      execution_id: (r.execution_id as string) ?? eid,
      user_id: (r.user_id as string) ?? null,
      case_name: String(r.case_name ?? `Case ${i + 1}`),
      format_type: (r.format_type === "DOUBLE_PREGEN" ? "DOUBLE_PREGEN" : "SINGLE") as "SINGLE" | "DOUBLE_PREGEN",
      module_id: String(r.module_id ?? "105359"),
      base_batch: Number(r.base_batch ?? 1),
      base_index: Number(r.base_index ?? 1),
      bonus_batch: r.bonus_batch != null ? Number(r.bonus_batch) : null,
      bonus_index: r.bonus_index != null ? Number(r.bonus_index) : null,
      file_name: (r.file_name as string) ?? null,
      xml_snippet: String(r.xml_snippet ?? r.xml ?? ""),
      created_at: (r.created_at as number) ?? Date.now(),
    }));
  }

  private _buildUserMessage(opts: PlannerRunOptions): string {
    const lines = [
      `User intent: ${opts.intent}`,
      `Scenario: ${opts.scenarioId}`,
      opts.sheetUrl ? `Google Sheet URL: ${opts.sheetUrl}` : "",
      opts.targetUrl ? `Target client URL: ${opts.targetUrl}` : "",
      opts.spinDelayMs ? `Spin interval: ${opts.spinDelayMs}ms` : "",
      `Login account: ${opts.loginName}`,
      "",
      "[Raw paytable text (excerpt)]",
      "P5P\t500\t225\t120\t115\t100\t55\t40\t30\t25\t15\t10\t5\t2.5\t0",
      "P5P Wild\t2500\t1125\t600\t575\t500\t275\t200\t150\t125\t75\t50\t25\t12.5\t0",
      "…",
    ];
    return lines.join("\n");
  }
}
