import type { LlmProviderConfig, LlmProviderType, LlmModelEntry } from "../types";

export const STORAGE_KEY = "slot_harness_llm_config";
export const MODELS_LIST_KEY = "slot_harness_llm_models";

export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  provider: "OLLAMA",
  baseUrl: "/ollama",
  apiKey: "",
  selectedModel: "qwen2.5-coder:7b",
  availableModels: [
    "qwen2.5-coder:7b",
    "deepseek-r1:8b",
    "qwen3-vl:8b",
    "qwen3:latest",
  ],
};

export const PROVIDER_PRESETS: Record<
  LlmProviderType,
  { name: string; defaultUrl: string; defaultModels: string[]; complianceRisk?: boolean }
> = {
  OLLAMA: {
    name: "Local Ollama Instance (Default · Compliant)",
    defaultUrl: "/ollama",
    defaultModels: ["qwen2.5-coder:7b", "deepseek-r1:8b", "qwen3-vl:8b", "qwen3:latest"],
  },
  OPENAI: {
    name: "OpenAI API (v1 · ⚠️ External, requires compliance)",
    defaultUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
    complianceRisk: true,
  },
  ANTHROPIC: {
    name: "Anthropic Claude API (⚠️ External, requires compliance)",
    defaultUrl: "https://api.anthropic.com/v1",
    defaultModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    complianceRisk: true,
  },
  CUSTOM: {
    name: "Custom LLM Gateway / vLLM (⚠️ External, requires compliance)",
    defaultUrl: "http://localhost:8000/v1",
    defaultModels: ["custom-slot-llm", "qwen2.5-coder-32b", "llama3-70b"],
    complianceRisk: true,
  },
};

// ─── Single active config (legacy) ───

export function loadStoredLlmConfig(): LlmProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    console.warn("[llmGateway] loadStoredLlmConfig failed", e);
  }
  return DEFAULT_LLM_CONFIG;
}

export function saveLlmConfig(config: LlmProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("[llmGateway] saveLlmConfig failed", e);
  }
}

// ─── Multi-model storage (new) ───

export function getDefaultModelEntry(): LlmModelEntry {
  return {
    id: "default-ollama",
    name: "Local Ollama",
    provider: "OLLAMA",
    baseUrl: "/ollama",
    apiKey: "",
    selectedModel: "qwen2.5-coder:7b",
    availableModels: ["qwen2.5-coder:7b", "deepseek-r1:8b", "qwen3-vl:8b", "qwen3:latest"],
    isDefault: true,
    createdAt: new Date().toISOString(),
  };
}

export function loadStoredModels(): LlmModelEntry[] {
  try {
    const raw = localStorage.getItem(MODELS_LIST_KEY);
    if (raw) {
      const list: LlmModelEntry[] = JSON.parse(raw);
      if (list.length > 0) return list;
    }
  } catch (e) {
    console.warn("[llmGateway] loadStoredModels failed", e);
  }
  // Seed with default
  const defaultEntry = getDefaultModelEntry();
  saveStoredModels([defaultEntry]);
  return [defaultEntry];
}

export function saveStoredModels(models: LlmModelEntry[]): void {
  try {
    localStorage.setItem(MODELS_LIST_KEY, JSON.stringify(models));
  } catch (e) {
    console.error("[llmGateway] saveStoredModels failed", e);
  }
}

export function getActiveModelConfig(models: LlmModelEntry[]): LlmProviderConfig {
  const defaultModel = models.find((m) => m.isDefault) ?? models[0];
  if (!defaultModel) return DEFAULT_LLM_CONFIG;
  return {
    provider: defaultModel.provider,
    baseUrl: defaultModel.baseUrl,
    apiKey: defaultModel.apiKey,
    selectedModel: defaultModel.selectedModel,
    availableModels: defaultModel.availableModels,
  };
}

export function toLlmProviderConfig(entry: LlmModelEntry): LlmProviderConfig {
  return {
    provider: entry.provider,
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    selectedModel: entry.selectedModel,
    availableModels: entry.availableModels,
  };
}

export interface LlmHealth {
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}

export async function testLlmConnection(config: LlmProviderConfig): Promise<LlmHealth> {
  const t0 = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  const lat = () => Date.now() - t0;
  try {
    if (config.provider === "OLLAMA") {
      const res = await fetch(`${stripSlash(config.baseUrl)}/api/tags`, { method: "GET", headers });
      if (!res.ok) return { online: false, models: [], latencyMs: lat(), error: `Ollama HTTP ${res.status}` };
      const d = await res.json();
      return { online: true, models: (d.models ?? []).map((m: any) => m.name), latencyMs: lat() };
    }
    let base = stripSlash(config.baseUrl);
    if (!/\/v1$/.test(base) && !/\/models$/.test(base)) base += "/v1";
    const url = base.endsWith("/models") ? base : `${base}/models`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return { online: false, models: config.availableModels, latencyMs: lat(), error: `HTTP ${res.status}` };
    const d = await res.json();
    const models = (d.data ?? []).map((m: any) => m.id);
    return { online: true, models: models.length ? models : config.availableModels, latencyMs: lat() };
  } catch (err: any) {
    return { online: false, models: config.availableModels, latencyMs: lat(), error: err?.message ?? `Failed to connect ${config.baseUrl}` };
  }
}

export interface UniversalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export async function streamUniversalLlmChat(
  config: LlmProviderConfig,
  messages: UniversalChatMessage[],
  onChunk: (chunkText: string) => void,
  signal?: AbortSignal,
): Promise<{ fullText: string; tokensInEstimate: number; tokensOutEstimate: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  if (config.provider === "ANTHROPIC") headers["x-api-key"] = config.apiKey ?? "";

  const tokensInEstimate = messages.reduce((n, m) => n + Math.ceil(m.content.length / 3.5), 0) | 0;
  let tokensOutEstimate = 0;
  let fullText = "";

  if (config.provider === "OLLAMA") {
    const url = `${stripSlash(config.baseUrl)}/api/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.selectedModel, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter(Boolean)) {
        try {
          const j = JSON.parse(line);
          const c = j.message?.content ?? "";
          if (c) {
            fullText += c;
            tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
            onChunk(c);
          }
        } catch {}
      }
    }
  } else if (config.provider === "ANTHROPIC") {
    const url = `${stripSlash(config.baseUrl).replace(/\/v1$/, "")}/v1/messages`;
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userOnly = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.selectedModel,
        system: systemMsg,
        messages: userOnly,
        max_tokens: 4096,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const rawLine of chunk.split("\n").filter(Boolean)) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
            const c = j.delta.text ?? "";
            if (c) {
              fullText += c;
              tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
              onChunk(c);
            }
          }
        } catch {}
      }
    }
  } else {
    // OpenAI / Custom OpenAI-compatible /v1/chat/completions
    let url = stripSlash(config.baseUrl);
    if (!url.endsWith("/chat/completions")) {
      if (!url.endsWith("/v1")) url += "/v1";
      url += "/chat/completions";
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.selectedModel, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("ReadableStream unsupported");
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const rawLine of chunk.split("\n").filter(Boolean)) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const c = j.choices?.[0]?.delta?.content ?? "";
          if (c) {
            fullText += c;
            tokensOutEstimate += Math.max(1, Math.ceil(c.length / 3.5));
            onChunk(c);
          }
        } catch {}
      }
    }
  }

  return { fullText, tokensInEstimate: tokensInEstimate | 0, tokensOutEstimate: tokensOutEstimate | 0 };
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}
