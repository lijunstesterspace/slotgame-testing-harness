import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { AgentCore } from "./components/AgentCore";
import { TestDataPreview } from "./components/TestDataPreview";
import { VerificationReportModal } from "./components/VerificationReportModal";
import { LlmConfigModal } from "./components/LlmConfigModal";
import { LlmConfigPage } from "./pages/LlmConfigPage";
import { PluginPage } from "./pages/PluginPage";
import { AgentPage } from "./pages/AgentPage";
import { LoginPage } from "./pages/LoginPage";
import { SlotGameConfig, WorkflowStage, WorkflowState, TaskItem, ToolCallLog, TestRecord, VerificationReport, VerificationConfig, TestdataFileInfo, LlmProviderConfig } from "./types";
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from "./mock/testData";
import { loadStoredLlmConfig, saveLlmConfig } from "./utils/llmGateway";
import { AlertCircle, Sparkles, Loader2, ChevronDown, FolderOpen, ArrowUp, Square, RefreshCw, FileText } from "lucide-react";
import { runRealGameVerification } from "./utils/verificationEngine";
import { harnessClient, clearAuth } from "./harness/client";
import type { FunctionCallingSchema, TestRecordDto } from "./harness/sharedTypes";
import { PlannerAgent, PlannerCallbacks } from "./harness/plannerAgent";
import { routeIntent, SCENARIOS } from "./harness/intentRouter";

// --- Auth Context ---
interface AuthUser { id: string; username: string; role: string; isAdmin: boolean; }
const AuthContext = createContext<{ user: AuthUser | null; refresh: () => Promise<void> }>({ user: null, refresh: async () => {} });
const useAuth = () => useContext(AuthContext);

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

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refresh = async () => {
    try {
      const u = await harnessClient.me();
      setUser({ id: u.id, username: u.username, role: u.role, isAdmin: u.role === "admin" });
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    setAuthLoading(true);
    refresh().finally(() => setAuthLoading(false));
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 font-mono text-xs">
        Validating session token...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoggedIn={() => { void refresh(); }} />;
  }

  return (
    <AuthContext.Provider value={{ user, refresh }}>
      <Workbench onLogout={() => { clearAuth(); setUser(null); }} />
    </AuthContext.Provider>
  );
};

const Workbench: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const auth = useAuth();
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
  const [page, setPage] = useState<"workbench" | "llm-config" | "plugin" | "agent">("workbench");
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(() => loadStoredLlmConfig().selectedModel);
  const [modelOpen, setModelOpen] = useState(false);
  const [loginName, setLoginName] = useState<string>(auth.user?.username ?? "");
  const [folderPath, setFolderPath] = useState<string>("");
  const [manualFolderPath, setManualFolderPath] = useState<string>("");
  const [scanningFolder, setScanningFolder] = useState(false);
  const [testdataFiles, setTestdataFiles] = useState<TestdataFileInfo[]>([]);
  const [selectedTestdataFile, setSelectedTestdataFile] = useState<TestdataFileInfo | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("testdata_generation");
  
  // Test plan preview state
  const [showPreview, setShowPreview] = useState(false);
  const [plannedTests, setPlannedTests] = useState<Array<{id: string; name: string; description: string; selected: boolean}>>([]);

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

  const plannerCallbacks = useMemo<PlannerCallbacks>(() => ({
    onThought: (full) => {
      setLogs((prev) => {
        const idx = prev.length - 1;
        if (idx >= 0 && prev[idx].type === "THOUGHT") {
          const cp = [...prev];
          cp[idx] = { ...cp[idx], content: full };
          return cp;
        }
        return [
          ...prev,
          { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toLocaleTimeString(), type: "THOUGHT", content: full },
        ];
      });
    },
    onToolCall: (toolName, params) => addLog({ type: "TOOL_CALL", toolName, content: toolName, detail: JSON.stringify(params, null, 2), status: "running" }),
    onToolResult: (toolName, resultSnippet, ok) => {
      chime();
      addLog({ type: "TOOL_RES", toolName, content: toolName, detail: resultSnippet, status: ok ? "success" : "error" });
    },
    onSelfHeal: (reason) => addLog({ type: "SELF_HEAL", content: `RECOVERY: ${reason}`, status: "warning" }),
    onHarnessEvent: (content) => addLog({ type: "HARNESS_EVENT", content }),
    onProgress: (records) => {
      if (records.length) setTestRecords(toFrontendRecords(records));
    },
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
      if (!selectedTestdataFile) {
        setError("Please select a testdata file");
        return;
      }
      setShowPreview(false);
      await handleStartVerification({
        targetUrl: sheetUrl,
        spinDelayMs: 3000,
        timeoutMs: 5000,
        autoRetryServerError: true,
        loginName,
        folderPath,
        testdataFilePath: selectedTestdataFile.path,
      });
      return;
    }

    // For other scenarios, use planner
    setShowPreview(false);
    
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
      const plannerCfg = { ...llmConfig, selectedModel };
      const planner = new PlannerAgent(plannerCfg, plannerCallbacks);
      if (planner.complianceRisk) {
        addLog({
          type: "HARNESS_EVENT",
          content: `External Provider ${plannerCfg.provider} enabled — verify compliance (API Key stored locally)`,
          status: "warning",
        });
      }

      // Fetch tools filtered by scenario's requiredPlugins (backend does the filtering)
      let availableTools: FunctionCallingSchema[] | undefined;
      try {
        const listRes = await harnessClient.listTools(selectedScenarioId);
        availableTools = listRes.schema;
        addLog({
          type: "HARNESS_EVENT",
          content: `Tools loaded for scenario: ${availableTools.length} tool(s) available`,
        });
      } catch (e: any) {
        addLog({ type: "SELF_HEAL", content: `Failed to fetch tool list: ${e?.message ?? e}`, status: "warning" });
      }

      const outcome = await planner.run({
        scenarioId: selectedScenarioId,
        intent: promptIntent,
        sheetUrl: selectedScenarioId === 'testdata_generation' ? sheetUrl : undefined,
        targetUrl: selectedScenarioId === 'game_verification' ? sheetUrl : undefined,
        loginName,
        maxCycles: 14,
        signal: controller.signal,
        availableTools,
      });
      if (!outcome.success) throw new Error(outcome.message ?? "Planner did not complete the task");
      setWorkflowState("REVIEW");
      setTasks((prev) => prev.map((t) => (t.status === "active" || t.status === "pending" ? { ...t, status: "completed" } : t)));
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
  };

  const handleSaveLlmConfig = (cfg: LlmProviderConfig) => {
    setLlmConfig(cfg);
    setSelectedModel(cfg.selectedModel);
    saveLlmConfig(cfg);
    addLog({ type: "HARNESS_EVENT", content: `LLM Provider switched to ${cfg.provider} · ${cfg.selectedModel}`, status: "success" });
  };

  const handleOpenModelPage = () => setPage("llm-config");
  const handleOpenPluginPage = () => setPage("plugin");
  // ── Folder selection (general-purpose, used by multiple scenarios) ─
  const handleFolderSelect = () => folderInputRef.current?.click();

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files as any)?.[0];
    if (!file) return;
    
    // Try to extract absolute path from relative path structure
    // In browsers, file.path is not available; we use webkitRelativePath
    const relativePath = file.webkitRelativePath || '';
    if (relativePath) {
      // Extract folder name from first segment of relative path
      const folderName = relativePath.split('/')[0];
      // Store just the folder name - user will need to provide full path manually
      setFolderPath(folderName);
      setTestdataFiles([]);
      setSelectedTestdataFile(null);
      setError(`Folder "${folderName}" selected. Please paste the full absolute path below.`);
    }
    e.target.value = '';
  };

  const handleOpenAgentPage = () => setPage("agent");

  // Scan folder using manual path input
  const handleScanFolder = async () => {
    if (!manualFolderPath.trim()) {
      setError("Please enter a folder path");
      return;
    }
    setFolderPath(manualFolderPath.trim());
    setScanningFolder(true);
    setError(null);
    try {
      const res = await fetch('/api/tools/scan-testdata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: manualFolderPath.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestdataFiles(data.files || []);
        setSelectedTestdataFile(data.files?.length === 1 ? data.files[0] : null);
        if (data.files?.length === 0) {
          setError("No .testdata files found in this folder");
        }
      } else {
        const err = await res.json().catch(() => ({ detail: 'Scan failed' }));
        setError(err.detail || 'Folder not found or scan failed');
        setTestdataFiles([]);
        setSelectedTestdataFile(null);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
      setTestdataFiles([]);
      setSelectedTestdataFile(null);
    } finally {
      setScanningFolder(false);
    }
  };

  // ── Verification handler ──────────────────────────────────────
  const handleStartVerification = async (config: VerificationConfig) => {
    setWorkflowState("VERIFYING");
    setError(null);
    setLogs([]);
    addLog({ type: "HARNESS_EVENT", content: `Starting verification against ${config.targetUrl}`, status: "running" });

    try {
      const report = await runRealGameVerification(
        testRecords,
        config,
        (completed, result) => {
          addLog({
            type: "TOOL_RES",
            toolName: "testdata_verifier",
            content: `Spin ${completed}: ${result.status}`,
            detail: result.errorMessage ?? "OK",
            status: result.passed ? "success" : "error",
          });
        }
      );
      setVerificationReport(report);
      setWorkflowState("VERIFIED");
      addLog({ type: "HARNESS_EVENT", content: `Verification complete: ${report.passedCount}/${report.totalCases} passed (${report.passRate}%)`, status: "success" });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setWorkflowState("READY");
      addLog({ type: "HARNESS_EVENT", content: `Verification failed: ${e?.message ?? e}`, status: "error" });
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

  const showCenterFooter = workflowStage >= 3;

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        onOpenConfig={() => handleOpenModelPage()}
        user={auth.user}
        onLogout={onLogout}
      />
      {errorBanner}

      <main className="flex-1 flex overflow-hidden">
        {/* Left: Plugin + Task List */}
        <Sidebar
          tasks={tasks}
          onOpenPlugin={handleOpenPluginPage}
          onOpenAgent={handleOpenAgentPage}
          selectedScenarioId={selectedScenarioId}
          onSelectScenario={setSelectedScenarioId}
        />

        {/* Center: Input Dialog → Pipeline → Console → Preview */}
        <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4 min-w-0">

          {/* ─ Input Dialog ── */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
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
                  // Auto-detect and split URL from intent
                  const lines = value.split('\n');
                  let detectedUrl = '';
                  let detectedIntent = '';
                  
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!detectedUrl && /^https?:\/\//i.test(trimmed)) {
                      detectedUrl = trimmed;
                    } else if (trimmed) {
                      detectedIntent += (detectedIntent ? '\n' : '') + trimmed;
                    }
                  }
                  
                  setSheetUrl(detectedUrl);
                  setPromptIntent(detectedIntent);
                }}
                disabled={isGenerating}
                rows={4}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono resize-none"
              />

              {/* Bottom row: Folder button + Generate button (left) | Model selector (right) */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* Folder selection button */}
                  <button
                    type="button"
                    onClick={handleFolderSelect}
                    className={`flex items-center gap-1.5 px-3 h-10 rounded-xl border text-xs font-medium transition-all ${
                      folderPath
                        ? 'bg-amber-950/40 border-amber-700/50 text-amber-300 hover:border-amber-500/70'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}
                    title="Select a folder with test data files"
                  >
                    {scanningFolder ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="w-3.5 h-3.5" />
                    )}
                    <span className="max-w-[120px] truncate">{folderPath ? folderPath.split('\\').pop() || folderPath.split('/').pop() : 'Add folder'}</span>
                  </button>
                  <input
                    ref={folderInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFolderChange}
                    {...({ webkitdirectory: '', directory: '' } as any)}
                  />

                  {/* Manual folder path input */}
                  <input
                    type="text"
                    value={manualFolderPath}
                    onChange={(e) => setManualFolderPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScanFolder();
                      }
                    }}
                    placeholder="Paste absolute folder path..."
                    className="flex-1 min-w-[200px] px-3 h-10 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleScanFolder}
                    disabled={scanningFolder || !manualFolderPath.trim()}
                    className={`flex items-center gap-1.5 px-3 h-10 rounded-xl border text-xs font-medium transition-all ${
                      scanningFolder
                        ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300 hover:border-emerald-500/70'
                    }`}
                    title="Scan folder for testdata files"
                  >
                    {scanningFolder ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="w-3.5 h-3.5" />
                    )}
                    <span>Scan</span>
                  </button>

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

          {/* ── Test Plan Preview Panel ── */}
          {showPreview && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
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
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">
                    Select testdata file ({testdataFiles.length} found):
                  </div>
                  {testdataFiles.length > 0 ? (
                    <div className="space-y-1 max-h-[150px] overflow-y-auto">
                      {testdataFiles.map((f) => (
                        <label
                          key={f.path}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-xs ${
                            selectedTestdataFile?.path === f.path
                              ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                              : 'bg-slate-950/50 border-slate-700 hover:border-slate-600 text-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="testdata-file"
                            checked={selectedTestdataFile?.path === f.path}
                            onChange={() => setSelectedTestdataFile(f)}
                            className="accent-amber-400"
                          />
                          <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <span className="font-mono truncate flex-1">{f.name}</span>
                          <span className="text-[10px] text-slate-500">{f.size_kb} KB</span>
                        </label>
                      ))}
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

          {/* ── Pipeline + Console ─ */}
          <div className="flex-1 flex flex-col min-h-0">
            <AgentCore
              tasks={tasks}
              logs={logs}
              workflowStage={workflowStage}
              workflowState={workflowState}
              isGenerating={isGenerating}
            />
          </div>

          {/* ── TestData Preview ── */}
          {showCenterFooter && (
            <div className="flex-shrink-0 max-h-[40%] min-h-[200px] overflow-y-auto">
              <TestDataPreview records={testRecords} loginName={loginName} onRegenerate={handleRegenerate} />
            </div>
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
          <span>USER: {auth.user?.username}</span>
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