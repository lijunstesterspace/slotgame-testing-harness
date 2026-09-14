import type { LlmProviderConfig } from "../types";
import { createPlannerProvider, PlannerProvider, ChatMessage } from "./plannerProvider";

/**
 * PlannerAgent — 收窄后的语义辅助单元（设计文档第1.2 / 10.7 / 11 节定义的AI职责边界）。
 *
 * 它不驱动流水线执行，也不决定"下一步该调用哪个工具"——那完全是 ExecutionEngine +
 * pipelineRegistry.ts 的职责（声明式定义、代码固化调度）。PlannerAgent 只承担三类
 * 轻量语义任务里的两类：
 *   - 简单对话交互（clarify）：向用户澄清缺失参数
 *   - 分析报告生成（summarizeStepResult）：把某个 Plugin 步骤的结构化结果整理成简明文本
 * 第三类"任务分类与推流"目前由各 Plugin 内部的确定性代码完成（见对应 agents/*.md 的
 * "Domain Reference" 部分），暂不需要在这里额外调用模型。
 *
 * 这两个方法都是单轮、无工具调用、无多步规划的调用——模型只回答，不执行。
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
   * 简单对话交互：给定场景上下文和一个问题，返回模型的单轮回答。
   * 不做工具调用、不做多轮规划，只用于澄清缺失参数一类的轻量交互。
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
   * 分析报告生成：把一个 Pipeline 步骤的结构化结果整理成简明的分析/诊断文本。
   * 输入是已经由代码/Plugin 产出的确定性结果，模型只负责归纳成人类可读的总结，
   * 不参与该步骤"做了什么"的决策。
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
