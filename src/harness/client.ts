import type {
  FunctionCallingSchema,
  HarnessSseEvent,
  LLMAuditReq,
  LoginResponse,
  SkillInfoDto,
  ToolInfoDto,
  ToolListResponse,
  ToolResultDto,
  UserDto,
  ExecutionRow,
  ExecutionDetailResponse,
  TestRecordDto,
  SseDoneEvent,
} from "./sharedTypes";

const DEFAULT_BASE = import.meta.env.VITE_HARNESS_API_BASE ?? "";

function readToken(): string {
  return window.sessionStorage.getItem("harness_token") ?? "";
}

export function saveToken(tok: string) {
  window.sessionStorage.setItem("harness_token", tok);
}

export function clearAuth() {
  window.sessionStorage.removeItem("harness_token");
}

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
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

  // ---- auth ----
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await jsonFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (res?.session_token) saveToken(res.session_token);
    return res;
  }

  async me(): Promise<UserDto> {
    return jsonFetch<UserDto>("/api/auth/me", { method: "GET" });
  }

  logout() {
    clearAuth();
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
  async listExecutions(page = 1, size = 20): Promise<{ items: ExecutionRow[]; page: number; size: number }> {
    return jsonFetch(`/api/executions/mine?page=${page}&size=${size}`);
  }

  async getExecution(eid: string): Promise<ExecutionDetailResponse> {
    return jsonFetch(`/api/executions/${eid}`);
  }

  streamExecution(eid: string, cb: HarnessStreamCallback): () => void {
    const token = readToken();
    // EventSource cannot carry custom headers, pass token via ?token= query param (backend SSE already supports query token auth)
    const url = `${this.base}/api/executions/stream/${encodeURIComponent(eid)}?token=${encodeURIComponent(token)}`;
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
