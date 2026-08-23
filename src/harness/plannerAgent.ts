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

// ---- system prompts ----
const SYSTEM_PROMPTS = {
  stage1: `You are a Slot QA TestData Generator Agent for slot machine test automation.

Your task: Parse user intent + Google Sheets / paytable raw text, then call HARNESS-provided tools:
  1) paytable_parser — Read raw text → structured records + fileMap
  2) testdata_generator — Write .testdata XML files to server sandbox
  3) zip_packager — Package outcome_testdata zip for download

【CRITICAL】Tool call output format (only valid format):
When calling a tool, you MUST output strictly with XML tags:
   <tool_call><name>tool_name</name><params>{ json object }</params></tool_call>
Note: <params> contains a JSON object (keys are parameter names, values must match the corresponding ToolSchema). Do not write anything related to tool dispatch outside of <tool_call>; COT reasoning can be written in natural language before <tool_call>.

After task completion (zip generated and records ready), output:
  <task_complete />

Requirements:
- For stage=1 (generation): call at least paytable_parser → testdata_generator → zip_packager.
- Use gamePrefix=P5P for all files unless user specifies otherwise; parse module_id from the table, default to 105359 if not found.
- On any parsing error, prefer self-heal: write a short reflection before <tool_call>, adjust parameters and retry up to 2 times; if exceeded, output <task_complete success=false reason="..." />.

During reasoning, you may use natural language for COT; do not output HARNESS_EVENT, SELF_HEAL etc. tags (these are rendered by UI). Only output <tool_call> or <task_complete /> when actually needed.
`,

  stage2: `You are a Slot QA TestData Verifier Agent + UI/Log Diagnoser Agent for slot machine test automation.
Your task: For already generated testdata, call:
  1) game_verifier — Selenium real verification + screenshots
  2) log_diagnoser — Output root cause diagnosis for each verification result

【Tool call format】Same as Stage 1: call with <tool_call><name>xxx</name><params>{json}</params></tool_call>
Completion: <task_complete />
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

    // Fetch tool list + create execution record (backend audit)
    const { schema } = await this.client.listTools();
    const eid = await this._createExecution(opts);

    // Save context
    let lastRecords: TestRecordDto[] = [];
    let lastFiles: string[] = [];
    let lastZipUrl: string | undefined;
    let totalIn = 0;
    let totalOut = 0;
    const startTime = performance.now();

    try {
      for (let i = 0; i < maxCycles; i++) {
        opts.signal?.throwIfAborted();
        this.callbacks.onHarnessEvent(`Cycle ${i + 1}/${maxCycles} — invoking ${this.provider.displayName}`);

        let thoughtAccumulator = "";
        const streamed = await this.provider.streamChat(
          messages,
          (tok) => {
            thoughtAccumulator += tok;
            // Incremental onThought: each chunk refreshes the last UI entry
            this.callbacks.onThought(thoughtAccumulator);
          },
          opts.signal,
        );
        totalIn += streamed.meta.tokensInEstimate;
        totalOut += streamed.meta.tokensOutEstimate;
        const text = streamed.fullText;

        // Parse tool_call / task_complete
        const toolCall = this._parseToolCall(text);
        if (toolCall) {
          this.callbacks.onToolCall(toolCall.name, toolCall.params);
          let result: Awaited<ReturnType<HarnessClient["executeTool"]>>;
          try {
            result = await this.client.executeTool(toolCall.name, {
              ...toolCall.params,
              // Attach execution_id to params for audit
              __execution_id: eid,
            } as any);
          } catch (err: any) {
            this.callbacks.onSelfHeal(`Tool ${toolCall.name} failed: ${err?.message ?? err}, letting model reflect and retry.`);
            messages.push({ role: "assistant", content: text });
            messages.push({
              role: "user",
              content: `[TOOL ERROR] ${toolCall.name} call failed: ${err?.message ?? err}\nPlease self-correct parameters and retry, or if the task cannot be completed, output <task_complete success=false reason="tool error" />.`,
            });
            continue;
          }
          const snippet = this._snippetOf(result);
          this.callbacks.onToolResult(toolCall.name, snippet, result.success);

          // Side effects: record records / zip url
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
          this.callbacks.onHarnessEvent("Agent output <task_complete />.");
          break;
        }
        if (/<task_complete[^>]*success\s*=\s*(["']?)false\1/.test(text)) {
          const m = /reason\s*=\s*(["'])([^"']+)\1/.exec(text);
          this.callbacks.onSelfHeal(`Agent reported failure: ${m?.[2] ?? "Unknown reason"}`);
          return {
            success: false,
            executionId: eid,
            records: lastRecords,
            zipUrl: lastZipUrl,
            message: m?.[2] ?? "Agent aborted",
          };
        }

        // No valid tag parsed → self-heal: ask model to re-output with correct format
        this.callbacks.onSelfHeal("Model output does not contain valid <tool_call> or <task_complete /> tags; asking to retry with correct format.");
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content:
            ["Please strictly follow the output format specified in the system prompt: when calling a tool, output " +
              "\u003ctool_call\u003e<name>…\u003c/name\u003e<params>{…}\u003c/params\u003e\u003c/tool_call\u003e, " +
              "and after task completion, output <task_complete />. Please retry now.",
          ].join(""),
        });
      }
    } catch (err: any) {
      this.callbacks.onSelfHeal(`Execution interrupted: ${err?.message ?? err}`);
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
      `User intent: ${intent.prompt}`,
      `Workflow stage: Stage ${intent.workflowStage}`,
      intent.sheetUrl ? `Google Sheet URL: ${intent.sheetUrl}` : "",
      intent.targetUrl ? `Target client URL: ${intent.targetUrl}` : "",
      intent.spinDelayMs ? `Spin interval: ${intent.spinDelayMs}ms` : "",
      `Login account: ${intent.loginName}`,
      "",
      "[Raw paytable text (excerpt)]",
      "P5P\t500\t225\t120\t115\t100\t55\t40\t30\t25\t15\t10\t5\t2.5\t0",
      "P5P Wild\t2500\t1125\t600\t575\t500\t275\t200\t150\t125\t75\t50\t25\t12.5\t0",
      "…",
    ];
    return lines.join("\n");
  }
}
