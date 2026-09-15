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
import { loadStoredLlmConfig, saveLlmConfig } from "./utils/llmGateway";
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
  log_diagnosis: [
    { id: 't1-1', stage: 1, title: 'Log Collection', description: 'Collect and parse verification failure logs', status: 'pending' },
    { id: 't1-2', stage: 1, title: 'Screenshot Analysis', description: 'Compare actual vs expected game screenshots', status: 'pending' },
    { id: 't1-3', stage: 1, title: 'Root Cause Attribution', description: 'Attribute failures to game server, client UI, or test data', status: 'pending' },
  ],
  easyhelp_checking: [
    { id: 't1-1', stage: 1, title: 'HTML to Text Conversion', description: 'Batch convert HTML help files to clean plain text', status: 'pending' },
    { id: 't1-2', stage: 1, title: 'Version Diff Comparison', description: 'Compare help file versions and highlight keyword differences', status: 'pending' },
    { id: 't1-3', stage: 1, title: 'AI Analysis Report', description: 'Generate AI-powered analysis report with quality issues', status: 'pending' },
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
  log_diagnosis: [
    { id: "plan-1", name: "Failed Case Log Analysis", description: "Analyze logs from failed verification cases", selected: true },
    { id: "plan-2", name: "Screenshot Comparison", description: "Compare actual vs expected game screenshots", selected: true },
    { id: "plan-3", name: "Root Cause Attribution", description: "Attribute failures to game server, client UI, or test data", selected: true },
    { id: "plan-4", name: "Pattern Detection", description: "Detect recurring failure patterns across cases", selected: false },
  ],
  easyhelp_checking: [
    { id: "plan-1", name: "HTML to Text Conversion", description: "Batch convert HTML help files to clean plain text", selected: true },
    { id: "plan-2", name: "Version Diff Comparison", description: "Compare help file versions and highlight keyword differences", selected: true },
    { id: "plan-3", name: "Keyword Extraction", description: "Extract and highlight key terms from help files", selected: true },
    { id: "plan-4", name: "AI Analysis Report", description: "Generate AI-powered analysis report using local model", selected: true },
    { id: "plan-5", name: "Excel Report Generation", description: "Package diff results into formatted Excel report", selected: false },
  ],
};

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
  const folderUploadInputRef = useRef<HTMLInputElement>(null);
  // easyhelp_checking's "Add file(s)" alternative: loose HTML files with no folder structure —
  // each gets a synthetic subdir derived from its filename (see uploadFilesAsFolder).
  const helpFilesFlatUploadInputRef = useRef<HTMLInputElement>(null);
  // Attach ("+") for testdata_generation: read a local paytable text/CSV file client-side and
  // fold its content into the intent box — no backend round-trip needed for this one.
  const rawTextUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRawText, setUploadingRawText] = useState(false);
  // Attach ("+") for log_diagnosis: load a previously-saved verification-results JSON file,
  // so diagnosis isn't only possible right after a same-session TestData Verification run.
  const diagnosisUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDiagnosis, setUploadingDiagnosis] = useState(false);
  const [uploadedDiagnosisResults, setUploadedDiagnosisResults] = useState<Record<string, unknown>[] | null>(null);
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

    // 自动意图路由：根据用户输入匹配场景
    // 仅当路由结果得分很高（>100）时才覆盖用户手动选择的场景，避免误判
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
      setShowPreview(false);
      
      // Pass all selected files to verification engine
      await handleStartVerification({
        targetUrl: sheetUrl,
        spinDelayMs: 3000,
        timeoutMs: 5000,
        autoRetryServerError: true,
        loginName,
        folderPath,
        testdataFilePaths: selectedTestdataFiles.map(f => f.path),
      });
      return;
    }

    // For other scenarios, use the fixed pipeline (ExecutionEngine + pipelineRegistry.ts)
    setShowPreview(false);

    const missing = checkMissingField(selectedScenarioId);
    if (missing?.field === "verificationResults") {
      setError(`Missing ${missing.message}. Run "TestData Verification" for this game first, then come back to Log Diagnosis.`);
      return;
    }
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
  ): { field: "rawText" | "folderPath" | "verificationResults"; message: string } | null => {
    if (scenarioId === "testdata_generation") {
      if (!/\d+\s*,\s*\d+/.test(promptIntent)) {
        return { field: "rawText", message: "raw paytable rows in 'batch,index' format (paste the Google Sheet rows directly)" };
      }
    } else if (scenarioId === "easyhelp_checking") {
      if (!folderPath.trim()) {
        return { field: "folderPath", message: "the absolute folder path containing the HTML help files to convert" };
      }
    } else if (scenarioId === "log_diagnosis") {
      if (!uploadedDiagnosisResults?.length && !verificationReport?.results?.length) {
        return { field: "verificationResults", message: "a prior TestData Verification run's results (attach a saved results JSON via + , or run TestData Verification first)" };
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
      } else if (selectedScenarioId === "log_diagnosis") {
        extraParams.results = uploadedDiagnosisResults ?? verificationReport?.results ?? [];
      } else if (selectedScenarioId === "easyhelp_checking") {
        extraParams.sourceFolder = folderPath;
        extraParams.outputFolder = folderPath ? `${folderPath}\\_easyhelp_output` : "";
        extraParams.keywords = promptIntent.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
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
      if (lastResult !== undefined) {
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
    setUploadedDiagnosisResults(null);
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
      setPromptIntent((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    } catch (err: any) {
      setError(`Failed to read file: ${err?.message ?? "Unknown error"}`);
    } finally {
      setUploadingRawText(false);
      e.target.value = "";
    }
  };

  // ── Verification-results file upload (log_diagnosis): lets diagnosis run from a saved
  // report, not only right after a same-session TestData Verification run. ──
  const handleSelectDiagnosisFile = () => diagnosisUploadInputRef.current?.click();

  const handleDiagnosisFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDiagnosis(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const results = Array.isArray(parsed) ? parsed : parsed?.results;
      if (!Array.isArray(results)) {
        throw new Error("Expected a JSON array of results, or an object with a \"results\" array");
      }
      setUploadedDiagnosisResults(results);
    } catch (err: any) {
      setError(`Failed to read results file: ${err?.message ?? "Unknown error"}`);
    } finally {
      setUploadingDiagnosis(false);
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
    else if (selectedScenarioId === "log_diagnosis") handleSelectDiagnosisFile();
    else handleSelectRawTextFile(); // testdata_generation (and any future scenario's default)
  };

  const handleAttachFolderMode = () => {
    setAttachMenuOpen(false);
    if (selectedScenarioId === "game_verification") testdataFolderUploadInputRef.current?.click();
    else if (selectedScenarioId === "easyhelp_checking") handleSelectFolderUpload();
  };

  const attaching = uploadingTestdata || uploadingFolder || uploadingRawText || uploadingDiagnosis;
  const attachBadgeCount =
    selectedScenarioId === "game_verification" ? testdataFiles.length
    : selectedScenarioId === "easyhelp_checking" ? (folderPath ? 1 : 0)
    : selectedScenarioId === "log_diagnosis" ? (uploadedDiagnosisResults?.length ?? 0)
    : 0;
  const attachTitle =
    selectedScenarioId === "game_verification"
      ? (testdataFiles.length > 0 ? `${testdataFiles.length} .testdata file(s) attached — click to change` : "Attach .testdata file(s) or a folder to verify")
    : selectedScenarioId === "easyhelp_checking"
      ? (folderPath ? "Folder attached — click to change" : "Attach help files or a folder")
    : selectedScenarioId === "log_diagnosis"
      ? (uploadedDiagnosisResults ? `${uploadedDiagnosisResults.length} result(s) attached — click to change` : "Attach a saved verification-results JSON file")
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

  const handleConfigChanged = async () => {
    // Reload config from the multi-model store
    const { loadStoredModels, getActiveModelConfig } = await import("./utils/llmGateway");
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
  const showCenterFooter = workflowStage >= 3 && selectedScenarioId !== "game_verification";

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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        onOpenConfig={() => handleOpenModelPage()}
      />
      {errorBanner}

      <main className="flex-1 flex overflow-hidden">
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
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4 min-w-0">

          {/* ── Execution Console (chat transcript) ── */}
          <ExecutionConsole logs={logs} />

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
                  : selectedScenarioId === 'log_diagnosis'
                  ? 'Select the diagnosis items to analyze:'
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
                      : selectedScenarioId === 'log_diagnosis' ? 'Confirm & Diagnose'
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
                        {selectedScenarioId === 'easyhelp_checking' ? '✓' : attachBadgeCount}
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
                    accept=".txt,.csv,.tsv,.paytable"
                    onChange={handleRawTextFileChosen}
                  />
                  <input
                    ref={diagnosisUploadInputRef}
                    type="file"
                    className="hidden"
                    accept=".json"
                    onChange={handleDiagnosisFileChosen}
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
        <div className="w-[340px] min-w-[340px] flex flex-col overflow-y-auto p-4 gap-4 border-l border-slate-800">
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

      <footer className="px-6 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
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