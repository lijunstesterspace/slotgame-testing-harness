import type {
  FunctionCallingSchema,
  HarnessSseEvent,
  LLMAuditReq,
  SkillInfoDto,
  ToolInfoDto,
  ToolListResponse,
  ToolResultDto,
  ExecutionRow,
  ExecutionDetailResponse,
  TestRecordDto,
  SseDoneEvent,
} from "./sharedTypes";

const DEFAULT_BASE = import.meta.env.VITE_HARNESS_API_BASE ?? "";

// No login in this build (see design doc §4.1) — every request is just a plain fetch,
// no auth header attached.
async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  const url = `${DEFAULT_BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    data = text as unknown as T;
  }
  if (!res.ok) {
    const detail = (data as any)?.detail ?? text ?? `HTTP ${res.status}`;
    throw new HarnessApiError(res.status, String(detail));
  }
  return data;
}

export class HarnessApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`HARNESS API ${status}: ${message}`);
  }
}

export type HarnessEventName = "harness_event" | "done" | "ping";
export type HarnessStreamCallback = (
  event: HarnessEventName,
  payload: HarnessSseEvent | SseDoneEvent | { ts: string },
) => void;

export class HarnessClient {
  readonly base: string;

  constructor(base: string = DEFAULT_BASE) {
    this.base = base;
  }

  // ---- tools ----
  async listTools(scenarioId?: string): Promise<{ tools: ToolInfoDto[]; schema: FunctionCallingSchema[] }> {
    const qs = scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : "";
    const r = await jsonFetch<ToolListResponse>(`/api/tools/list${qs}`);
    return { tools: r.tools, schema: r.function_calling_schema };
  }

  // ---- skills ----
  async listSkills(): Promise<SkillInfoDto[]> {
    const r = await jsonFetch<{ skills: SkillInfoDto[] }>("/api/tools/skills/list");
    return r.skills;
  }

  async executeTool(tool_name: string, params: Record<string, unknown>): Promise<ToolResultDto> {
    return jsonFetch<ToolResultDto>("/api/tools/execute", {
      method: "POST",
      body: JSON.stringify({ tool_name, params }),
    });
  }

  async executeToolAsync(
    tool_name: string,
    params: Record<string, unknown>,
    execution_id?: string,
  ): Promise<{ ok: boolean; execution_id: string }> {
    return jsonFetch<{ ok: boolean; execution_id: string }>("/api/tools/execute-async", {
      method: "POST",
      body: JSON.stringify({ tool_name, params, execution_id }),
    });
  }

  // ---- executions ----
  async newExecution(opts: {
    intent: string;
    workflowStage?: number;
    llmProvider?: string | null;
    llmModel?: string | null;
  }): Promise<string> {
    const res = await jsonFetch<{ execution_id: string }>("/api/executions/new", {
      method: "POST",
      body: JSON.stringify({
        intent: opts.intent,
        workflow_stage: opts.workflowStage ?? 1,
        llm_provider: opts.llmProvider ?? null,
        llm_model: opts.llmModel ?? null,
      }),
    });
    return res.execution_id;
  }

  async listExecutions(page = 1, size = 20): Promise<{ items: ExecutionRow[]; page: number; size: number }> {
    return jsonFetch(`/api/executions/mine?page=${page}&size=${size}`);
  }

  async getExecution(eid: string): Promise<ExecutionDetailResponse> {
    return jsonFetch(`/api/executions/${eid}`);
  }

  streamExecution(eid: string, cb: HarnessStreamCallback): () => void {
    const url = `${this.base}/api/executions/stream/${encodeURIComponent(eid)}`;
    const es = new EventSource(url, { withCredentials: false });

    const onMsg = (type: string) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data ?? "{}");
        cb(type as HarnessEventName, data);
      } catch {
        cb(type as HarnessEventName, {} as any);
      }
    };

    es.addEventListener("harness_event", onMsg("harness_event"));
    es.addEventListener("done", onMsg("done"));
    es.addEventListener("ping", onMsg("ping"));
    es.addEventListener("error", () => {
      // transient
    });
    return () => es.close();
  }

  // ---- records ----
  async saveRecords(records: Omit<TestRecordDto, "created_at" | "id">[] & { id?: string }[]): Promise<{ ok: boolean; count: number }> {
    return jsonFetch("/api/records/save-batch", {
      method: "POST",
      body: JSON.stringify(records),
    });
  }

  async auditLlm(req: LLMAuditReq): Promise<{ ok: boolean }> {
    return jsonFetch("/api/executions/audit-llm", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  outcomeZipUrl(rid: string): string {
    return `${this.base}/api/records/${encodeURIComponent(rid)}/outcome.zip`;
  }

  artifactUrl(filename: string): string {
    return `${this.base}/api/records/artifacts/${encodeURIComponent(filename)}`;
  }
}

// singleton
export const harnessClient = new HarnessClient();

/** Coerce raw plugin-output records (e.g. testdata_parser's `records`) into TestRecordDto[]. */
export function coerceTestRecords(arr: Record<string, unknown>[], executionId: string): TestRecordDto[] {
  return arr.map((r, i) => ({
    id: (r.id as string) ?? `rec-${executionId}-${i}`,
    execution_id: (r.execution_id as string) ?? executionId,
    user_id: (r.user_id as string) ?? null,
    case_name: String(r.case_name ?? `Case ${i + 1}`),
    format_type: (r.format_type === "DOUBLE_PREGEN" ? "DOUBLE_PREGEN" : "SINGLE") as "SINGLE" | "DOUBLE_PREGEN",
    module_id: String(r.module_id ?? "105359"),
    base_batch: Number(r.base_batch ?? 1),
    base_index: Number(r.base_index ?? 1),
    bonus_batch: r.bonus_batch != null ? Number(r.bonus_batch) : null,
    bonus_index: r.bonus_index != null ? Number(r.bonus_index) : null,
    file_name: (r.file_name as string) ?? null,
    xml_snippet: String(r.xml_snippet ?? (r as Record<string, unknown>).xml ?? ""),
    created_at: (r.created_at as number) ?? Date.now(),
  }));
}
