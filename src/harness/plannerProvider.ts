import type { LlmProviderConfig } from "../types";
import { streamUniversalLlmChat, testLlmConnection, PROVIDER_PRESETS } from "../utils/llmGateway";

export type PlannerProviderName = "ollama" | "openai" | "anthropic" | "custom";

export interface PlannerHealth {
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export interface PlannerStreamMeta {
  tokensInEstimate: number;
  tokensOutEstimate: number;
}

export interface PlannerProvider {
  readonly providerType: PlannerProviderName;
  readonly displayName: string;
  readonly complianceRisk: boolean;
  readonly config: LlmProviderConfig;

  healthCheck(): Promise<PlannerHealth>;
  streamChat(
    messages: ChatMessage[],
    onChunk: (tokenText: string) => void,
    signal?: AbortSignal,
  ): Promise<{ fullText: string; meta: PlannerStreamMeta }>;
}

class _BaseProvider implements PlannerProvider {
  readonly providerType: PlannerProviderName;
  readonly displayName: string;
  readonly complianceRisk: boolean;

  constructor(readonly config: LlmProviderConfig) {
    const type = config.provider.toLowerCase() as PlannerProviderName;
    this.providerType = type;
    const preset = PROVIDER_PRESETS[config.provider];
    this.displayName = preset?.name ?? `${config.provider} (${config.baseUrl})`;
    this.complianceRisk = !!preset?.complianceRisk;
  }

  async healthCheck(): Promise<PlannerHealth> {
    return testLlmConnection(this.config);
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (tokenText: string) => void,
    signal?: AbortSignal,
  ): Promise<{ fullText: string; meta: PlannerStreamMeta }> {
    const r = await streamUniversalLlmChat(this.config, messages, onChunk, signal);
    return {
      fullText: r.fullText,
      meta: { tokensInEstimate: r.tokensInEstimate, tokensOutEstimate: r.tokensOutEstimate },
    };
  }
}

export function createPlannerProvider(config: LlmProviderConfig): PlannerProvider {
  return new _BaseProvider(config);
}
