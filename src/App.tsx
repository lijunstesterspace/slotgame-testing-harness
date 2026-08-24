import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { AgentCore } from "./components/AgentCore";
import { TestDataPreview } from "./components/TestDataPreview";
import { VerificationPanel } from "./components/VerificationPanel";
import { VerificationReportModal } from "./components/VerificationReportModal";
import { LlmConfigModal } from "./components/LlmConfigModal";
import { LlmConfigPage } from "./pages/LlmConfigPage";
import { PluginPage } from "./pages/PluginPage";
import { LoginPage } from "./pages/LoginPage";
import { SlotGameConfig, WorkflowStage, WorkflowState, TaskItem, ToolCallLog, TestRecord, VerificationConfig, VerificationReport, LlmProviderConfig } from "./types";
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from "./mock/testData";
import { runRealGameVerification } from "./utils/verificationEngine";
import { loadStoredLlmConfig, saveLlmConfig } from "./utils/llmGateway";
import { AlertCircle, Sparkles, PlusCircle, Loader2, ChevronDown, FolderOpen, ArrowUp } from "lucide-react";
import { harnessClient, clearAuth } from "./harness/client";
import type { TestRecordDto } from "./harness/sharedTypes";
import { PlannerAgent, PlannerCallbacks } from "./harness/plannerAgent";

// --- Auth Context ---
interface AuthUser { id: string; username: string; role: string; isAdmin: boolean; }
const AuthContext = createContext<{ user: AuthUser | null; refresh: () => Promise<void> }>({ user: null, refresh: async () => {} });
const useAuth = () => useContext(AuthContext);

const STAGE1_TASKS: TaskItem[] = [
  { id: 't1-1', stage: 1, title: 'Intent Analysis', description: 'Parse natural language requirement and game constraints', status: 'pending' },
  { id: 't1-2', stage: 1, title: 'Paytable Structuring', description: 'Parse Paytable URL into structured Symbol/Multiplier config', status: 'pending' },
  { id: 't1-3', stage: 1, title: 'Constraint Mapping', description: 'Map requirements to verification rules and boundary conditions', status: 'pending' },
];

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
  const [tasks, setTasks] = useState<TaskItem[]>(STAGE1_TASKS);
  const [logs, setLogs] = useState<ToolCallLog[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testRecords, setTestRecords] = useState<TestRecord[]>(INITIAL_TEST_RECORDS);
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"workbench" | "llm-config" | "plugin">("workbench");
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(() => loadStoredLlmConfig().selectedModel);
  const [modelOpen, setModelOpen] = useState(false);
  const [loginName, setLoginName] = useState<string>(auth.user?.username ?? "");
  const [folderPath, setFolderPath] = useState<string>("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  
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

  // Step 1: Show preview of planned tests
  const handleShowPreview = () => {
    if (!promptIntent.trim()) {
      setError("Please describe your test task first");
      return;
    }
    // Generate planned test items based on intent
    const tests = [
      { id: "plan-1", name: "Base Game - Normal Spin", description: "Test normal spin outcomes and payouts", selected: true },
      { id: "plan-2", name: "Base Game - Max Bet", description: "Test maximum bet configuration", selected: true },
      { id: "plan-3", name: "Free Spins Trigger", description: "Test free spins feature activation", selected: true },
      { id: "plan-4", name: "Bonus Game Entry", description: "Test bonus game entry conditions", selected: false },
      { id: "plan-5", name: "Paytable Verification", description: "Verify all symbol payouts match paytable", selected: true },
    ];
    setPlannedTests(tests);
    setShowPreview(true);
  };

  // Step 2: Confirm and start generation with selected tests
  const handleConfirmGeneration = async () => {
    const selectedTests = plannedTests.filter(t => t.selected);
    if (selectedTests.length === 0) {
      setError("Please select at least one test item");
      return;
    }
    setShowPreview(false);
    
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    if (workflowStage >= 1) setWorkflowStage(2);
    setWorkflowState("GENERATING");
    setTasks((prev) => prev.map((t) => (t.id === "t1-1" ? { ...t, status: "active" } : t)));
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
      const outcome = await planner.run({
        intent: { prompt: promptIntent, sheetUrl, loginName, workflowStage: 1 },
        maxCycles: 14,
      });
      if (!outcome.success) throw new Error(outcome.message ?? "Planner did not complete the task");
      setWorkflowState("REVIEW");
      setTasks((prev) => prev.map((t) => (t.status === "active" || t.status === "pending" ? { ...t, status: "completed" } : t)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setWorkflowState("READY");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartVerification = async (config: VerificationConfig) => {
    if (isTesting) return;
    setIsTesting(true);
    setWorkflowStage(4);
    setWorkflowState("VERIFYING");
    setVerificationReport(null);
    addLog({ type: "TOOL_CALL", toolName: "game_verifier", content: "Connecting to Real Game Environment via Backend Harness...", detail: JSON.stringify(config, null, 2), status: "running" });
    try {
      const cfg: VerificationConfig = {
        targetUrl: config.targetUrl,
        spinDelayMs: config.spinDelayMs,
        timeoutMs: config.timeoutMs,
        loginName: config.loginName,
        autoRetryServerError: config.autoRetryServerError,
      };
      const report = await runRealGameVerification(testRecords, cfg, (completedCount, currentResult) => {
        addLog({
          type: currentResult.status === "PASSED" ? "TOOL_RES" : "SELF_HEAL",
          toolName: "game_verifier",
          content: `Verifying Case: ${currentResult.caseName} (${completedCount}/${testRecords.length})`,
          detail: currentResult.status === "PASSED" ? `Server Payout Match. Response: ${currentResult.responseTimeMs}ms` : `Discrepancy Detected: ${currentResult.errorMessage}`,
          status: currentResult.status === "PASSED" ? "success" : "error",
        });
      });
      setVerificationReport(report);
      const results = report.results;
      const failedCount = results.filter((r) => !r.passed).length;
      addLog({
        type: "TOOL_RES",
        toolName: "game_verifier",
        content: `Verification Complete: ${report.passedCount}/${report.totalCases} Passed`,
        detail: failedCount > 0 ? `${failedCount} discrepancies found. Generating Diagnostic Report...` : "All server payouts matched expected values.",
        status: failedCount > 0 ? "warning" : "success",
      });
      chime();
      if (failedCount > 0) {
        addLog({ type: "TOOL_CALL", toolName: "log_diagnoser", content: "Running Vision Analysis on Error Logs...", status: "running" });
        try {
          const diag = await harnessClient.executeTool("log_diagnoser", { results: report.results });
          addLog({ type: "TOOL_RES", toolName: "log_diagnoser", content: `Identified ${diag.content && typeof diag.content === "object" ? (diag.content as any)?.count ?? 0 : 0} root causes.`, status: "success" });
        } catch (e: any) {
          addLog({ type: "TOOL_RES", toolName: "log_diagnoser", content: "Local heuristic fallback used", detail: String(e?.message ?? e), status: "warning" });
        }
      }
      setWorkflowStage(5);
      setWorkflowState("VERIFIED");
    } catch (e: any) {
      addLog({ type: "SELF_HEAL", content: `Verification Interrupted: ${e?.message ?? String(e)}`, status: "error" });
      setWorkflowState("REVIEW");
    } finally {
      setIsTesting(false);
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
    setTasks(STAGE1_TASKS);
    setLogs([]);
    setTestRecords(INITIAL_TEST_RECORDS);
    setVerificationReport(null);
    setPromptIntent("");
    setSheetUrl("");
    setError(null);
  };

  const handleSaveLlmConfig = (cfg: LlmProviderConfig) => {
    setLlmConfig(cfg);
    setSelectedModel(cfg.selectedModel);
    saveLlmConfig(cfg);
    addLog({ type: "HARNESS_EVENT", content: `LLM Provider switched to ${cfg.provider} · ${cfg.selectedModel}`, status: "success" });
  };

  const handleOpenModelPage = () => setPage("llm-config");
  const handleOpenPluginPage = () => setPage("plugin");
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
        <Sidebar tasks={tasks} onOpenPlugin={handleOpenPluginPage} />

        {/* Center: Input Dialog → Pipeline → Console → Preview */}
        <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4 min-w-0">

          {/* ── Input Dialog ── */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Sheet URL (optional)"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                disabled={isGenerating}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
              />

              <textarea
                placeholder="Describe your test task..."
                value={promptIntent}
                onChange={(e) => setPromptIntent(e.target.value)}
                disabled={isGenerating}
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono resize-none"
              />

              {/* Bottom row: Folder picker + Generate button (left) | Model selector (right) */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* Hidden folder file input */}
                  <input
                    ref={folderInputRef}
                    type="file"
                    className="hidden"
                    {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const dirName = files[0].webkitRelativePath.split("/")[0];
                        setFolderPath(dirName);
                      }
                    }}
                  />
                  {/* Add local folder button */}
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition text-[11px]"
                    title="Add local folder"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>{folderPath || "Add folder"}</span>
                  </button>

                  {/* Preview/Generate button with upward arrow */}
                  <button
                    onClick={handleShowPreview}
                    disabled={isGenerating || workflowState === 'GENERATING' || workflowState === 'VERIFYING'}
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
                      isGenerating
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.95]'
                    }`}
                    title="Preview test plan"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
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
                Select the test items you want to generate:
              </div>

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
                    Confirm & Generate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Pipeline + Console ── */}
          <div className="flex-1 flex flex-col min-h-0">
            <AgentCore
              tasks={tasks}
              logs={logs}
              workflowStage={workflowStage}
              workflowState={workflowState}
              isGenerating={isGenerating}
              isTesting={isTesting}
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

      {/* Verification Panel (floating bottom) */}
      {workflowState === 'REVIEW' && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-800 bg-slate-900/95 backdrop-blur">
          <VerificationPanel
            onStartVerification={handleStartVerification}
            isVerifying={isTesting}
            loginName={loginName}
            setLoginName={setLoginName}
          />
        </div>
      )}

      <footer className="px-6 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>HARNESS v2 · PlannerAgent + Tool Registry · Full Audit Trail</span>
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