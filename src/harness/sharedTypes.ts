export type ToolParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameterDto {
  name: string;
  type: ToolParameterType;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface ToolInputSchemaDto {
  properties: ToolParameterDto[];
}

export interface ToolInfoDto {
  name: string;
  description: string;
  inputSchema: ToolInputSchemaDto;
  permissions: string[];
  timeout_seconds: number;
  version: string;
}

export interface FunctionCallingSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: unknown[] }>;
      required: string[];
    };
  };
}

export interface ToolListResponse {
  tools: ToolInfoDto[];
  function_calling_schema: FunctionCallingSchema[];
}

export interface SkillInfoDto {
  id: string;
  name: string;
  description: string;
  file: string;
  size_kb: number;
}

export interface SkillListResponse {
  skills: SkillInfoDto[];
}

export interface ToolResultDto {
  success: boolean;
  content: unknown;
  error: string | null;
  execution_ms: number;
  artifacts: string[];
}

export interface UserDto {
  id: string;
  username: string;
  role: "tester" | "admin" | string;
  created_at?: number;
  token?: string;
}

export interface LoginResponse {
  session_token: string;
  user: UserDto;
}

export type ToolCallLogType =
  | "THOUGHT"
  | "TOOL_CALL"
  | "TOOL_RES"
  | "SELF_HEAL"
  | "HARNESS_EVENT";

export interface HarnessSseEvent {
  type: ToolCallLogType;
  toolName?: string;
  content: string;
  status?: "running" | "success" | "warning" | "error";
  timestamp: string;
  [k: string]: unknown;
}

export interface SseDoneEvent {
  success: boolean;
  execution_id: string;
  total_ms: number;
  timestamp: string;
}

export interface ExecutionRow {
  id: string;
  user_id: string;
  intent: string;
  workflow_stage: 0 | 1 | 2;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_tokens_in: number;
  llm_tokens_out: number;
  started_at: number;
  finished_at?: number | null;
  total_ms: number;
  error_message?: string | null;
}

export interface ToolCallRow {
  id: string;
  execution_id: string;
  tool_name: string;
  params_json: string;
  success: 0 | 1;
  result_snippet?: string | null;
  artifacts_json?: string | null;
  started_at: number;
  execution_ms: number;
  error_message?: string | null;
}

export interface TestRecordDto {
  id: string;
  execution_id?: string | null;
  user_id?: string | null;
  case_name: string;
  format_type: "SINGLE" | "DOUBLE_PREGEN";
  module_id: string;
  base_batch: number;
  base_index: number;
  bonus_batch?: number | null;
  bonus_index?: number | null;
  file_name?: string | null;
  xml_snippet: string;
  created_at: number;
}

export interface ExecutionDetailResponse {
  execution: ExecutionRow;
  tool_calls: ToolCallRow[];
  records: TestRecordDto[];
}

export interface LLMAuditReq {
  provider: string;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
  success?: boolean;
}

// ─ HARNESS v2: Scenario / Pipeline / Execution Engine types ──

/** 测试场景定义 */
export interface TestScenario {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  agentFile: string;
  skills: string[];
  pipelineId: string;
  requiredPlugins: string[];
  icon: "zap" | "shield" | "bug" | "file-text" | "globe";
}

/** 流水线步骤定义 */
export interface PipelineStepDef {
  id: string;
  plugin: string;
  label: string;
  description?: string;
  dependsOn: string[];
  retryOnFail: boolean;
  maxRetries: number;
}

/** 流水线定义 */
export interface PipelineDef {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStepDef[][];
}

/** 步骤执行状态 */
export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "retrying"
  | "skipped";

/** 步骤执行记录 */
export interface StepExecutionRecord {
  stepId: string;
  plugin: string;
  label: string;
  status: StepStatus;
  retryCount: number;
  startedAt?: number;
  finishedAt?: number;
  resultSnippet?: string;
  error?: string;
}

/** 流水线执行状态 */
export type PipelineExecutionStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

/** 完整流水线执行上下文 */
export interface PipelineExecutionContext {
  scenarioId: string;
  pipelineId: string;
  status: PipelineExecutionStatus;
  currentStageIndex: number;
  currentStepIndex: number;
  steps: StepExecutionRecord[];
  startedAt?: number;
  finishedAt?: number;
  userIntent: string;
  extraParams: Record<string, unknown>;
}
