import type {
  PipelineDef,
  PipelineStepDef,
  PipelineExecutionContext,
  PipelineExecutionStatus,
  StepExecutionRecord,
  ToolResultDto,
} from "./sharedTypes";
import type { HarnessClient } from "./client";

// ── 执行引擎回调 ──────────────────────────────────────────────

export interface EngineCallbacks {
  /** 步骤状态变化时触发（UI 更新流水线可视化） */
  onStepChange: (ctx: PipelineExecutionContext) => void;
  /** 步骤完成时触发，携带工具返回结果 */
  onStepComplete: (stepId: string, result: ToolResultDto) => void;
  /** 步骤失败时触发 */
  onStepFail: (stepId: string, error: string) => void;
  /** 流水线整体状态变化 */
  onStatusChange: (status: PipelineExecutionStatus) => void;
  /** 日志/事件消息 */
  onLog: (message: string) => void;
}

// ── 执行引擎 ──────────────────────────────────────────────────
// 流程调度权完全在这里：按 Pipeline 声明的 stage 顺序调用 Plugin，
// AI（PlannerAgent）不参与"下一步该调用哪个工具"的决策——那由 pipelineRegistry.ts
// 的声明式定义决定。App.tsx 通过这个类驱动所有场景的执行。

export class ExecutionEngine {
  private ctx: PipelineExecutionContext | null = null;
  private abortSignal: AbortSignal | undefined;
  /** 每个已成功完成步骤的 result.content，供后续步骤的 buildParams 读取 */
  private stepResults: Record<string, unknown> = {};

  constructor(
    private readonly client: HarnessClient,
    private readonly callbacks: EngineCallbacks,
  ) {}

  /** 获取当前执行上下文（只读快照） */
  getContext(): PipelineExecutionContext | null {
    return this.ctx ? { ...this.ctx, steps: [...this.ctx.steps] } : null;
  }

  /** 获取所有已完成步骤的产出（stepId → result.content），供 App.tsx 读取最终产物 */
  getStepResults(): Record<string, unknown> {
    return { ...this.stepResults };
  }

  /**
   * 启动流水线执行。
   * 代码控制流程：按 stage 顺序逐步执行，每个 stage 内的步骤串行执行。
   */
  async run(
    pipeline: PipelineDef,
    scenarioId: string,
    userIntent: string,
    extraParams: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<PipelineExecutionContext> {
    this.abortSignal = signal;
    this.stepResults = {};

    // 初始化执行上下文
    this.ctx = {
      scenarioId,
      pipelineId: pipeline.id,
      status: "running",
      currentStageIndex: 0,
      currentStepIndex: 0,
      steps: pipeline.stages.flatMap((stage) =>
        stage.map((stepDef) => this.createStepRecord(stepDef)),
      ),
      startedAt: Date.now(),
      userIntent,
      extraParams,
    };

    this.callbacks.onStatusChange("running");
    this.callbacks.onStepChange(this.ctx);
    this.callbacks.onLog(`Pipeline "${pipeline.name}" started`);

    try {
      // 按 stage 顺序执行
      for (let stageIdx = 0; stageIdx < pipeline.stages.length; stageIdx++) {
        this.abortSignal?.throwIfAborted();
        this.ctx.currentStageIndex = stageIdx;

        const stage = pipeline.stages[stageIdx];
        this.callbacks.onLog(`Stage ${stageIdx + 1}/${pipeline.stages.length}: ${stage.map((s) => s.label).join(", ")}`);

        // 执行当前 stage 的所有步骤（串行）
        for (let stepIdx = 0; stepIdx < stage.length; stepIdx++) {
          this.abortSignal?.throwIfAborted();
          this.ctx.currentStepIndex = stepIdx;

          const stepDef = stage[stepIdx];
          const stepRecord = this.findStepRecord(stepDef.id);
          if (!stepRecord) continue;

          await this.executeStep(stepDef, stepRecord);
        }

        // 检查 stage 内是否有失败步骤
        const stageFailed = stage.some((s) => {
          const rec = this.findStepRecord(s.id);
          return rec && rec.status === "failed";
        });

        if (stageFailed) {
          this.ctx.status = "failed";
          this.callbacks.onStatusChange("failed");
          this.callbacks.onLog(`Pipeline failed at stage ${stageIdx + 1}`);
          break;
        }
      }

      // 所有 stage 完成
      if (this.ctx.status === "running") {
        this.ctx.status = "completed";
        this.ctx.finishedAt = Date.now();
        this.callbacks.onStatusChange("completed");
        this.callbacks.onLog(`Pipeline "${pipeline.name}" completed successfully`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        this.ctx.status = "aborted";
        this.callbacks.onStatusChange("aborted");
        this.callbacks.onLog("Pipeline aborted by user");
      } else {
        this.ctx.status = "failed";
        this.callbacks.onStatusChange("failed");
        const errMsg = err instanceof Error ? err.message : String(err);
        this.callbacks.onLog(`Pipeline error: ${errMsg}`);
      }
      this.ctx.finishedAt = Date.now();
    }

    return this.ctx;
  }

  /** 执行单个步骤，包含重试逻辑 */
  private async executeStep(
    stepDef: PipelineStepDef,
    stepRecord: StepExecutionRecord,
  ): Promise<void> {
    const maxAttempts = stepDef.retryOnFail ? stepDef.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.abortSignal?.throwIfAborted();

      // 更新步骤状态
      if (attempt > 0) {
        stepRecord.status = "retrying";
        stepRecord.retryCount = attempt;
        this.callbacks.onLog(`Retrying step "${stepDef.label}" (attempt ${attempt + 1}/${maxAttempts})`);
      } else {
        stepRecord.status = "running";
      }
      stepRecord.startedAt = Date.now();
      this.callbacks.onStepChange(this.ctx!);

      try {
        // 调用后端工具
        const params = this.buildStepParams(stepDef);
        const result = await this.client.executeTool(stepDef.plugin, params);

        if (result.success) {
          stepRecord.status = "success";
          stepRecord.finishedAt = Date.now();
          stepRecord.resultSnippet = this.truncate(JSON.stringify(result.content), 500);
          this.stepResults[stepDef.id] = result.content;
          this.callbacks.onStepChange(this.ctx!);
          this.callbacks.onStepComplete(stepDef.id, result);
          this.callbacks.onLog(`Step "${stepDef.label}" succeeded`);
          return;
        } else {
          // 工具返回了失败结果
          const errMsg = result.error ?? "Tool returned success=false";
          if (attempt < maxAttempts - 1) {
            this.callbacks.onStepFail(stepDef.id, errMsg);
            continue; // 重试
          }
          stepRecord.status = "failed";
          stepRecord.error = errMsg;
          stepRecord.finishedAt = Date.now();
          this.callbacks.onStepChange(this.ctx!);
          this.callbacks.onStepFail(stepDef.id, errMsg);
          return;
        }
      } catch (err: unknown) {
        // AbortError 必须向上传播，不能被重试逻辑吞没
        if (err instanceof DOMException && err.name === "AbortError") {
          stepRecord.status = "failed";
          stepRecord.error = "Aborted by user";
          stepRecord.finishedAt = Date.now();
          this.callbacks.onStepChange(this.ctx!);
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts - 1) {
          this.callbacks.onStepFail(stepDef.id, errMsg);
          continue; // 重试
        }
        stepRecord.status = "failed";
        stepRecord.error = errMsg;
        stepRecord.finishedAt = Date.now();
        this.callbacks.onStepChange(this.ctx!);
        this.callbacks.onStepFail(stepDef.id, errMsg);
      }
    }
  }

  /**
   * 构建工具调用参数：调用步骤自己声明的 buildParams（若有），
   * 把流水线启动参数 + 前置步骤产出映射成这一个 Plugin 需要的入参。
   * 没有声明 buildParams 的步骤退化为直接透传 extraParams（兼容旧行为）。
   *
   * 注意：只附加 `__execution_id` —— 这是后端 `/api/tools/execute` 唯一会显式
   * pop() 掉的元数据 key（见 server/api/tools_router.py）。其余任何 `__xxx` 元数据
   * 都会被 ToolPlugin.validate() 当作 unknown_param 拒绝，不要往这里加。
   */
  private buildStepParams(stepDef: PipelineStepDef): Record<string, unknown> {
    const extraParams = this.ctx!.extraParams;
    const custom = stepDef.buildParams
      ? stepDef.buildParams({ extraParams, stepResults: this.stepResults })
      : extraParams;
    return {
      ...custom,
      __execution_id: extraParams.executionId,
    };
  }

  /** 创建步骤执行记录 */
  private createStepRecord(stepDef: PipelineStepDef): StepExecutionRecord {
    return {
      stepId: stepDef.id,
      plugin: stepDef.plugin,
      label: stepDef.label,
      status: "pending",
      retryCount: 0,
    };
  }

  /** 查找步骤记录 */
  private findStepRecord(stepId: string): StepExecutionRecord | undefined {
    return this.ctx?.steps.find((s) => s.stepId === stepId);
  }

  /** 截断字符串 */
  private truncate(str: string, maxLen: number): string {
    return str.length <= maxLen ? str : str.slice(0, maxLen) + "...";
  }
}
