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
  testdataFilePaths?: string[];  // Support multiple testdata files
  /** "harness" (default): drive a real Chrome via testdata_verifier_harness through the QA-only
   * Titan Harness launcher page — no Okta/MFA, keeps screenshots. "api": skip the browser
   * entirely and hit the game's own session/play APIs directly via testdata_verifier_api — needs
   * oktaAccessToken. See each tool's module docstring for the confirmed mechanism. */
  verificationMethod?: "api" | "harness";
  /** Okta JWT access_token (~2h validity), required when verificationMethod is "api". Bootstraps
   * the *game* session (api5-rhel1) — unrelated to axiomApiKey below. */
  oktaAccessToken?: string;
  /** Long-lived Axiom API Key (from Axiom's ApiKeys page), required when verificationMethod is
   * "api" or "harness". Authenticates the testdata upload call (axiomcore-app1) — rarely needs
   * repasting. */
  axiomApiKey?: string;
  /** Full Titan Harness launcher page URL, required when verificationMethod is "harness" — e.g.
   * https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/harness/apexDragonPowerComboV94 */
  harnessUrl?: string;
  /** Harness form's Product Id field, required when verificationMethod is "harness". Fixed per
   * game-module version, not derivable from the testdata file. */
  harnessProductId?: string;
  /** Harness form's Client Id field, required when verificationMethod is "harness". Fixed per
   * game-module version, not derivable from the testdata file. */
  harnessClientId?: string;
  /** Harness form's Brand field, optional when verificationMethod is "harness" — defaults to
   * "IslandParadise" server-side if left blank. */
  harnessBrand?: string;
}

export interface TestdataFileInfo {
  name: string;
  path: string;
  size_kb: number;
  modified: number;
}

export type VerificationStatus =
  | 'PASSED'
  | 'SEED_MISMATCH'
  | 'STAGE_MISMATCH'
  | 'PAYOUT_MISMATCH'
  | 'SEED_REJECTED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'DISCREPANCY'
  | 'ERROR';

export interface VerificationResult {
  recordId: string;
  caseName: string;
  status: VerificationStatus;
  passed: boolean;
  httpStatus: number;
  responseTimeMs: number;
  serverPayout?: number;
  batchIndexString: string;
  responseBodySnippet?: string;
  errorMessage?: string;
  /** Base64-encoded PNG screenshot captured after the spin */
  screenshotB64?: string;
  /** Whether this case triggered a bonus feature */
  isBonus?: boolean;
  /** Actual seed returned by the server */
  actualBatch?: number | null;
  actualIndex?: number | null;
  actualStage?: string;
  expectedBatch?: number;
  expectedIndex?: number;
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
  /** Server-relative URL for the standalone HTML verification report (with embedded
   * screenshots), if the backend produced one — see the verifier tools' report_url. */
  reportUrl?: string;
  /** Set only when the run produced zero cases because testdata_verifier errored out before
   * ever uploading/spinning (e.g. admin login timeout) — surfaced in the modal as a banner
   * instead of silently rendering an empty "0%, 0/0" report. See buildReportFromExecutionDetail
   * in verificationEngine.ts. */
  runError?: string;
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
