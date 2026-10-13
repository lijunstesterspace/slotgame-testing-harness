import React, { useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { PipelineVisualization } from "./components/PipelineVisualization";
import { ExecutionConsole } from "./components/ExecutionConsole";
import { TestDataPreview } from "./components/TestDataPreview";
import { VerificationReportModal } from "./components/VerificationReportModal";
import { LlmConfigModal } from "./components/LlmConfigModal";
import { LlmConfigPage } from "./pages/LlmConfigPage";
import { PluginPage } from "./pages/PluginPage";
import { AgentPage } from "./pages/AgentPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SlotGameConfig, WorkflowStage, WorkflowState, TaskItem, ToolCallLog, TestRecord, VerificationReport, VerificationConfig, TestdataFileInfo, LlmProviderConfig } from "./types";
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from "./mock/testData";
import { loadStoredLlmConfig, saveLlmConfig, loadStoredModels, getActiveModelConfig } from "./utils/llmGateway";
import { AlertCircle, Sparkles, Loader2, ChevronDown, ArrowUp, Square, RefreshCw, FileText, Plus, Folder } from "lucide-react";
import { runRealGameVerification } from "./utils/verificationEngine";
import { harnessClient, coerceTestRecords } from "./harness/client";
import type { TestRecordDto } from "./harness/sharedTypes";
import { PlannerAgent } from "./harness/plannerAgent";
import { ExecutionEngine, EngineCallbacks } from "./harness/executionEngine";
import { getPipeline } from "./harness/pipelineRegistry";
import { routeIntent, SCENARIOS, getScenarioSystemPrompt, getScenarioLiteSystemPrompt, isCasualChatMessage } from "./harness/intentRouter";

// No login in this build (see design doc §4.1) — the app opens straight into the Workbench.
export const App: React.FC = () => <Workbench />;

const STAGE1_TASKS: Record<string, TaskItem[]> = {
  testdata_generation: [
    { id: 't1-1', stage: 1, title: 'Intent Analysis', description: 'Parse natural language requirement and game constraints', status: 'pending' },
    { id: 't1-2', stage: 1, title: 'TestData Formatting', description: 'Format parsed paytable data into structured testdata XML', status: 'pending' },
    { id: 't1-3', stage: 1, title: 'Constraint Mapping', description: 'Map requirements to verification rules and boundary conditions', status: 'pending' },
  ],
  game_verification: [
    { id: 't1-1', stage: 1, title: 'Format Validation', description: 'Validate testdata XML structure, seed format and file integrity', status: 'pending' },
    { id: 't1-2', stage: 1, title: 'Game Payout Verification', description: 'Upload testdata to real game and verify actual payout matches expected values', status: 'pending' },
  ],
  easyhelp_checking: [
    { id: 't1-1', stage: 1, title: 'HTML to Text Conversion', description: 'Batch convert HTML help files to clean plain text', status: 'pending' },
    { id: 't1-2', stage: 1, title: 'Version Diff Comparison', description: 'Compare help file versions and highlight keyword differences', status: 'pending' },
    { id: 't1-3', stage: 1, title: 'HTML Report', description: 'Write the comparison report: keyword coverage per file and differences vs baseline', status: 'pending' },
    { id: 't1-4', stage: 1, title: 'AI Analysis of Report', description: 'Optional: local model summarizes the report and flags quality issues', status: 'pending' },
  ],
  portugal_plugin: [
    { id: 't1-1', stage: 1, title: 'Resolve Symbol Mapping', description: "Import the attached Output Guide (.md) or use the stored map for this module", status: 'pending' },
    { id: 't1-2', stage: 1, title: 'Fetch Outcome from PlayCheck', description: 'Log into the game, spin, open Game History and read the outcome string (skipped when pasted)', status: 'pending' },
    { id: 't1-3', stage: 1, title: 'Parse Portugal Plugin Output', description: 'Split spins, map symbols and total the win amount', status: 'pending' },
    { id: 't1-4', stage: 1, title: 'Consistency Check & Report', description: 'Flag symbol/row/parameter mismatches and write TXT/JSON/HTML reports', status: 'pending' },
  ],
};

// ── Scenario-specific Test Plan Items ──────────────────────────────────
const SCENARIO_TEST_ITEMS: Record<string, Array<{ id: string; name: string; description: string; selected: boolean }>> = {
  testdata_generation: [
    { id: "plan-1", name: "Base Game - Normal Spin", description: "Test normal spin outcomes and payouts", selected: true },
    { id: "plan-2", name: "Base Game - Max Bet", description: "Test maximum bet configuration", selected: true },
    { id: "plan-3", name: "Free Spins Trigger", description: "Test free spins feature activation", selected: true },
    { id: "plan-4", name: "Bonus Game Entry", description: "Test bonus game entry conditions", selected: false },
    { id: "plan-5", name: "Paytable Verification", description: "Verify all symbol payouts match paytable", selected: true },
  ],
  game_verification: [
    { id: "plan-1", name: "Format Validation", description: "Validate testdata XML structure, seed format and file integrity", selected: true },
    { id: "plan-2", name: "Game Payout Verification", description: "Upload testdata to real game and verify actual payout matches expected values", selected: true },
  ],
  easyhelp_checking: [
    { id: "plan-1", name: "HTML to Text Conversion", description: "Batch convert HTML help files to clean plain text", selected: true },
    { id: "plan-2", name: "Version Diff Comparison", description: "Compare help file versions and highlight keyword differences", selected: true },
    { id: "plan-3", name: "Keyword Extraction", description: "Extract and highlight key terms from help files", selected: true },
    { id: "plan-4", name: "AI Analysis Report", description: "Generate AI-powered analysis report using local model", selected: true },
    { id: "plan-5", name: "Excel Report Generation", description: "Package diff results into formatted Excel report", selected: false },
  ],
  portugal_plugin: [
    { id: "plan-map", name: "Symbol Mapping", description: "Attached Output Guide (.md) → validate + self-test on its examples; otherwise the stored map for the module", selected: true },
    { id: "plan-save", name: "Save Imported Mapping", description: "Keep an attached guide's map in symbol_profiles/<GAME>.json for later runs (untick = use it for this run only)", selected: true },
    { id: "plan-0", name: "Fetch Outcome from PlayCheck", description: "Game URL given: log in, spin, ••• → Game History → session → transaction → GetReportAsync", selected: true },
    { id: "plan-1", name: "Spin & Row Parsing", description: "Split N: spin blocks and map reel letters to SYM names", selected: true },
    { id: "plan-2", name: "Win Line Extraction", description: "Collect winning symbols/positions, bets, multipliers and win amounts", selected: true },
    { id: "plan-3", name: "Total Win Calculation", description: "Sum all MG win amounts (identical to ppvACCR1.0)", selected: true },
    { id: "plan-4", name: "Consistency Checks", description: "Flag unmapped symbols, row width and R/MV/MT/MG count mismatches", selected: true },
    { id: "plan-5", name: "PlayCheck Payout Check", description: "Fetched mode: sum(MG)/100 = PAYOUT, first MV/100 = WAGERED, and = game win", selected: true },
  ],
};

/**
 * portugal_plugin fetch mode: the game URL comes from the auto-detected URL line; optional
 * `key=value` tokens in the intent text override/complete it (a direct /launch/ URL already
 * carries username/moduleId/clientId/productId in its query, a /harness/ URL does not).
 */
const PORTUGAL_FETCH_KEYS: Record<string, string> = {
  username: "login_name", login: "login_name", loginname: "login_name",
  password: "harness_password",
  moduleid: "module_id", module: "module_id",
  productid: "product_id", product: "product_id",
  clientid: "client_id", client: "client_id",
  brand: "brand",
  spins: "spin_count", spin: "spin_count",
  session: "session_id", sessionid: "session_id",
  trans: "trans_number", transaction: "trans_number", transnumber: "trans_number",
};

function buildPortugalFetchParams(gameUrl: string, text: string, loginName: string): Record<string, unknown> {
  const out: Record<string, unknown> = { game_url: gameUrl };
  if (loginName.trim()) out.login_name = loginName.trim();
  for (const m of text.matchAll(/([A-Za-z]+)\s*=\s*(\S+)/g)) {
    const key = PORTUGAL_FETCH_KEYS[m[1].toLowerCase()];
    if (key) out[key] = m[2];
  }
  return out;
}

const MODEL_OPTIONS: { label: string; value: string }[] = [
  { label: "Ollama · llama3:7b (local)", value: "llama3:7b" },
  { label: "Ollama · qwen2.5:7b (local)", value: "qwen2.5:7b" },
  { label: "DeepSeek · deepseek-chat", value: "deepseek-chat" },
  { label: "OpenAI · gpt-4o-mini", value: "gpt-4o-mini" },
  { label: "Anthropic · claude-3-haiku", value: "claude-3-haiku" },
];

const Workbench: React.FC = () => {
  const [selectedGame] = useState<SlotGameConfig>(MOCK_GAME_CONFIGS[0]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [promptIntent, setPromptIntent] = useState("");
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(1);
  const [workflowState, setWorkflowState] = useState<WorkflowState>("READY");
  const [tasks, setTasks] = useState<TaskItem[]>(STAGE1_TASKS["testdata_generation"] ?? []);
  const [logs, setLogs] = useState<ToolCallLog[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [testRecords, setTestRecords] = useState<TestRecord[]>(INITIAL_TEST_RECORDS);
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"workbench" | "llm-config" | "plugin" | "agent" | "history">("workbench");
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(() => loadStoredLlmConfig().selectedModel);
  const [modelOpen, setModelOpen] = useState(false);
  const [loginName, setLoginName] = useState<string>("");
  const [folderPath, setFolderPath] = useState<string>("");
  const [uploadingFolder, setUploadingFolder] = useState(false);
  const [testdataFiles, setTestdataFiles] = useState<TestdataFileInfo[]>([]);
  const [selectedTestdataFiles, setSelectedTestdataFiles] = useState<TestdataFileInfo[]>([]);
  // game_verification: two selectable methods — call the game's own session/play APIs directly
  // over HTTP (testdata_verifier_api, needs a pasted Okta token), or drive a real Chrome through
  // the QA-only Titan Harness launcher page (testdata_verifier_harness, keeps screenshots, no
  // Okta/MFA). "selenium" (the real game URL + Okta/MFA + borrowed Chrome profile) is no longer
  // offered here — adopting the Harness login was specifically meant to retire that method's
  // repeated-login friction — but the type keeps the option so History can still reopen old
  // Selenium-based reports. Harness is now the default: fastest and most reliable of the three
  // (see testdata_verifier_harness_tool.py), and keeps screenshots unlike Direct API.
  const [verificationMethod, setVerificationMethod] = useState<"selenium" | "api" | "harness">("harness");
  const [oktaAccessToken, setOktaAccessToken] = useState<string>("");
  // Long-lived Axiom API Key (x-api-key) — authenticates the testdata upload call, used by both
  // "api" (alongside oktaAccessToken for the game-session/play calls) and "harness" (alongside
  // the harness form fields below). See testdata_verifier_api_tool.py's module docstring for why
  // this is unrelated to Okta.
  const [axiomApiKey, setAxiomApiKey] = useState<string>("");
  // "harness" method only — see testdata_verifier_harness_tool.py's module docstring. Username
  // and Module Id are NOT collected here: they're derived server-side from the testdata file's
  // own <Key> element, since a harness login always targets whatever account/module the testdata
  // was generated for.
  const [harnessUrl, setHarnessUrl] = useState<string>("");
  const [harnessProductId, setHarnessProductId] = useState<string>("");
  const [harnessClientId, setHarnessClientId] = useState<string>("");
  const [harnessBrand, setHarnessBrand] = useState<string>("");
  const folderUploadInputRef = useRef<HTMLInputElement>(null);
  // easyhelp_checking's "Add file(s)" alternative: loose HTML files with no folder structure —
  // each gets a synthetic subdir derived from its filename (see uploadFilesAsFolder).
  const helpFilesFlatUploadInputRef = useRef<HTMLInputElement>(null);
  // Attach ("+") for testdata_generation: read a local paytable text/CSV file client-side and
  // fold its content into the intent box — no backend round-trip needed for this one.
  const rawTextUploadInputRef = useRef<HTMLInputElement>(null);
  // portugal_plugin: the game's symbol Output Guide (.md) attached with "+", kept apart from the
  // outcome text in the input box.
  const [symbolGuide, setSymbolGuide] = useState<{ name: string; text: string } | null>(null);
  const [uploadingRawText, setUploadingRawText] = useState(false);
  // game_verification's "Add folder" alternative: pick an entire directory of .testdata files
  // at once instead of multi-selecting them (same upload-testdata endpoint either way).
  const testdataFolderUploadInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Set as soon as a game_verification run's execution_id is known (see runRealGameVerification's
  // onStarted callback) so handleStop has something to send a real cancel request for — that
  // flow has no AbortController of its own since the actual work runs server-side (Selenium).
  const verificationExecutionIdRef = useRef<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("testdata_generation");
  
  // Test plan preview state
  const [showPreview, setShowPreview] = useState(false);
  const [plannedTests, setPlannedTests] = useState<Array<{id: string; name: string; description: string; selected: boolean}>>([]);

  // ── Simple dialogue state (AI clarifies ONE missing free-text field; it never
  // decides pipeline order — see PlannerAgent.clarify()) ──
  const [clarifyState, setClarifyState] = useState<{ field: "rawText" | "folderPath"; question: string } | null>(null);
  const [clarifyReply, setClarifyReply] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const chime = () => {
    if (isMuted) return;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.3);
      setTimeout(() => ctx.close(), 500);
    } catch {}
  };

  const addLog = (log: Omit<ToolCallLog, "id" | "timestamp">) => {
    setLogs((prev) => [
      ...prev,
      { ...log, id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toLocaleTimeString() },
    ]);
  };

  // Drives the fixed Pipeline (pipelineRegistry.ts) via ExecutionEngine — the engine decides
  // step order, not the AI. These callbacks just mirror engine progress into the log panel + task list.
  const engineCallbacks = useMemo<EngineCallbacks>(() => ({
    onStepChange: (ctx) => {
      setTasks((prev) => prev.map((t, i) => {
        const step = ctx.steps[i];
        if (!step) return t;
        const status: TaskItem["status"] =
          step.status === "success" ? "completed"
          : step.status === "failed" ? "failed"
          : (step.status === "running" || step.status === "retrying") ? "active"
          : "pending";
        return { ...t, status };
      }));
    },
    onStepComplete: (stepId, result) => {
      chime();
      addLog({
        type: "TOOL_RES",
        toolName: stepId,
        content: stepId,
        detail: JSON.stringify(result.content, null, 2).slice(0, 2000),
        status: "success",
      });
    },
    onStepFail: (stepId, error) => {
      addLog({ type: "TOOL_RES", toolName: stepId, content: stepId, detail: error, status: "error" });
      // TOOL_RES only shows under "Tool Payloads"; echo the reason in the main COT log too
      addLog({ type: "HARNESS_EVENT", content: `Step "${stepId}" failed: ${error}`, status: "error" });
    },
    onStatusChange: () => {},
    onLog: (message) => addLog({ type: "HARNESS_EVENT", content: message }),
  }), [isMuted]);

  const toFrontendRecords = (dtos: TestRecordDto[]): TestRecord[] =>
    dtos.map((d) => ({
      id: d.id,
      caseName: d.case_name,
      formatType: d.format_type,
      moduleID: d.module_id,
      stage: d.bonus_batch != null ? "Bonus" : "Base",
      comment: "",
      baseBatch: d.base_batch,
      baseIndex: d.base_index,
      bonusBatch: d.bonus_batch ?? undefined,
      bonusIndex: d.bonus_index ?? undefined,
      fileName: d.file_name ?? undefined,
      xmlSnippet: d.xml_snippet,
    }));

  // ── URL type detection helpers ──────────────────────────────────
  const isGoogleSheetUrl = (url: string) =>
    /docs\.google\.com\/spreadsheets/i.test(url);
  const isGameUrl = (url: string) =>
    /htmlGames|launch\/mgs|gameId=/i.test(url);

  // Step 1: Show preview of planned tests
  const handleShowPreview = () => {
    if (!promptIntent.trim()) {
      setError("Please describe your test task first");
      return;
    }

    // URL type validation: detect mismatch between input and scenario
    if (sheetUrl.trim()) {
      if (selectedScenarioId === 'testdata_generation' && isGameUrl(sheetUrl)) {
        setError('The first input box only accepts Google Sheet URLs (docs.google.com/spreadsheets). Game URLs are not supported here. Please switch to "TestData Verification" scenario for game URLs.');
        return;
      }
      if (selectedScenarioId === 'game_verification' && isGoogleSheetUrl(sheetUrl)) {
        setError('The first input box expects a Game URL for verification. Please enter the real game environment URL.');
        return;
      }
    }

    // Automatic intent routing: match a scenario from user input
    // Only override the user's manually selected scenario when the routing score is very high (>100), to avoid misclassification
    let effectiveScenarioId = selectedScenarioId;
    const routeResult = routeIntent(promptIntent);
    if (routeResult && routeResult.scenario.id !== selectedScenarioId && routeResult.matchScore > 100) {
      effectiveScenarioId = routeResult.scenario.id;
      setSelectedScenarioId(effectiveScenarioId);
      addLog({
        type: "HARNESS_EVENT",
        content: `Auto-routed to scenario: ${routeResult.scenario.label} (keywords: ${routeResult.matchedKeywords.join(", ")}, score: ${routeResult.matchScore})`,
      });
    }
    // Generate planned test items based on selected scenario
    const tests = SCENARIO_TEST_ITEMS[effectiveScenarioId];
    if (!tests) {
      setError(`No test plan defined for scenario: ${effectiveScenarioId}`);
      return;
    }
    setPlannedTests(tests.map(t => ({ ...t })));
    setShowPreview(true);
  };

  // Step 2: Confirm and start generation with selected tests
  const handleConfirmGeneration = async () => {
    const selectedTests = plannedTests.filter(t => t.selected);
    if (selectedTests.length === 0) {
      setError("Please select at least one test item");
      return;
    }

    // For game_verification, call verification directly
    if (selectedScenarioId === 'game_verification') {
      if (selectedTestdataFiles.length === 0) {
        setError("Please select at least one testdata file");
        return;
      }
      if (verificationMethod === 'api' && !oktaAccessToken.trim()) {
        setError("API-direct method needs an Okta access_token — paste one in below, or switch to Harness.");
        return;
      }
      if (verificationMethod === 'api' && !axiomApiKey.trim()) {
        setError("API-direct method needs an Axiom API Key — paste one in below, or switch to Harness.");
        return;
      }
      if (verificationMethod === 'harness' && !harnessUrl.trim()) {
        setError("Harness method needs the Titan Harness launcher page URL — paste one in below.");
        return;
      }
      if (verificationMethod === 'harness' && !axiomApiKey.trim()) {
        setError("Harness method needs an Axiom API Key — paste one in below.");
        return;
      }
      if (verificationMethod === 'harness' && (!harnessProductId.trim() || !harnessClientId.trim())) {
        setError("Harness method needs the harness form's Product Id and Client Id — fill both in below.");
        return;
      }
      setShowPreview(false);

      // Pass all selected files to verification engine
      await handleStartVerification({
        targetUrl: sheetUrl,
        spinDelayMs: 3000,
        timeoutMs: 5000,
        // runRealGameVerification actually reads `timeoutSeconds` (not `timeoutMs` above, which
        // is dead — nothing reads it) to decide how long to keep waiting on the backend before
        // giving up and reporting "no result data". It must comfortably exceed
        // testdata_verifier's own admin_login_timeout_sec (default 240s — a human may still be
        // completing SSO + Okta Verify) plus real spin time, or the frontend times out and gives
        // up *before* a run that would have genuinely succeeded ever gets to finish.
        timeoutSeconds: 600,
        autoRetryServerError: true,
        loginName,
        folderPath,
        testdataFilePaths: selectedTestdataFiles.map(f => f.path),
        verificationMethod,
        oktaAccessToken: verificationMethod === 'api' ? oktaAccessToken.trim() : undefined,
        axiomApiKey: verificationMethod === 'api' || verificationMethod === 'harness' ? axiomApiKey.trim() : undefined,
        harnessUrl: verificationMethod === 'harness' ? harnessUrl.trim() : undefined,
        harnessProductId: verificationMethod === 'harness' ? harnessProductId.trim() : undefined,
        harnessClientId: verificationMethod === 'harness' ? harnessClientId.trim() : undefined,
        harnessBrand: verificationMethod === 'harness' && harnessBrand.trim() ? harnessBrand.trim() : undefined,
      });
      return;
    }

    // For other scenarios, use the fixed pipeline (ExecutionEngine + pipelineRegistry.ts)
    setShowPreview(false);

    const missing = checkMissingField(selectedScenarioId);
    if (missing) {
      await startClarifyFlow(missing as { field: "rawText" | "folderPath"; message: string });
      return;
    }

    await runPipeline();
  };

  /**
   * Deterministic, code-only precondition check per scenario — decides WHETHER a required
   * free-text field is missing, never what to do about it. If something is missing, the AI is
   * only used to phrase ONE clarifying question (see startClarifyFlow); the pipeline itself is
   * still driven entirely by ExecutionEngine once the field is filled.
   */
  const checkMissingField = (
    scenarioId: string,
  ): { field: "rawText" | "folderPath"; message: string } | null => {
    if (scenarioId === "testdata_generation") {
      if (!/\d+\s*,\s*\d+/.test(promptIntent)) {
        return { field: "rawText", message: "raw paytable rows in 'batch,index' format (paste the Google Sheet rows directly)" };
      }
    } else if (scenarioId === "portugal_plugin") {
      if (!/\d+\s*:/.test(promptIntent) && !/^https?:\/\//i.test(sheetUrl.trim())) {
        return { field: "rawText", message: "either the Portugal Plugin output string (e.g. '1:A;B#C;D#R#A#POS1#MV#10#MT#2#MG#5.0') or the game harness / launch URL to fetch it from PlayCheck" };
      }
    } else if (scenarioId === "easyhelp_checking") {
      if (!folderPath.trim()) {
        return { field: "folderPath", message: "the absolute folder path containing the HTML help files to convert" };
      }
    }
    return null;
  };

  /** AI asks ONE short clarifying question (simple dialogue interaction); bounded to a single round. */
  const startClarifyFlow = async (missing: { field: "rawText" | "folderPath"; message: string }) => {
    setIsGenerating(true);
    setError(null);
    const fallback = `Looks like I'm missing ${missing.message}. Could you provide that?`;
    try {
      const planner = new PlannerAgent({ ...llmConfig, selectedModel });
      const scenarioContext = getScenarioSystemPrompt(selectedScenarioId);
      const question = await planner.clarify(
        scenarioContext,
        `Missing: ${missing.message}. The user's original intent was: "${promptIntent || "(empty)"}". ` +
          "Write ONE short, friendly question (max 2 sentences) asking the user to provide this.",
      );
      const q = question || fallback;
      setClarifyState({ field: missing.field, question: q });
      addLog({ type: "HARNESS_EVENT", content: `AI asked: ${q}` });
    } catch (e: any) {
      setClarifyState({ field: missing.field, question: fallback });
      addLog({ type: "HARNESS_EVENT", content: `AI asked (fallback, LLM unavailable: ${e?.message ?? e}): ${fallback}`, status: "warning" });
    } finally {
      setIsGenerating(false);
    }
  };

  /** User answers the clarifying question. The reply is routed to the exact field that asked for
   * it — deterministic, not reinterpreted by the AI — then the pipeline runs (single round, no
   * open-ended back-and-forth). */
  const handleClarifySubmit = async () => {
    if (!clarifyState) return;
    const reply = clarifyReply.trim();
    addLog({ type: "HARNESS_EVENT", content: `User replied: ${reply || "(empty)"}` });
    if (reply) {
      if (clarifyState.field === "rawText") {
        setPromptIntent((prev) => (prev ? `${prev}\n${reply}` : reply));
      } else if (clarifyState.field === "folderPath") {
        setFolderPath(reply);
      }
    }
    setClarifyState(null);
    setClarifyReply("");
    await runPipeline();
  };

  const handleClarifyCancel = () => {
    setClarifyState(null);
    setClarifyReply("");
  };

  /**
   * Enter key in the intent box = simple dialogue (bucket 1 of the AI's role, design doc
   * §1.2/§10.7/§11) — a casual back-and-forth with the model, logged to the console. It never
   * decides pipeline order or submits a test task; that stays the arrow button's job.
   */
  const handleChatMessage = async () => {
    const message = promptIntent.trim();
    if (!message || chatLoading || isGenerating) return;
    setPromptIntent("");
    addLog({ type: "HARNESS_EVENT", content: `You: ${message}` });
    setChatLoading(true);
    try {
      const planner = new PlannerAgent({ ...llmConfig, selectedModel });
      // Plain small talk ("hello") doesn't need the full Agent+Skill domain context — that's
      // several KB the local model would otherwise have to re-process just to say hi back. Any
      // real task description still gets the full prompt so the AI stays grounded in the
      // scenario's actual rules.
      const scenarioContext = isCasualChatMessage(message)
        ? getScenarioLiteSystemPrompt(selectedScenarioId)
        : getScenarioSystemPrompt(selectedScenarioId);
      const reply = await planner.clarify(scenarioContext, message);
      addLog({ type: "HARNESS_EVENT", content: `AI: ${reply || "(no response)"}` });
    } catch (e: any) {
      addLog({ type: "HARNESS_EVENT", content: `AI chat unavailable: ${e?.message ?? e}`, status: "warning" });
    } finally {
      setChatLoading(false);
    }
  };

  /** Drives the fixed pipeline for the currently selected scenario via ExecutionEngine. */
  const runPipeline = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    if (workflowStage >= 1) setWorkflowStage(2);
    setWorkflowState("GENERATING");
    setTasks((prev) => prev.map((t) => (t.id === "t1-1" ? { ...t, status: "active" } : t)));

    // Create AbortController for this run
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const scenario = SCENARIOS.find((s) => s.id === selectedScenarioId);
      const pipeline = scenario ? getPipeline(scenario.pipelineId) : undefined;
      if (!scenario || !pipeline) {
        throw new Error(`No fixed pipeline registered for scenario: ${selectedScenarioId}`);
      }

      const plannerCfg = { ...llmConfig, selectedModel };
      const planner = new PlannerAgent(plannerCfg);
      if (planner.complianceRisk) {
        addLog({
          type: "HARNESS_EVENT",
          content: `External Provider ${plannerCfg.provider} enabled — verify compliance (API Key stored locally)`,
          status: "warning",
        });
      }

      const executionId = await harnessClient.newExecution({
        intent: promptIntent,
        workflowStage: 1,
        llmProvider: planner.providerType,
        llmModel: selectedModel,
      });

      // Build this scenario's fixed-pipeline kickoff params from actual UI state.
      // The pipeline (pipelineRegistry.ts) — not the AI — decides which plugin consumes what.
      const extraParams: Record<string, unknown> = { executionId, loginName };
      if (selectedScenarioId === "testdata_generation") {
        extraParams.rawText = promptIntent;
        extraParams.gamePrefix = "P5P";
        extraParams.moduleId = "105359";
      } else if (selectedScenarioId === "portugal_plugin") {
        const pasted = /\d+\s*:/.test(promptIntent);
        extraParams.rawText = pasted ? promptIntent : "";
        // Stage 0 (symbol mapping) needs the module under test before any browser work:
        // moduleId=… typed in the box wins, else the game URL's own moduleId query parameter.
        let urlModule = "";
        try {
          urlModule = sheetUrl.trim() ? new URL(sheetUrl.trim()).searchParams.get("moduleId") ?? "" : "";
        } catch { /* not a URL */ }
        extraParams.moduleId = promptIntent.match(/moduleId\s*=\s*(\d+)/i)?.[1] ?? urlModule;
        extraParams.mappingGameCode = promptIntent.match(/gameCode\s*=\s*([A-Za-z0-9]+)/i)?.[1] ?? "";
        extraParams.guideMarkdown = symbolGuide?.text ?? "";
        extraParams.guideFileName = symbolGuide?.name ?? "";
        extraParams.saveMapping = plannedTests.find((t) => t.id === "plan-save")?.selected ?? true;
        if (!pasted) {
          extraParams.fetchParams = buildPortugalFetchParams(sheetUrl.trim(), promptIntent, loginName);
          // Stop must be able to kill the backend's Chrome, same as game_verification
          verificationExecutionIdRef.current = executionId;
        }
      } else if (selectedScenarioId === "easyhelp_checking") {
        extraParams.sourceFolder = folderPath;
        extraParams.outputFolder = folderPath ? `${folderPath}\\_easyhelp_output` : "";
        extraParams.keywords = promptIntent.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
        // Analyze with the model picked in the UI; only meaningful when the provider is the local Ollama
        if (plannerCfg.provider === "OLLAMA") {
          extraParams.ollamaModel = selectedModel;
          extraParams.ollamaBaseUrl = plannerCfg.baseUrl;
        }
      }

      addLog({ type: "HARNESS_EVENT", content: `Running fixed pipeline "${pipeline.name}" (${pipeline.stages.length} stage(s))` });

      const engine = new ExecutionEngine(harnessClient, engineCallbacks);
      const finalCtx = await engine.run(pipeline, selectedScenarioId, promptIntent, extraParams, controller.signal);
      if (finalCtx.status !== "completed") {
        throw new Error(`Pipeline ended with status: ${finalCtx.status}`);
      }

      const stepResults = engine.getStepResults();

      // testdata_generation's "parse" step emits records for the TestData Preview panel.
      const parseOutput = stepResults.parse as { records?: Record<string, unknown>[] } | undefined;
      if (parseOutput?.records?.length) {
        const recs = coerceTestRecords(parseOutput.records, executionId);
        await harnessClient.saveRecords(recs as unknown as Parameters<typeof harnessClient.saveRecords>[0]).catch(() => {});
        setTestRecords(toFrontendRecords(recs));
      }

      // portugal_plugin stage 0: which symbol map was used, and — for an imported guide — what changed.
      const mapping = stepResults.resolve_symbol_map as
        | {
            mode: "imported" | "stored" | "default"; game_code: string; title: string; module_ids: string[];
            letter_count: number; saved?: boolean; saved_path?: string; unchanged?: boolean; existing?: boolean;
            diff?: { added: Record<string, string>; removed: Record<string, string>; changed: Record<string, { from: string; to: string }> };
            warnings?: string[]; examples?: Array<{ total_win: number; unmapped_letters: string[] }>;
          }
        | undefined;
      if (mapping) {
        const who = `${mapping.game_code} (${mapping.title}, module ${mapping.module_ids.join("/") || "?"}, ${mapping.letter_count} letters)`;
        if (mapping.mode !== "imported") {
          addLog({
            type: "HARNESS_EVENT",
            content: mapping.mode === "stored"
              ? `Symbol map: stored profile ${who}`
              : `Symbol map: no moduleId given — using the built-in ${who} table (add moduleId=… or attach the game's guide)`,
            status: mapping.mode === "stored" ? "success" : "warning",
          });
        } else if (mapping.diff) {
          const { added, removed, changed } = mapping.diff;
          const fmt = (o: Record<string, unknown>) => Object.keys(o).join(", ") || "none";
          addLog({
            type: "HARNESS_EVENT",
            content:
              `Symbol map imported from guide: ${who}. ` +
              (mapping.unchanged ? "Identical to the stored profile."
                : `${mapping.existing ? "Changes vs stored" : "New profile"} — added: ${fmt(added)}; changed: ${fmt(changed)}; removed: ${fmt(removed)}. ` +
                  (mapping.saved ? `Saved to ${mapping.saved_path}` : "Used for this run only (Save Imported Mapping unticked).")),
            status: "success",
          });
          for (const [letter, c] of Object.entries(changed)) {
            addLog({ type: "HARNESS_EVENT", content: `  ${letter}: ${c.from} → ${c.to}`, status: "warning" });
          }
          const examples = mapping.examples ?? [];
          const bad = examples.filter((e) => e.unmapped_letters.length).length;
          addLog({
            type: "HARNESS_EVENT",
            content: `Guide self-test: ${examples.length} example string(s) parsed, ${bad} with letters missing from the table.`,
            status: bad ? "error" : "success",
          });
          for (const w of mapping.warnings ?? []) addLog({ type: "HARNESS_EVENT", content: `Warning: ${w}`, status: "warning" });
        }
      }

      // portugal_plugin: surface the headline numbers and report links in the console.
      const portugalPlugin = stepResults.report_portugal_plugin as
        | {
            spin_count: number; total_win: number; verdict: string; finding_count: number; txt_url: string; html_url: string;
            playcheck_checks?: Array<{ check: string; passed: boolean; message: string }>;
          }
        | undefined;
      const fetched = stepResults.fetch_portugal_plugin as
        | { source: string; session_id?: string; trans_number?: number }
        | undefined;
      if (fetched?.source === "playcheck") {
        addLog({ type: "HARNESS_EVENT", content: `Fetched from PlayCheck: session ${fetched.session_id}, transaction ${fetched.trans_number}` });
      }
      for (const c of portugalPlugin?.playcheck_checks ?? []) {
        addLog({ type: "HARNESS_EVENT", content: `${c.passed ? "PASS" : "FAIL"} ${c.check}: ${c.message}`, status: c.passed ? "success" : "error" });
      }
      if (portugalPlugin) {
        const fileOf = (url: string) => url.split("/").pop() ?? "";
        addLog({
          type: "HARNESS_EVENT",
          content:
            `Portugal Plugin: ${portugalPlugin.spin_count} spin(s), Total Win Amount ${portugalPlugin.total_win.toFixed(2)}, ` +
            `verdict ${portugalPlugin.verdict} (${portugalPlugin.finding_count} finding(s)). ` +
            `Report: ${harnessClient.artifactUrl(fileOf(portugalPlugin.html_url))} · Text: ${harnessClient.artifactUrl(fileOf(portugalPlugin.txt_url))}`,
          status: portugalPlugin.verdict === "CLEAN" ? "success" : portugalPlugin.verdict === "FAIL" ? "error" : "warning",
        });
      }

      // easyhelp_checking: the HTML report always exists; the AI analysis only if the local model answered.
      const helpReport = stepResults.report as
        | { report_html_path: string; files_count: number; changed_count: number; missing_keywords: string[] }
        | undefined;
      if (helpReport) {
        addLog({
          type: "HARNESS_EVENT",
          content:
            `Helpfile report: ${helpReport.files_count} file(s), ${helpReport.changed_count} differ from baseline` +
            (helpReport.missing_keywords.length ? `, keyword gaps: ${helpReport.missing_keywords.join(", ")}` : "") +
            `. Report: ${helpReport.report_html_path}`,
          status: helpReport.missing_keywords.length ? "warning" : "success",
        });
        const aiReport = stepResults.analyze as { report_html_path: string; model_used: string } | undefined;
        addLog(aiReport
          ? { type: "HARNESS_EVENT", content: `AI analysis (${aiReport.model_used}): ${aiReport.report_html_path}`, status: "success" }
          : { type: "HARNESS_EVENT", content: "AI analysis skipped — the HTML report above is complete without it.", status: "warning" });
      }

      // The real work (parse/generate/package etc.) is already done — let the user see
      // "completed" immediately. The AI summary below is decorative and must never make
      // them wait on a slow/cold-starting LLM for something that already succeeded.
      setWorkflowState("REVIEW");
      setWorkflowStage(3);
      setTasks((prev) => prev.map((t) => (t.status === "active" || t.status === "pending" ? { ...t, status: "completed" } : t)));

      // Best-effort analysis-report generation (bucket 3 of the AI's role) over the last step's
      // result — fire-and-forget, appends to the log whenever it resolves. Never blocks pipeline
      // success if the LLM is unavailable, misconfigured, or just slow.
      const lastStage = pipeline.stages[pipeline.stages.length - 1];
      const lastStep = lastStage[lastStage.length - 1];
      const lastResult = stepResults[lastStep.id];
      // easyhelp_checking already ran its own AI step; don't stack a second LLM summary on top
      if (lastResult !== undefined && selectedScenarioId !== "easyhelp_checking") {
        planner
          .summarizeStepResult(getScenarioSystemPrompt(selectedScenarioId), lastStep.label, lastResult, controller.signal)
          .then((summary) => {
            if (summary) addLog({ type: "HARNESS_EVENT", content: `AI summary: ${summary}` });
          })
          .catch((e: any) => {
            addLog({ type: "HARNESS_EVENT", content: `AI summary unavailable: ${e?.message ?? e}`, status: "warning" });
          });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        addLog({ type: "HARNESS_EVENT", content: " Execution stopped by user.", status: "warning" });
      } else {
        setError(e?.message ?? String(e));
      }
      setWorkflowState("READY");
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      if (selectedScenarioId === "portugal_plugin") verificationExecutionIdRef.current = null;
    }
  };

  // Stop the current execution
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (verificationExecutionIdRef.current) {
      const eid = verificationExecutionIdRef.current;
      addLog({ type: "HARNESS_EVENT", content: "Stop requested — cancelling the running browser verification...", status: "warning" });
      harnessClient.cancelExecution(eid).catch((e: any) => {
        addLog({ type: "HARNESS_EVENT", content: `Cancel request failed: ${e?.message ?? e}`, status: "warning" });
      });
    }
  };

  const handleRegenerate = () => {
    setWorkflowStage(2);
    setWorkflowState("GENERATING");
    setTasks((prev) => prev.map((t) => ({ ...t, status: t.stage === 1 ? "completed" : "pending" })));
    setTestRecords(INITIAL_TEST_RECORDS);
    setTimeout(() => setWorkflowState("REVIEW"), 1500);
  };

  const handleReset = () => {
    setWorkflowStage(1);
    setWorkflowState("READY");
    setTasks((STAGE1_TASKS["testdata_generation"] ?? []).map(t => ({ ...t })));
    setLogs([]);
    setTestRecords(INITIAL_TEST_RECORDS);
    setVerificationReport(null);
    setPromptIntent("");
    setSheetUrl("");
    setError(null);
    setSelectedScenarioId("testdata_generation");
    setFolderPath("");
    setTestdataFiles([]);
    setSelectedTestdataFiles([]);
    setSymbolGuide(null);
  };

  const handleSaveLlmConfig = (cfg: LlmProviderConfig) => {
    setLlmConfig(cfg);
    setSelectedModel(cfg.selectedModel);
    saveLlmConfig(cfg);
    addLog({ type: "HARNESS_EVENT", content: `LLM Provider switched to ${cfg.provider} · ${cfg.selectedModel}`, status: "success" });
  };

  const handleOpenModelPage = () => setPage("llm-config");
  const handleOpenPluginPage = () => setPage("plugin");
  const handleOpenAgentPage = () => setPage("agent");
  const handleOpenHistoryPage = () => setPage("history");

  // ── Folder upload (easyhelp_checking): browsers never expose a folder's absolute path, only
  // its files' *content* (plus each file's relative path via webkitRelativePath). So we upload
  // the content and let the backend recreate the subdir/index.html structure at a real path —
  // no manual path typing, no "please paste the path" system alert. ──
  const handleSelectFolderUpload = () => folderUploadInputRef.current?.click();
  const handleSelectHelpFilesFlat = () => helpFilesFlatUploadInputRef.current?.click();

  /** Shared by both easyhelp_checking upload modes — only how each file's relative path is
   * derived differs (a real folder pick already has one; loose files get a synthetic one). */
  const uploadFilesAsFolder = async (files: FileList, filenameFor: (f: File) => string) => {
    setUploadingFolder(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f, filenameFor(f));
      const res = await fetch("/api/tools/upload-folder", { method: "POST", body: form });
      if (res.ok) {
        const data = await res.json();
        setFolderPath(data.folder || "");
        if (!data.count) {
          setError("No files were recognized (expected help files with index.html, or loose HTML files).");
        }
      } else {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        setError(`Upload failed: ${err.detail ?? "Unknown error"}`);
      }
    } catch (err: any) {
      setError(`Network error: ${err?.message ?? "Unknown error"}. Is the backend server running?`);
    } finally {
      setUploadingFolder(false);
    }
  };

  const handleFolderFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFilesAsFolder(files, (f) => (f as any).webkitRelativePath || f.name);
    e.target.value = "";
  };

  const handleHelpFilesFlatChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // No real folder structure — synthesize one so the backend's "drop the first segment,
    // keep subdir/filename" rule still lands each file at <stem>/index.html.
    await uploadFilesAsFolder(files, (f) => `upload/${f.name.replace(/\.[^/.]+$/, "")}/index.html`);
    e.target.value = "";
  };

  // ── TestData file upload (game_verification): the browser gives us file *content*, never an
  // absolute path, so we upload the content and let the backend stage it to a real path that
  // Selenium can hand to the admin panel's upload dialog. No manual path typing required. ──
  const testdataUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingTestdata, setUploadingTestdata] = useState(false);
  const handleSelectTestdataFiles = () => testdataUploadInputRef.current?.click();

  const handleTestdataFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingTestdata(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/tools/upload-testdata", { method: "POST", body: form });
      if (res.ok) {
        const data = await res.json();
        setTestdataFiles(data.files || []);
        setSelectedTestdataFiles(data.files || []);
        setFolderPath(data.folder || "");
        if (!data.files?.length) {
          setError("None of the selected files were recognized as .testdata files.");
        }
      } else {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        setError(`Upload failed: ${err.detail ?? "Unknown error"}`);
        setTestdataFiles([]);
        setSelectedTestdataFiles([]);
      }
    } catch (err: any) {
      setError(`Network error: ${err?.message ?? "Unknown error"}. Is the backend server running?`);
      setTestdataFiles([]);
      setSelectedTestdataFiles([]);
    } finally {
      setUploadingTestdata(false);
      e.target.value = "";
    }
  };

  // ── Raw-text file upload (testdata_generation): purely client-side — a local paytable
  // text/CSV file's content is just folded into the intent box, no backend round-trip needed. ──
  const handleSelectRawTextFile = () => rawTextUploadInputRef.current?.click();

  const handleRawTextFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingRawText(true);
    setError(null);
    try {
      const text = await file.text();
      // portugal_plugin: a symbol Output Guide (.md with the 'Corresponding letter' table) is kept
      // as its own attachment — its example strings ('0:a;p;k…') must not be mistaken for the
      // outcome under test. Google Docs' Markdown export appends every image as a base64 line;
      // those are dropped (the backend strips them too).
      if (selectedScenarioId === "portugal_plugin" && /corresponding\s+letter/i.test(text)) {
        const guide = text.replace(/^\[image\d+\]:\s*<data:[^>]*>\s*$/gm, "").replace(/\n{3,}/g, "\n\n");
        setSymbolGuide({ name: file.name, text: guide });
        addLog({ type: "HARNESS_EVENT", content: `Symbol mapping guide attached: ${file.name}`, status: "success" });
        return;
      }
      setPromptIntent((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    } catch (err: any) {
      setError(`Failed to read file: ${err?.message ?? "Unknown error"}`);
    } finally {
      setUploadingRawText(false);
      e.target.value = "";
    }
  };

  /** The "+" attach button is a persistent, general "import test data" affordance — same
   * position/style in every scenario. Clicking it opens a small menu (à la Claude's "+") with
   * "Add file(s)" / "Add folder"; which underlying picker each one opens depends on what the
   * current scenario's fixed pipeline actually consumes. */
  const folderModeAvailable = selectedScenarioId === "game_verification" || selectedScenarioId === "easyhelp_checking";

  const handleAttachFileMode = () => {
    setAttachMenuOpen(false);
    if (selectedScenarioId === "game_verification") handleSelectTestdataFiles();
    else if (selectedScenarioId === "easyhelp_checking") handleSelectHelpFilesFlat();
    else handleSelectRawTextFile(); // testdata_generation (and any future scenario's default)
  };

  const handleAttachFolderMode = () => {
    setAttachMenuOpen(false);
    if (selectedScenarioId === "game_verification") testdataFolderUploadInputRef.current?.click();
    else if (selectedScenarioId === "easyhelp_checking") handleSelectFolderUpload();
  };

  const attaching = uploadingTestdata || uploadingFolder || uploadingRawText;
  const attachBadgeCount =
    selectedScenarioId === "game_verification" ? testdataFiles.length
    : selectedScenarioId === "easyhelp_checking" ? (folderPath ? 1 : 0)
    : selectedScenarioId === "portugal_plugin" ? (symbolGuide ? 1 : 0)
    : 0;
  const attachTitle =
    selectedScenarioId === "game_verification"
      ? (testdataFiles.length > 0 ? `${testdataFiles.length} .testdata file(s) attached — click to change` : "Attach .testdata file(s) or a folder to verify")
    : selectedScenarioId === "easyhelp_checking"
      ? (folderPath ? "Folder attached — click to change" : "Attach help files or a folder")
    : selectedScenarioId === "portugal_plugin"
      ? (symbolGuide ? `Symbol guide attached: ${symbolGuide.name} — click to replace` : "Attach the game's Output Guide (.md) for its symbol mapping, or an outcome text file")
      : "Attach a local paytable text/CSV file";

  // ── Verification handler ──────────────────────────────────────
  const handleStartVerification = async (config: VerificationConfig) => {
    setWorkflowState("VERIFYING");
    setWorkflowStage(4);
    setIsGenerating(true);
    setError(null);
    setLogs([]);
    const fileCount = config.testdataFilePaths?.length ?? 1;
    addLog({ type: "HARNESS_EVENT", content: `Starting batch verification: ${fileCount} file(s) against ${config.targetUrl}`, status: "running" });

    try {
      const report = await runRealGameVerification(
        testRecords,
        config,
        (completed, result) => {
          const srcFile = (result as any).sourceFile;
          const filePrefix = srcFile ? `[${srcFile}] ` : '';
          addLog({
            type: "TOOL_RES",
            toolName: "testdata_verifier",
            content: `${filePrefix}Spin ${completed}: ${result.status}`,
            detail: result.errorMessage ?? "OK",
            status: result.passed ? "success" : "error",
          });
        },
        (executionId) => { verificationExecutionIdRef.current = executionId; }
      );
      setVerificationReport(report);
      setWorkflowState("VERIFIED");
      setWorkflowStage(5);
      addLog({ type: "HARNESS_EVENT", content: `Verification complete: ${report.passedCount}/${report.totalCases} passed (${report.passRate}%)`, status: "success" });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setWorkflowState("READY");
      addLog({ type: "HARNESS_EVENT", content: `Verification failed: ${e?.message ?? e}`, status: "error" });
    } finally {
      setIsGenerating(false);
      verificationExecutionIdRef.current = null;
    }
  };

  const handleConfigChanged = () => {
    // Reload config from the multi-model store
    const models = loadStoredModels();
    const activeCfg = getActiveModelConfig(models);
    setLlmConfig(activeCfg);
    setSelectedModel(activeCfg.selectedModel);
    saveLlmConfig(activeCfg);
    addLog({ type: "HARNESS_EVENT", content: `Model config updated · Active: ${activeCfg.provider} · ${activeCfg.selectedModel}`, status: "success" });
  };

  const selectedModelLabel = MODEL_OPTIONS.find((m) => m.value === selectedModel)?.label ?? selectedModel;

  // Sync task list when scenario changes
  useEffect(() => {
    setTasks((STAGE1_TASKS[selectedScenarioId] ?? STAGE1_TASKS["testdata_generation"] ?? []).map(t => ({ ...t })));
  }, [selectedScenarioId]);

  // TestDataPreview shows the testdata_generation scenario's generated records — it has
  // nothing to do with game_verification's input (a folder of pre-existing .testdata files),
  // so it must never render there (it would otherwise show stale/unrelated mock records).
  // portugal_plugin produces no testdata records — its results go to the console + report files.
  const showCenterFooter =
    workflowStage >= 3 && selectedScenarioId !== "game_verification" && selectedScenarioId !== "portugal_plugin";

  const errorBanner = error ? (
    <div className="bg-rose-500/10 border-b border-rose-500/30 text-rose-300 px-4 py-2.5 flex items-center gap-2 text-xs animate-in slide-in-from-top duration-300 font-mono">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1"><span className="font-bold mr-2">System Alert:</span>{error}</span>
      <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">✕</button>
    </div>
  ) : null;

  if (page === "llm-config") {
    return <LlmConfigPage onBack={() => setPage("workbench")} onConfigChanged={handleConfigChanged} />;
  }

  if (page === "plugin") {
    return <PluginPage onBack={() => setPage("workbench")} />;
  }

  if (page === "agent") {
    return <AgentPage onBack={() => setPage("workbench")} />;
  }

  if (page === "history") {
    return (
      <HistoryPage
        onBack={() => setPage("workbench")}
        onOpenReport={(report) => {
          setVerificationReport(report);
          setPage("workbench");
        }}
      />
    );
  }

  return (
    <div className="h-screen max-h-screen w-screen max-w-full bg-slate-950 text-slate-100 font-sans flex flex-col overflow-hidden">
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        onOpenConfig={() => handleOpenModelPage()}
      />
      {errorBanner}

      <main className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Plugin + Task List */}
        <Sidebar
          tasks={tasks}
          onOpenPlugin={handleOpenPluginPage}
          onOpenAgent={handleOpenAgentPage}
          onOpenHistory={handleOpenHistoryPage}
          selectedScenarioId={selectedScenarioId}
          onSelectScenario={setSelectedScenarioId}
        />

        {/* Center: chat-style column — Execution Console (transcript, fills available space)
            sits above interactive panels and the Input Dialog, which is pinned at the bottom
            like a typical AI chat window. Pipeline + TestData Preview live in the right column. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 gap-3 min-w-0">

          {/* ── Execution Console (chat transcript) ── */}
          <ExecutionConsole logs={logs} onClearLogs={() => setLogs([])} />

          {/* ── AI Clarify Panel: simple dialogue interaction, bounded to one question ── */}
          {clarifyState && (
            <div className="flex-shrink-0 bg-slate-900/70 border border-amber-700/40 rounded-2xl p-5 shadow-xl animate-in slide-in-from-top duration-300">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-amber-950/60 border border-amber-800/50 text-amber-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">AI needs one more detail</span>
              </div>
              <div className="text-xs text-slate-200 mb-3 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                {clarifyState.question}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={clarifyReply}
                  onChange={(e) => setClarifyReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleClarifySubmit();
                    }
                  }}
                  placeholder="Type your answer..."
                  autoFocus
                  className="flex-1 px-3 h-10 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 font-mono"
                />
                <button
                  onClick={handleClarifySubmit}
                  className="px-4 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-slate-900 hover:shadow-lg hover:shadow-amber-500/20 transition"
                >
                  Send
                </button>
                <button
                  onClick={handleClarifyCancel}
                  className="px-3 h-10 rounded-xl text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Test Plan Preview Panel ── */}
          {showPreview && (
            <div className="flex-shrink-0 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl overflow-y-auto max-h-[60%]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Test Plan Preview</span>
                </div>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs"
                >
                  ✕ Close
                </button>
              </div>

              <div className="text-[11px] text-slate-400 mb-3">
                {selectedScenarioId === 'testdata_generation'
                  ? 'Select the test items you want to generate:'
                  : selectedScenarioId === 'game_verification'
                  ? 'Select the verification items to execute:'
                  : 'Select the test items to execute:'}
              </div>

              {/* Testdata file list for game_verification */}
              {selectedScenarioId === 'game_verification' && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Select testdata file(s) ({selectedTestdataFiles.length}/{testdataFiles.length} selected):
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTestdataFiles.length === testdataFiles.length) {
                          // Deselect all
                          setSelectedTestdataFiles([]);
                        } else {
                          // Select all
                          setSelectedTestdataFiles([...testdataFiles]);
                        }
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium"
                    >
                      {selectedTestdataFiles.length === testdataFiles.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  {testdataFiles.length > 0 ? (
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {testdataFiles.map((f) => {
                        const isSelected = selectedTestdataFiles.some(sf => sf.path === f.path);
                        return (
                          <label
                            key={f.path}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-xs ${
                              isSelected
                                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                                : 'bg-slate-950/50 border-slate-700 hover:border-slate-600 text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isSelected) {
                                  setSelectedTestdataFiles(selectedTestdataFiles.filter(sf => sf.path !== f.path));
                                } else {
                                  setSelectedTestdataFiles([...selectedTestdataFiles, f]);
                                }
                              }}
                              className="accent-amber-400"
                            />
                            <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            <span className="font-mono truncate flex-1">{f.name}</span>
                            <span className="text-[10px] text-slate-500">{f.size_kb} KB</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 px-3 py-2 text-center">
                      No .testdata files found. Please select a folder with testdata files.
                    </div>
                  )}
                </div>
              )}

              {/* Verification method: skip the browser entirely via the game's own APIs
                  directly (see testdata_verifier_api_tool.py), or drive a real browser through
                  the QA-only Titan Harness launcher page (no Okta/MFA — see
                  testdata_verifier_harness_tool.py). The original Browser (Selenium) method —
                  the real production URL + Okta/MFA login — has been retired as a selectable
                  option here: the whole point of adopting the Harness login was to eliminate
                  that method's repeated-login friction. Old Selenium-based reports are still
                  viewable from History; buildReportFromExecutionDetail in verificationEngine.ts
                  still recognizes the "testdata_verifier" tool name for that reason. */}
              {selectedScenarioId === 'game_verification' && (
                <div className="mb-3">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">
                    Verification Method
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setVerificationMethod('api')}
                      className={`flex-1 px-3 py-2 rounded-lg border text-[11px] font-semibold transition ${
                        verificationMethod === 'api'
                          ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-950/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      Direct API (fast, no browser)
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerificationMethod('harness')}
                      className={`flex-1 px-3 py-2 rounded-lg border text-[11px] font-semibold transition ${
                        verificationMethod === 'harness'
                          ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                          : 'bg-slate-950/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      Harness (browser, no Okta)
                    </button>
                  </div>
                  {verificationMethod === 'api' && (
                    <div className="space-y-2">
                      <textarea
                        value={oktaAccessToken}
                        onChange={(e) => setOktaAccessToken(e.target.value)}
                        placeholder="Paste Okta access_token here (Axiom Profile page, or the game page's browser Local Storage — valid ~2 hours)"
                        rows={2}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 font-mono resize-none"
                      />
                      <input
                        type="text"
                        value={axiomApiKey}
                        onChange={(e) => setAxiomApiKey(e.target.value)}
                        placeholder="Paste Axiom API Key here (Axiom's ApiKeys page — long-lived, rarely needs updating)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 font-mono"
                      />
                      <div className="text-[9px] text-slate-500">
                        No screenshots in this mode (nothing is rendered) — otherwise same report format as Browser mode.
                      </div>
                    </div>
                  )}
                  {verificationMethod === 'harness' && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={harnessUrl}
                        onChange={(e) => setHarnessUrl(e.target.value)}
                        placeholder="Titan Harness launcher page URL (e.g. https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/harness/apexDragonPowerComboV94)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                      />
                      <input
                        type="text"
                        value={axiomApiKey}
                        onChange={(e) => setAxiomApiKey(e.target.value)}
                        placeholder="Paste Axiom API Key here (Axiom's ApiKeys page — long-lived, rarely needs updating)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={harnessProductId}
                          onChange={(e) => setHarnessProductId(e.target.value)}
                          placeholder="Product Id (e.g. 5001)"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                        />
                        <input
                          type="text"
                          value={harnessClientId}
                          onChange={(e) => setHarnessClientId(e.target.value)}
                          placeholder="Client Id (e.g. 40300)"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                        />
                      </div>
                      <input
                        type="text"
                        value={harnessBrand}
                        onChange={(e) => setHarnessBrand(e.target.value)}
                        placeholder="Brand (optional — defaults to IslandParadise)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                      />
                      <div className="text-[9px] text-slate-500">
                        Username &amp; Module Id come from the selected testdata file's own &lt;Key&gt; — no need to enter them here.
                        Product Id / Client Id are fixed per game version; open the harness page once manually if unsure.
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {plannedTests.map((test) => (
                  <label
                    key={test.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      test.selected
                        ? 'bg-emerald-950/20 border-emerald-800/50'
                        : 'bg-slate-950/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={test.selected}
                      onChange={(e) => {
                        setPlannedTests((prev) =>
                          prev.map((t) =>
                            t.id === test.id ? { ...t, selected: e.target.checked } : t
                          )
                        );
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-200">{test.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{test.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800">
                <div className="text-[11px] text-slate-400">
                  {plannedTests.filter(t => t.selected).length} of {plannedTests.length} items selected
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPreview(false)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmGeneration}
                    disabled={plannedTests.filter(t => t.selected).length === 0}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-emerald-500/20 transition"
                  >
                    {selectedScenarioId === 'testdata_generation' ? 'Confirm & Generate'
                      : selectedScenarioId === 'game_verification' ? 'Confirm & Verify'
                      : 'Confirm & Execute'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─ Input Dialog ── */}
          <div className="flex-shrink-0 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex flex-col gap-3">
              {/* Unified input: auto-detects URL and intent */}
              <textarea
                placeholder={
                  selectedScenarioId === 'game_verification'
                    ? 'Paste game URL and/or describe your test task...\n\nExample:\nhttps://.../htmlGames/...&gameId=...\nverify testdata'
                    : selectedScenarioId === 'testdata_generation'
                    ? 'Paste sheet URL (optional) and describe your test task...\n\nExample:\nhttps://docs.google.com/spreadsheets/d/...\ngenerate testdata for base game'
                    : selectedScenarioId === 'portugal_plugin'
                    ? 'Paste the Portugal Plugin output string, OR a game URL to fetch it from PlayCheck...\n\nExample (paste):\n1:A;B;C#D;E;F#G;H;I#R#A#0,1,2#MV#10#MT#2#MG#5.0\n\nExample (fetch):\nhttps://mobile-app1-gtp537.installprogram.eu/htmlGames/4.60.0/harness/<game>\nusername=lijunt moduleId=105233 productId=5001 clientId=50300 spins=1\n\nSymbol mapping: attach the game\'s Output Guide (.md) with + the first time (or when it changes); later runs reuse it by moduleId.'
                    : 'Describe your test task...'
                }
                value={sheetUrl ? `${sheetUrl}\n${promptIntent}` : promptIntent}
                onChange={(e) => {
                  const value = e.target.value;
                  // Auto-detect and split URL from intent. Only the URL-detection check uses a
                  // trimmed copy — the lines kept for the intent are pushed verbatim, so a space
                  // (or blank line) the user just typed is never silently stripped mid-typing.
                  const lines = value.split('\n');
                  let detectedUrl = '';
                  const intentLines: string[] = [];

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!detectedUrl && /^https?:\/\//i.test(trimmed)) {
                      detectedUrl = trimmed;
                    } else {
                      intentLines.push(line);
                    }
                  }

                  setSheetUrl(detectedUrl);
                  setPromptIntent(intentLines.join('\n'));
                }}
                onKeyDown={(e) => {
                  // Enter = simple dialogue with the AI (bucket 1 of its role — see design doc
                  // §1.2/§10.7/§11); it never decides pipeline order. Shift+Enter still inserts
                  // a newline for multi-line task descriptions. Submitting a test task is a
                  // separate, explicit action (the arrow button below), untouched by this.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChatMessage();
                  }
                }}
                disabled={isGenerating || chatLoading}
                rows={4}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono resize-none"
              />
              <div className="text-[10px] text-slate-500 font-mono -mt-1.5">
                {chatLoading ? (
                  <span className="text-cyan-400 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> AI is replying...
                  </span>
                ) : (
                  <span>Press <kbd className="px-1 rounded bg-slate-800 border border-slate-700">Enter</kbd> to chat with the AI · <kbd className="px-1 rounded bg-slate-800 border border-slate-700">Shift+Enter</kbd> for a new line · click ▲ to run a test task</span>
                )}
              </div>

              {/* Bottom row: Folder button + Generate button (left) | Model selector (right) */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* "+" attach: a persistent, general "import test data" affordance — same
                      position/style in every scenario (including future ones). What it opens
                      depends on what the current scenario's fixed pipeline consumes; browsers
                      never expose an absolute file/folder path, so every path below uploads
                      actual content instead of asking the user to type one. */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAttachMenuOpen((o) => !o)}
                      disabled={attaching}
                      className={`flex items-center justify-center w-10 h-10 rounded-full border transition-all ${
                        attachBadgeCount > 0
                          ? 'bg-amber-950/40 border-amber-700/50 text-amber-300 hover:border-amber-500/70'
                          : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                      }`}
                      title={attachTitle}
                    >
                      {attaching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </button>
                    {attachBadgeCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 text-[9px] font-bold flex items-center justify-center">
                        {selectedScenarioId === 'easyhelp_checking' || selectedScenarioId === 'portugal_plugin' ? '✓' : attachBadgeCount}
                      </span>
                    )}
                    {attachMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} />
                        <div className="absolute bottom-full left-0 mb-2 z-20 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden py-1">
                          <button
                            type="button"
                            onClick={handleAttachFileMode}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 transition text-left"
                          >
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            Add file(s)
                          </button>
                          {folderModeAvailable && (
                            <button
                              type="button"
                              onClick={handleAttachFolderMode}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 transition text-left"
                            >
                              <Folder className="w-3.5 h-3.5 text-slate-400" />
                              Add folder
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <input
                    ref={testdataUploadInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".testdata"
                    onChange={handleTestdataFilesChosen}
                  />
                  <input
                    ref={testdataFolderUploadInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={handleTestdataFilesChosen}
                    {...({ webkitdirectory: '', directory: '' } as any)}
                  />
                  <input
                    ref={folderUploadInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={handleFolderFilesChosen}
                    {...({ webkitdirectory: '', directory: '' } as any)}
                  />
                  <input
                    ref={helpFilesFlatUploadInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".html,.htm"
                    onChange={handleHelpFilesFlatChosen}
                  />
                  <input
                    ref={rawTextUploadInputRef}
                    type="file"
                    className="hidden"
                    accept=".txt,.csv,.tsv,.paytable,.md,.markdown"
                    onChange={handleRawTextFileChosen}
                  />
                  {/* Preview/Generate or Stop button */}
                  <button
                    onClick={isGenerating ? handleStop : handleShowPreview}
                    disabled={!isGenerating && (workflowState === 'GENERATING' || workflowState === 'VERIFYING')}
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
                      isGenerating
                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 active:scale-[0.95]'
                        : 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.95]'
                    }`}
                    title={isGenerating ? "Stop execution" : "Preview test plan"}
                  >
                    {isGenerating ? (
                      <Square className="w-4 h-4 fill-current" />
                    ) : (
                      <ArrowUp className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>

                {/* Model selector */}
                <div className="relative">
                  <button
                    onClick={() => setModelOpen(!modelOpen)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-300 hover:border-slate-500 transition text-[11px] font-mono"
                  >
                    <span className="text-cyan-400">●</span>
                    <span className="max-w-[160px] truncate">{selectedModelLabel}</span>
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {modelOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-[220px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                        {MODEL_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { setSelectedModel(opt.value); setModelOpen(false); }}
                            className={`w-full text-left px-3.5 py-2.5 text-[11px] font-mono transition hover:bg-slate-800 ${
                              selectedModel === opt.value
                                ? 'text-emerald-300 bg-emerald-950/30'
                                : 'text-slate-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Pipeline visualization + TestData Preview */}
        <div className="w-[340px] min-w-[340px] h-full flex flex-col overflow-y-auto p-4 gap-4 border-l border-slate-800">
          <PipelineVisualization
            workflowStage={workflowStage}
            workflowState={workflowState}
            isGenerating={isGenerating}
          />

          {showCenterFooter && (
            <TestDataPreview records={testRecords} loginName={loginName} onRegenerate={handleRegenerate} />
          )}
        </div>
      </main>

      <footer className="flex-shrink-0 px-6 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>HARNESS v2 · Scenario: {SCENARIOS.find(s => s.id === selectedScenarioId)?.label ?? "—"}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`flex items-center gap-1.5 ${workflowState === "GENERATING" ? "text-cyan-400" : "text-emerald-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${workflowState === "GENERATING" ? "bg-cyan-400 animate-ping" : "bg-emerald-400"}`} />
            {workflowState}
          </span>
        </div>
      </footer>

      {verificationReport && (
        <VerificationReportModal
          report={verificationReport}
          onClose={() => setVerificationReport(null)}
          onReRun={() => {
            setVerificationReport(null);
            setWorkflowState("VERIFYING");
          }}
        />
      )}
      <LlmConfigModal isOpen={showLlmConfig} onClose={() => setShowLlmConfig(false)} config={llmConfig} onSaveConfig={handleSaveLlmConfig} />
    </div>
  );
};