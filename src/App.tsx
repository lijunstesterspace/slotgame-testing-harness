import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { IntentPanel } from "./components/IntentPanel";
import { AgentCore } from "./components/AgentCore";
import { TestDataPreview } from "./components/TestDataPreview";
import { VerificationPanel } from "./components/VerificationPanel";
import { VerificationReportModal } from "./components/VerificationReportModal";
import { LlmConfigModal } from "./components/LlmConfigModal";
import { LoginPage } from "./pages/LoginPage";
import { SlotGameConfig, WorkflowStage, WorkflowState, TaskItem, ToolCallLog, TestRecord, VerificationConfig, VerificationReport, LlmProviderConfig } from "./types";
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from "./mock/testData";
import { runRealGameVerification } from "./utils/verificationEngine";
import { loadStoredLlmConfig, saveLlmConfig } from "./utils/llmGateway";
import { Sparkles, Bot, AlertCircle } from "lucide-react";
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
        🔐 Validating session token...
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
  const [selectedGame, setSelectedGame] = useState<SlotGameConfig>(MOCK_GAME_CONFIGS[0]);
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
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(() => loadStoredLlmConfig().selectedModel);
  const [loginName, setLoginName] = useState<string>(auth.user?.username ?? "");

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

  const handleStartGeneration = async () => {
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
          content: `⚠️ 外部 Provider ${plannerCfg.provider} 已启用 — 请确认合规（API Key 仅存本机）`,
          status: "warning",
        });
      }
      const outcome = await planner.run({
        intent: { prompt: promptIntent, sheetUrl, loginName, workflowStage: 1 },
        maxCycles: 14,
      });
      if (!outcome.success) throw new Error(outcome.message ?? "Planner 未完成任务");
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

  const errorBanner = (
    <div className="bg-rose-500/10 border-b border-rose-500/30 text-rose-300 px-4 py-2.5 flex items-center gap-2 text-xs animate-in slide-in-from-top duration-300 font-mono">
      <AlertCircle className="w-4 h-4" />
      <span>
        <span className="font-bold mr-2">System Alert:</span>
        {error}
      </span>
      <button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-200">✕</button>
    </div>
  );

  const handleSaveLlmConfig = (cfg: LlmProviderConfig) => {
    setLlmConfig(cfg);
    setSelectedModel(cfg.selectedModel);
    saveLlmConfig(cfg);
    addLog({ type: "HARNESS_EVENT", content: `LLM Provider switched to ${cfg.provider} · ${cfg.selectedModel}`, status: "success" });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        llmConfig={llmConfig}
        onOpenConfigModal={() => setShowLlmConfig(true)}
        user={auth.user}
        onLogout={onLogout}
      />
      {error && errorBanner}

      <main className="flex-1 flex overflow-hidden">
        <div className="w-[380px] border-r border-slate-800 bg-slate-900/50 flex flex-col overflow-y-auto">
          <IntentPanel
            selectedGame={selectedGame}
            sheetUrl={sheetUrl}
            setSheetUrl={setSheetUrl}
            promptIntent={promptIntent}
            setPromptIntent={setPromptIntent}
            workflowStage={workflowStage}
            workflowState={workflowState}
            onStartGeneration={handleStartGeneration}
            onRunTestSuite={() => {
              setWorkflowState("VERIFYING");
            }}
            isGenerating={isGenerating}
            isTesting={isTesting}
          />
          <VerificationPanel onStartVerification={handleStartVerification} isVerifying={isTesting} loginName={loginName} setLoginName={setLoginName} />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <AgentCore tasks={tasks} logs={logs} workflowStage={workflowStage} isGenerating={isGenerating} isTesting={isTesting} />
          <div className="h-[40%] border-t border-slate-800 bg-slate-900/30">
            <TestDataPreview records={testRecords} loginName={loginName} onRegenerate={handleRegenerate} />
          </div>
        </div>
      </main>

      <footer className="px-6 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-emerald-500" />
          <span>HARNESS v2 · PlannerAgent + Tool Registry · 全链路审计</span>
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
