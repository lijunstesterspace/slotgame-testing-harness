import type {
  PipelineDef,
  PipelineStepDef,
  PipelineExecutionContext,
  PipelineExecutionStatus,
  StepExecutionRecord,
  ToolResultDto,
} from "./sharedTypes";
import type { HarnessClient } from "./client";

// ── Execution engine callbacks ──────────────────────────────────────────────

export interface EngineCallbacks {
  /** Fired when a step status changes (UI updates the pipeline visualization) */
  onStepChange: (ctx: PipelineExecutionContext) => void;
  /** Fired when a step completes, carrying the tool result */
  onStepComplete: (stepId: string, result: ToolResultDto) => void;
  /** Fired when a step fails */
  onStepFail: (stepId: string, error: string) => void;
  /** Overall pipeline status change */
  onStatusChange: (status: PipelineExecutionStatus) => void;
  /** Log/event message */
  onLog: (message: string) => void;
}

// ── Execution engine ──────────────────────────────────────────────────
// Flow control lives entirely here: Plugins are invoked in the stage order declared by the Pipeline.
// The AI (PlannerAgent) does not take part in deciding "which tool to call next" - that is decided by
// the declarative definitions in pipelineRegistry.ts. App.tsx drives execution of every scenario through this class.

export class ExecutionEngine {
  private ctx: PipelineExecutionContext | null = null;
  private abortSignal: AbortSignal | undefined;
  /** result.content of each successfully completed step, read by buildParams of later steps */
  private stepResults: Record<string, unknown> = {};

  constructor(
    private readonly client: HarnessClient,
    private readonly callbacks: EngineCallbacks,
  ) {}

  /** Get the current execution context (read-only snapshot) */
  getContext(): PipelineExecutionContext | null {
    return this.ctx ? { ...this.ctx, steps: [...this.ctx.steps] } : null;
  }

  /** Get the outputs of all completed steps (stepId -> result.content), used by App.tsx to read final artifacts */
  getStepResults(): Record<string, unknown> {
    return { ...this.stepResults };
  }

  /**
   * Start pipeline execution.
   * Code controls the flow: stages run in order, and steps within each stage run sequentially.
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

    // Initialize the execution context
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
      // Execute stages in order
      for (let stageIdx = 0; stageIdx < pipeline.stages.length; stageIdx++) {
        this.abortSignal?.throwIfAborted();
        this.ctx.currentStageIndex = stageIdx;

        const stage = pipeline.stages[stageIdx];
        this.callbacks.onLog(`Stage ${stageIdx + 1}/${pipeline.stages.length}: ${stage.map((s) => s.label).join(", ")}`);

        // Execute all steps of the current stage (sequentially)
        for (let stepIdx = 0; stepIdx < stage.length; stepIdx++) {
          this.abortSignal?.throwIfAborted();
          this.ctx.currentStepIndex = stepIdx;

          const stepDef = stage[stepIdx];
          const stepRecord = this.findStepRecord(stepDef.id);
          if (!stepRecord) continue;

          await this.executeStep(stepDef, stepRecord);
        }

        // Check whether any required step in the stage failed; optional steps only warn
        const stageFailed = stage.some((s) => {
          const rec = this.findStepRecord(s.id);
          if (rec?.status === "failed" && s.optional) {
            this.callbacks.onLog(`Optional step "${s.label}" failed — continuing without it`);
            return false;
          }
          return rec && rec.status === "failed";
        });

        if (stageFailed) {
          this.ctx.status = "failed";
          this.callbacks.onStatusChange("failed");
          this.callbacks.onLog(`Pipeline failed at stage ${stageIdx + 1}`);
          break;
        }
      }

      // All stages completed
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

  /** Execute a single step, including retry logic */
  private async executeStep(
    stepDef: PipelineStepDef,
    stepRecord: StepExecutionRecord,
  ): Promise<void> {
    const maxAttempts = stepDef.retryOnFail ? stepDef.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.abortSignal?.throwIfAborted();

      // Update step status
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
        // Call the backend tool
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
          // The tool returned a failure result
          const errMsg = result.error ?? "Tool returned success=false";
          if (attempt < maxAttempts - 1) {
            this.callbacks.onStepFail(stepDef.id, errMsg);
            continue; // retry
          }
          stepRecord.status = "failed";
          stepRecord.error = errMsg;
          stepRecord.finishedAt = Date.now();
          this.callbacks.onStepChange(this.ctx!);
          this.callbacks.onStepFail(stepDef.id, errMsg);
          return;
        }
      } catch (err: unknown) {
        // AbortError must propagate upward and must not be swallowed by the retry logic
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
          continue; // retry
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
   * Build tool call parameters: invoke the step's own declared buildParams (if any),
   * mapping the pipeline start params + outputs of previous steps to the inputs this Plugin needs.
   * Steps without buildParams fall back to passing extraParams through directly (legacy behavior).
   *
   * Note: only `__execution_id` is attached - it is the only metadata key that the backend `/api/tools/execute`
   * explicitly pop()s (see server/api/tools_router.py). Any other `__xxx` metadata
   * is rejected by ToolPlugin.validate() as unknown_param, so do not add any here.
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

  /** Create a step execution record */
  private createStepRecord(stepDef: PipelineStepDef): StepExecutionRecord {
    return {
      stepId: stepDef.id,
      plugin: stepDef.plugin,
      label: stepDef.label,
      status: "pending",
      retryCount: 0,
    };
  }

  /** Find a step record */
  private findStepRecord(stepId: string): StepExecutionRecord | undefined {
    return this.ctx?.steps.find((s) => s.stepId === stepId);
  }

  /** Truncate a string */
  private truncate(str: string, maxLen: number): string {
    return str.length <= maxLen ? str : str.slice(0, maxLen) + "...";
  }
}
