export interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaHealthStatus {
  online: boolean;
  models: string[];
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 strings for vision models like qwen3-vl
}

export const OLLAMA_BASE_URL = '/ollama';

/**
 * Checks if Ollama service is reachable and retrieves list of installed models.
 */
export async function checkOllamaHealth(): Promise<OllamaHealthStatus> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      return { online: false, models: [], error: `Ollama HTTP Error ${res.status}` };
    }

    const data = await res.json();
    const models = (data.models || []).map((m: OllamaModelInfo) => m.name);
    return { online: true, models };
  } catch (err: any) {
    return { 
      online: false, 
      models: [], 
      error: err?.message || 'Failed to connect to local Ollama (http://localhost:11434)' 
    };
  }
}

/**
 * Streams chat responses from Ollama API (/api/chat).
 * Useful for real-time CoT (Chain-of-Thought) rendering.
 */
export async function streamOllamaChat(
  model: string,
  messages: ChatMessage[],
  onChunk: (chunkText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported in response body.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';

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
            fullText += token;
            onChunk(token);
          }
        } catch {
          // Ignore partial line parse errors in stream
        }
      }
    }

    return fullText;
  } catch (err: any) {
    console.error('streamOllamaChat error:', err);
    throw err;
  }
}

/**
 * Generates structured test records via qwen2.5-coder or qwen3 model.
 */
export async function generateTestDataWithLLM(
  model: string,
  userPrompt: string,
  loginName: string,
  moduleID: string = '105359'
): Promise<{ rawResponse: string; parsedXmlSnippet: string }> {
  const systemPrompt = `You are a Slot Game Test Data Architect AI Agent.
Your job is to convert user requests into valid Slot Machine test data entries.
Each spin has (batch, index) pairs.

Required Format Rules:
- Single Spin: batch, index
- Double PreGen Bonus Pairs: base_batch, base_index bonus_batch, bonus_index
- Output valid testdata XML block inside a markdown snippet \`\`\`xml ... \`\`\`
Key moduleID="${moduleID}" loginName="${loginName}".`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User intent: "${userPrompt}". Generate sample testdata records and XML layout for login "${loginName}".` }
  ];

  let responseText = '';
  await streamOllamaChat(model, messages, (chunk) => {
    responseText += chunk;
  });

  // Extract XML snippet if present
  const xmlMatch = responseText.match(/```xml([\s\S]*?)```/) || responseText.match(/<Test>[\s\S]*?<\/Test>/);
  const parsedXmlSnippet = xmlMatch ? xmlMatch[1] || xmlMatch[0] : '';

  return {
    rawResponse: responseText,
    parsedXmlSnippet: parsedXmlSnippet.trim()
  };
}

/**
 * Diagnoses game console logs and screenshots using multimodal vision model (e.g. qwen3-vl:8b).
 */
export async function diagnoseWithVisionLLM(
  model: string,
  logSummary: string,
  imageBase64?: string
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are an AI QA Log & Vision Diagnoser for Slot Game automated tests. Analyze console logs and screenshot evidence to summarize root cause, mismatch issues, and recommended fixes in concise Markdown format.'
    },
    {
      role: 'user',
      content: `Please analyze the following verification logs and screenshot evidence:\n\n${logSummary}`,
      images: imageBase64 ? [imageBase64.replace(/^data:image\/\w+;base64,/, '')] : undefined
    }
  ];

  let fullAnalysis = '';
  await streamOllamaChat(model, messages, (chunk) => {
    fullAnalysis += chunk;
  });

  return fullAnalysis;
}

import { parseGoogleSheetPaytable } from './paytableSheetParser';

/**
 * Parses LLM text response into dynamic TestRecord items matching 22-file Slot QA standard.
 */
export function parseLLMOutputToTestRecords(
  llmText: string,
  userPrompt: string,
  loginName: string = 'lijunt',
  moduleID: string = '105359'
): import('../types').TestRecord[] {
  const parsedSuite = parseGoogleSheetPaytable(llmText, 'P5P', moduleID);
  return parsedSuite.records;
}
