import type { LlmProviderConfig } from "../types";
import { createPlannerProvider, PlannerProvider, ChatMessage } from "./plannerProvider";
import { harnessClient, HarnessClient } from "./client";
import type { FunctionCallingSchema, ToolInfoDto, TestRecordDto } from "./sharedTypes";

export interface PlannerCallbacks {
  onThought: (content: string) => void;
  onToolCall: (toolName: string, params: Record<string, unknown>) => void;
  onToolResult: (toolName: string, resultSnippet: string, ok: boolean) => void;
  onSelfHeal: (content: string) => void;
  onHarnessEvent: (content: string) => void;
  onProgress?: (records: TestRecordDto[], artifacts: { zipUrl?: string; files?: string[] }) => void;
}

export interface PlannerRunOptions {
  intent: {
    prompt: string;
    sheetUrl?: string;
    loginName: string;
    workflowStage: 1 | 2;
    targetUrl?: string;
    spinDelayMs?: number;
  };
  maxCycles?: number;
  signal?: AbortSignal;
}

export interface PlannerRunOutcome {
  success: boolean;
  executionId: string | null;
  records: TestRecordDto[];
  zipUrl?: string;
  message?: string;
}

// ---- system prompts (from docs/) ----
const SYSTEM_PROMPTS = {
  stage1: `你是老虎机测试自动化的 TestData Generator Agent（Slot QA）。

你的任务：把用户意图 + Google Sheets / paytable 原始文本 解析后，通过调用 HARNESS 提供的工具：
  1) paytable_parser — 读原始文本 → 结构化 records + fileMap
  2) testdata_generator — 写 .testdata XML 文件到服务器沙箱
  3) zip_packager — 打包 outcome_testdata zip 供下载

【非常重要】工具调用输出格式（唯一合法格式）：
当你要调用工具时，必须严格用 XML 标签输出：
   <tool_call><name>工具名</name><params>{ json 对象 }</params></tool_call>
注意：<params> 里放一个 JSON 对象（键是参数名，值要符合对应 ToolSchema）。不要在 <tool_call> 外面写任何与工具调度相关的话；COT 思考写在 <tool_call> 之前的自然语言里即可。

任务完成（已经生成了 zip 且 records 准备好）之后，输出：
  <task_complete />

要求：
- 对于 stage=1（生成）：至少调用 paytable_parser → testdata_generator → zip_packager 三个工具。
- 所有文件使用 gamePrefix=P5P，除非用户另行指定；module_id 从表格中解析，找不到时默认 105359。
- 遇到任何解析错误，优先 self-heal：在 <tool_call> 之前写一段中文反思（SELF-HEAL），调整参数重试最多 2 次；超过次数输出 <task_complete success=false reason="..." />。

在思考过程中，你可以用自然语言展示 COT，不需要输出 HARNESS_EVENT、SELF_HEAL 等标签（这些标签由 UI 渲染）。但必须在真正需要时输出 <tool_call> 或 <task_complete />。
`,

  stage2: `你是老虎机测试自动化的 TestData Verifier Agent + UI/Log Diagnoser Agent。
你的任务：对已经生成的 testdata，调用：
  1) game_verifier — Selenium 真实验证 + 截图
  2) log_diagnoser — 把每条验证结果输出根因诊断

【工具调用格式】同 Stage 1：调用用 <tool_call><name>xxx</name><params>{json}</params> 。</tool_call>
完成：<task_complete />
`,
};

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
    const sys = SYSTEM_PROMPTS[opts.intent.workflowStage === 2 ? "stage2" : "stage1"];
    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      {
        role: "user",
        content: this._buildUserFirstMessage(opts.intent),
      },
    ];

    // 先拉工具列表 + 创建执行记录（后端 audit）
    const { schema } = await this.client.listTools();
    const eid = await this._createExecution(opts);

    // 保存上下文
    let lastRecords: TestRecordDto[] = [];
    let lastFiles: string[] = [];
    let lastZipUrl: string | undefined;
    let totalIn = 0;
    let totalOut = 0;
    const startTime = performance.now();

    try {
      for (let i = 0; i < maxCycles; i++) {
        opts.signal?.throwIfAborted();
        this.callbacks.onHarnessEvent(`Cycle ${i + 1}/${maxCycles} — 调用 ${this.provider.displayName}`);

        let thoughtAccumulator = "";
        const streamed = await this.provider.streamChat(
          messages,
          (tok) => {
            thoughtAccumulator += tok;
            // 增量 onThought：每个 chunk 直接刷新 UI 最后一条
            this.callbacks.onThought(thoughtAccumulator);
          },
          opts.signal,
        );
        totalIn += streamed.meta.tokensInEstimate;
        totalOut += streamed.meta.tokensOutEstimate;
        const text = streamed.fullText;

        // 解析 tool_call / task_complete
        const toolCall = this._parseToolCall(text);
        if (toolCall) {
          this.callbacks.onToolCall(toolCall.name, toolCall.params);
          let result: Awaited<ReturnType<HarnessClient["executeTool"]>>;
          try {
            result = await this.client.executeTool(toolCall.name, {
              ...toolCall.params,
              // 把 execution_id 附在 params 里，便于审计
              __execution_id: eid,
            } as any);
          } catch (err: any) {
            this.callbacks.onSelfHeal(`执行工具 ${toolCall.name} 失败：${err?.message ?? err}，准备让模型反思后重试。`);
            messages.push({ role: "assistant", content: text });
            messages.push({
              role: "user",
              content: `[TOOL ERROR] ${toolCall.name} 调用失败：${err?.message ?? err}\n请自我修正参数后重新调用，或如果任务已无法完成输出 <task_complete success=false reason="tool error" />。`,
            });
            continue;
          }
          const snippet = this._snippetOf(result);
          this.callbacks.onToolResult(toolCall.name, snippet, result.success);

          // side effects: 记录 records / zip url
          if (toolCall.name === "paytable_parser" && result.success) {
            const content = (result.content as any) ?? {};
            const recs = this._coerceRecords(content.records ?? [], eid);
            lastRecords = recs;
            await this.client.saveRecords(recs as any);
            this.callbacks.onProgress?.(recs, {});
          }
          if (toolCall.name === "testdata_generator" && result.success) {
            const files = (result.content as any)?.files as string[] | undefined;
            if (files) lastFiles = files;
            this.callbacks.onProgress?.(lastRecords, { files });
          }
          if (toolCall.name === "zip_packager" && result.success) {
            const url = (result.content as any)?.download_url as string | undefined;
            if (url) lastZipUrl = `${this.client.base}${url}`;
            this.callbacks.onProgress?.(lastRecords, { zipUrl: lastZipUrl, files: lastFiles });
          }

          // push conversation
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `[TOOL RESULT from ${toolCall.name}] (success=${result.success})\n\n${snippet}`,
          });
          continue;
        }

        if (/<task_complete\s*\/>|<task_complete\s+success\s*=\s*(["']?)true\1/.test(text)) {
          this.callbacks.onHarnessEvent("Agent 输出 <task_complete />。");
          break;
        }
        if (/<task_complete[^>]*success\s*=\s*(["']?)false\1/.test(text)) {
          const m = /reason\s*=\s*(["'])([^"']+)\1/.exec(text);
          this.callbacks.onSelfHeal(`Agent 输出失败：${m?.[2] ?? "未知原因"}`);
          return {
            success: false,
            executionId: eid,
            records: lastRecords,
            zipUrl: lastZipUrl,
            message: m?.[2] ?? "Agent aborted",
          };
        }

        // 未解析到合法标签 → self-heal 让模型重新输出格式化
        this.callbacks.onSelfHeal("模型输出未包含合法 <tool_call> 或 <task_complete /> 标签；要求其按规定格式重试。");
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content:
            ["请严格按照 system prompt 规定的格式输出：调用工具时输出 " +
              "\u003ctool_call\u003e<name>…\u003c/name\u003e<params>{…}\u003c/params\u003e\u003c/tool_call\u003e，" +
              "任务完成后输出 <task_complete />。现在请重新输出。",
          ].join(""),
        });
      }
    } catch (err: any) {
      this.callbacks.onSelfHeal(`运行中断：${err?.message ?? err}`);
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
        model: (this.provider as any).config.selectedModel,
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
  private _parseToolCall(text: string): { name: string; params: Record<string, unknown> } | null {
    const re = [
      /<tool_call\s*<name>\s*([\w-]+)\s*<\/name>\s*/,
      /<params>\s*(\{[\s\S]*?\})\s*<\/params>\s*/,
      /<\/tool_call>/,
    ];
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

  private _snippetOf(result: any): string {
    const raw = JSON.stringify(result.content);
    if (raw.length <= 4000) return raw;
    return raw.slice(0, 2000) + `\n…[truncated ${raw.length - 4000} chars]…\n` + raw.slice(-2000);
  }

  private async _createExecution(opts: PlannerRunOptions): Promise<string> {
    const res = await fetch(`${this.client.base}/api/executions/new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("harness_token") ?? ""}`,
      },
      body: JSON.stringify({
        intent: opts.intent.prompt,
        workflow_stage: opts.intent.workflowStage,
        llm_provider: this.providerType,
        llm_model: (this.provider as any).config.selectedModel,
      }),
    });
    if (!res.ok) throw new Error(`create execution failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.execution_id;
  }
  private _coerceRecords(arr: any[], eid: string): TestRecordDto[] {
    return arr.map((r, i) => ({
      id: r.id ?? `rec-${eid}-${i}`,
      execution_id: r.execution_id ?? eid,
      user_id: r.user_id ?? null,
      case_name: String(r.case_name ?? `Case ${i + 1}`),
      format_type: (r.format_type === "DOUBLE_PREGEN" ? "DOUBLE_PREGEN" : "SINGLE") as any,
      module_id: String(r.module_id ?? "105359"),
      base_batch: Number(r.base_batch ?? 1),
      base_index: Number(r.base_index ?? 1),
      bonus_batch: r.bonus_batch != null ? Number(r.bonus_batch) : null,
      bonus_index: r.bonus_index != null ? Number(r.bonus_index) : null,
      file_name: r.file_name ?? null,
      xml_snippet: String(r.xml_snippet ?? r.xml ?? ""),
      created_at: r.created_at ?? Date.now(),
    }));
  }

  private _buildUserFirstMessage(intent: PlannerRunOptions["intent"]): string {
    const lines = [
      `用户意图：${intent.prompt}`,
      `工作流阶段：Stage ${intent.workflowStage}`,
      intent.sheetUrl ? `Google Sheet URL：${intent.sheetUrl}` : "",
      intent.targetUrl ? `目标客户端 URL：${intent.targetUrl}` : "",
      intent.spinDelayMs ? `spin 间隔：${intent.spinDelayMs}ms` : "",
      `登录账号：${intent.loginName}`,
      "",
      "【原始 paytable 文本（节选）】",
      "P5P\t500\t225\t120\t115\t100\t55\t40\t30\t25\t15\t10\t5\t2.5\t0",
      "P5P Wild\t2500\t1125\t600\t575\t500\t275\t200\t150\t125\t75\t50\t25\t12.5\t0",
      "…",
    ];
    return lines.join("\n");
  }
}
