import type { LlmProviderConfig } from "../types";
import { createPlannerProvider, PlannerProvider, ChatMessage } from "./plannerProvider";

/**
 * PlannerAgent - a narrowed semantic helper unit (AI responsibility boundary defined in sections 1.2 / 10.7 / 11 of the design doc).
 *
 * It does not drive pipeline execution, nor decide "which tool to call next" - that is entirely the job of ExecutionEngine +
 * pipelineRegistry.ts (declarative definitions, scheduling fixed in code). PlannerAgent only handles two of the three
 * lightweight semantic task types:
 *   - Simple conversational interaction (clarify): ask the user to clarify missing parameters
 *   - Analysis report generation (summarizeStepResult): turn a Plugin step's structured result into concise text
 * The third type, "task classification and routing", is currently done by deterministic code inside each Plugin (see the
 * "Domain Reference" section of the corresponding agents/*.md), so no extra model call is needed here for now.
 *
 * Both methods are single-turn calls with no tool calls and no multi-step planning - the model only answers, it does not act.
 */
export class PlannerAgent {
  private readonly provider: PlannerProvider;

  constructor(llmConfig: LlmProviderConfig) {
    this.provider = createPlannerProvider(llmConfig);
  }

  get complianceRisk(): boolean {
    return this.provider.complianceRisk;
  }
  get providerType() {
    return this.provider.providerType;
  }
  get displayName() {
    return this.provider.displayName;
  }

  /**
   * Simple conversational interaction: given scenario context and a question, return the model's single-turn answer.
   * No tool calls and no multi-turn planning; only for lightweight interactions such as clarifying missing parameters.
   */
  async clarify(scenarioContext: string, question: string, signal?: AbortSignal): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${scenarioContext}\n\n=== YOUR TASK ===\n` +
          "You are a lightweight clarification assistant. Given the scenario context above and a " +
          "question, answer in 1-3 short sentences. Do not call tools, do not plan multi-step " +
          "actions, and do not output anything except your direct answer.",
      },
      { role: "user", content: question },
    ];
    const { fullText } = await this.provider.streamChat(messages, () => {}, signal);
    return fullText.trim();
  }

  /**
   * Analysis report generation: turn a Pipeline step's structured result into concise analysis/diagnosis text.
   * The input is a deterministic result already produced by code/Plugin; the model only condenses it into a human-readable summary
   * and takes no part in deciding "what the step did".
   */
  async summarizeStepResult(
    scenarioContext: string,
    stepLabel: string,
    resultContent: unknown,
    signal?: AbortSignal,
  ): Promise<string> {
    const snippet = JSON.stringify(resultContent).slice(0, 4000);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${scenarioContext}\n\n=== YOUR TASK ===\n` +
          "You are a report-summary assistant for a slot-game testing pipeline. Given the " +
          "structured JSON result of one already-completed pipeline step, write a short, " +
          "plain-language summary (3-6 sentences) a QA engineer can read at a glance: what " +
          "happened, whether it looks healthy, and anything that stands out. Do not repeat raw " +
          "JSON verbatim. Do not call tools, and do not suggest what to run next.",
      },
      { role: "user", content: `Step: ${stepLabel}\nResult JSON:\n${snippet}` },
    ];
    const { fullText } = await this.provider.streamChat(messages, () => {}, signal);
    return fullText.trim();
  }
}
