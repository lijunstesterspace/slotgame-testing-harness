export type WorkflowStage = 1 | 2 | 3 | 4 | 5;

export type WorkflowState = 
  | 'READY'         // Ready to generate
  | 'GENERATING'    // Active (streaming COT & tool calls)
  | 'REVIEW'        // Generation complete (TestData preview & download)
  | 'VERIFYING'     // Connecting to Game Environment & running verification
  | 'VERIFIED';      // Verification complete (Interactive verification report)

export interface SlotGameConfig {
  id: string;
  name: string;
  reels: string; // e.g. "5x3"
  paylines: number;
  moduleId: string;
  theme: string;
}

export interface ToolCallLog {
  id: string;
  timestamp: string;
  type: 'THOUGHT' | 'TOOL_CALL' | 'TOOL_RES' | 'SELF_HEAL' | 'HARNESS_EVENT';
  toolName?: string;
  content: string;
  detail?: string;
  status?: 'running' | 'success' | 'warning' | 'error';
}

export interface TaskItem {
  id: string;
  stage: 1 | 2;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface TestRecord {
  id: string;
  caseName: string;
  formatType: 'SINGLE' | 'DOUBLE_PREGEN';
  moduleID: string;
  stage: string;
  comment: string;
  baseBatch: number;
  baseIndex: number;
  bonusBatch?: number;
  bonusIndex?: number;
  fileName?: string;
  gamePrefix?: string;
  xmlSnippet: string;
  selected?: boolean;
}

export interface VerificationConfig {
  targetUrl: string;
  spinDelayMs: number;
  timeoutMs: number;
  autoRetryServerError: boolean;
  authToken?: string;
  loginName?: string;
  timeoutSeconds?: number;
  folderPath?: string;
  testdataFilePath?: string;
}

export interface TestdataFileInfo {
  name: string;
  path: string;
  size_kb: number;
  modified: number;
}

export interface VerificationResult {
  recordId: string;
  caseName: string;
  status: 'PASSED' | 'DISCREPANCY' | 'ERROR';
  passed: boolean;
  httpStatus: number;
  responseTimeMs: number;
  serverPayout?: number;
  batchIndexString: string;
  responseBodySnippet?: string;
  errorMessage?: string;
}

export interface VerificationReport {
  targetUrl: string;
  totalCases: number;
  passedCount: number;
  failedCount: number;
  totalTimeMs: number;
  passRate: number;
  executedAt: string;
  results: VerificationResult[];
  aiDiagnosis?: AIDiagnosisResult;
}

export interface AIDiagnosisResult {
  summary: string;
  failedDiagnoses: AIDiagnosis[];
  recommendations: string[];
  rawText?: string;
}

export interface AIDiagnosis {
  caseName: string;
  diagnosisType: string;
  title: string;
  severity: string;
  evidenceLogs: string[];
  recommendation: string;
  aiAnalysis?: string;
}

export type LlmProviderType = 'OLLAMA' | 'OPENAI' | 'ANTHROPIC' | 'CUSTOM';

export interface LlmProviderConfig {
  provider: LlmProviderType;
  baseUrl: string;
  apiKey?: string;
  selectedModel: string;
  availableModels: string[];
}

export interface LlmModelEntry {
  id: string;
  name: string;
  provider: LlmProviderType;
  baseUrl: string;
  apiKey?: string;
  selectedModel: string;
  availableModels: string[];
  isDefault: boolean;
  createdAt: string;
}
