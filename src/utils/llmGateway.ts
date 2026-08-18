import { LlmProviderConfig, LlmProviderType } from '../types';

export const STORAGE_KEY = 'slot_harness_llm_config';

export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  provider: 'OLLAMA',
  baseUrl: '/ollama',
  apiKey: '',
  selectedModel: 'qwen2.5-coder:7b',
  availableModels: [
    'qwen2.5-coder:7b',
    'deepseek-r1:8b',
    'qwen3-vl:8b',
    'qwen3:latest'
  ]
};

export const PROVIDER_PRESETS: Record<LlmProviderType, { name: string; defaultUrl: string; defaultModels: string[] }> = {
  OLLAMA: {
    name: 'Local Ollama Instance',
    defaultUrl: '/ollama',
    defaultModels: ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'qwen3-vl:8b', 'qwen3:latest']
  },
  OPENAI: {
    name: 'OpenAI API (v1)',
    defaultUrl: 'https://api.openai.com/v1',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini']
  },
  ANTHROPIC: {
    name: 'Anthropic Claude API',
    defaultUrl: 'https://api.anthropic.com/v1',
    defaultModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022']
  },
  CUSTOM: {
    name: 'Custom LLM Gateway / vLLM',
    defaultUrl: 'http://localhost:8000/v1',
    defaultModels: ['custom-slot-llm', 'qwen2.5-coder-32b', 'llama3-70b']
  }
};

/**
 * Loads saved LLM config from localStorage or defaults.
 */
export function loadStoredLlmConfig(): LlmProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_LLM_CONFIG,
        ...parsed
      };
    }
  } catch (e) {
    console.warn('Failed to load stored LLM config from localStorage', e);
  }
  return DEFAULT_LLM_CONFIG;
}

/**
 * Persists LLM config to localStorage.
 */
export function saveLlmConfig(config: LlmProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save LLM config to localStorage', e);
  }
}

/**
 * Tests HTTP connectivity to the configured LLM provider endpoint.
 */
export async function testLlmConnection(config: LlmProviderConfig): Promise<{
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    if (config.provider === 'OLLAMA') {
      const url = `${config.baseUrl.replace(/\/$/, '')}/api/tags`;
      const res = await fetch(url, { method: 'GET', headers });
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        return { online: false, models: [], latencyMs, error: `Ollama HTTP Error ${res.status}` };
      }

      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name);
      return { online: true, models, latencyMs };
    } else {
      // OpenAI / Custom endpoints: ping /models
      let cleanUrl = config.baseUrl.replace(/\/$/, '');
      if (!cleanUrl.endsWith('/v1') && !cleanUrl.endsWith('/models')) {
        cleanUrl += '/v1';
      }
      const url = cleanUrl.endsWith('/models') ? cleanUrl : `${cleanUrl}/models`;

      const res = await fetch(url, { method: 'GET', headers });
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        return { online: false, models: config.availableModels, latencyMs, error: `HTTP Error ${res.status}` };
      }

      const data = await res.json();
      const models = (data.data || []).map((m: any) => m.id);
      return {
        online: true,
        models: models.length > 0 ? models : config.availableModels,
        latencyMs
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      online: false,
      models: config.availableModels,
      latencyMs,
      error: err?.message || `Failed to connect to ${config.baseUrl}`
    };
  }
}

export interface UniversalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Universal SSE chat streaming for Ollama, OpenAI-compatible APIs, or Custom Gateways.
 */
export async function streamUniversalLlmChat(
  config: LlmProviderConfig,
  messages: UniversalChatMessage[],
  onChunk: (chunkText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let fullResponse = '';

  if (config.provider === 'OLLAMA') {
    const url = `${config.baseUrl.replace(/\/$/, '')}/api/chat`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.selectedModel,
        messages,
        stream: true
      }),
      signal
    });

    if (!res.ok) throw new Error(`Ollama Error ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('ReadableStream not supported.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.trim() !== '');

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            const token = json.message.content;
            fullResponse += token;
            onChunk(token);
          }
        } catch {
          // ignore stream parse errors
        }
      }
    }
  } else {
    // OpenAI / Custom OpenAI-compatible /v1/chat/completions endpoint
    let endpointUrl = config.baseUrl.replace(/\/$/, '');
    if (!endpointUrl.endsWith('/chat/completions')) {
      if (!endpointUrl.endsWith('/v1')) {
        endpointUrl += '/v1';
      }
      endpointUrl += '/chat/completions';
    }

    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.selectedModel,
        messages,
        stream: true
      }),
      signal
    });

    if (!res.ok) throw new Error(`LLM Gateway Error ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('ReadableStream not supported.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.startsWith('data:'));

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, '').trim();
        if (payload === '[DONE]') break;

        try {
          const json = JSON.parse(payload);
          const token = json.choices?.[0]?.delta?.content;
          if (token) {
            fullResponse += token;
            onChunk(token);
          }
        } catch {
          // ignore partial json
        }
      }
    }
  }

  return fullResponse;
}
