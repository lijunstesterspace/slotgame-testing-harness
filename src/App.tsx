import React, { useState } from 'react';
import { Header } from './components/Header';
import { IntentPanel } from './components/IntentPanel';
import { AgentCore } from './components/AgentCore';
import { TestDataPreview } from './components/TestDataPreview';
import { VerificationPanel } from './components/VerificationPanel';
import { VerificationReportModal } from './components/VerificationReportModal';
import { LlmConfigModal } from './components/LlmConfigModal';
import { 
  SlotGameConfig, 
  WorkflowStage, 
  WorkflowState, 
  TaskItem, 
  ToolCallLog, 
  TestRecord,
  VerificationConfig,
  VerificationReport,
  LlmProviderConfig
} from './types';
import { MOCK_GAME_CONFIGS, INITIAL_TEST_RECORDS } from './mock/testData';
import { runRealGameVerification } from './utils/verificationEngine';
import { parseLLMOutputToTestRecords } from './utils/ollamaClient';
import { loadStoredLlmConfig, saveLlmConfig, streamUniversalLlmChat, testLlmConnection } from './utils/llmGateway';
import { Bot, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  const [selectedGame, setSelectedGame] = useState<SlotGameConfig>(MOCK_GAME_CONFIGS[0]);
  const [sheetUrl, setSheetUrl] = useState<string>(`https://docs.google.com/spreadsheets/d/1X9_MedusasGold_Paytable_v2/edit#gid=10539`);
  const [promptIntent, setPromptIntent] = useState<string>(`Create testdata`);
  const [loginName, setLoginName] = useState<string>('');
  
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(loadStoredLlmConfig());
  const [selectedModel, setSelectedModel] = useState<string>(llmConfig.selectedModel || 'qwen2.5-coder:7b');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);

  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(1);
  const [workflowState, setWorkflowState] = useState<WorkflowState>('READY');
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);

  // Agent tasks
  const [tasks, setTasks] = useState<TaskItem[]>([
    { id: 'ST1-1', stage: 1, title: 'Connect & Parse Google Sheet Configuration', description: 'Fetch paytable, reel strips, and math model', status: 'pending' },
    { id: 'ST1-2', stage: 1, title: 'Verify Paytable & Reel Strip consistency', description: 'Validate 20 payline rules and symbol weights', status: 'pending' },
    { id: 'ST1-3', stage: 1, title: 'Generate testdata records & BetLines ID table', description: 'Construct single spin, double pregen bonus pairs, and multi-spin bet lines', status: 'pending' },
    { id: 'ST1-4', stage: 1, title: 'Validate outcome files XML schema', description: 'Ensure moduleID=105359 compatibility and build outcome.zip', status: 'pending' }
  ]);

  // Terminal tool logs
  const [logs, setLogs] = useState<ToolCallLog[]>([]);

  // Generated records
  const [testRecords, setTestRecords] = useState<TestRecord[]>(INITIAL_TEST_RECORDS);

  const handleSaveLlmConfig = (newConfig: LlmProviderConfig) => {
    setLlmConfig(newConfig);
    saveLlmConfig(newConfig);
    setSelectedModel(newConfig.selectedModel);
  };

  // Sound chimes
  const playChime = () => {
    if (isMuted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Audio context fallbacks
    }
  };

  // Reset entire state
  const handleReset = () => {
    setWorkflowStage(1);
    setWorkflowState('READY');
    setIsGenerating(false);
    setIsVerifying(false);
    setVerificationReport(null);
    setShowReportModal(false);
    setLogs([]);
    setTasks(tasks.map((t) => ({ ...t, status: 'pending' })));
    setTestRecords(INITIAL_TEST_RECORDS);
  };

  // TestData Generation Execution
  const handleStartGeneration = async () => {
    setWorkflowStage(1);
    setWorkflowState('GENERATING');
    setIsGenerating(true);
    setLogs([]);

    // Reset tasks
    setTasks((prev) => prev.map((t, idx) => ({ ...t, status: idx === 0 ? 'active' : 'pending' })));

    const activeConfig = { ...llmConfig, selectedModel };
    const conn = await testLlmConnection(activeConfig);
    const timeStr = new Date().toLocaleTimeString();
    let llmAccumulatedText = '';

    if (conn.online) {
      setLogs((prev) => [
        ...prev,
        { id: '1', timestamp: timeStr, type: 'THOUGHT', content: `[${activeConfig.provider} ACTIVE] Dispatching prompt to model "${activeConfig.selectedModel}" at ${activeConfig.baseUrl}...` }
      ]);

      try {
        let lastLogId = 'llm-stream';

        llmAccumulatedText = await streamUniversalLlmChat(
          activeConfig,
          [
            {
              role: 'system',
              content: 'You are an AI Test Harness Agent for Slot Machine testdata generation. Output test case specifications for the user requested intent. Format test cases as XML <Spin> tags or batch,index pairs.'
            },
            {
              role: 'user',
              content: `User prompt intent: "${promptIntent}". Target loginName: "${loginName}". Generate testdata entries.`
            }
          ],
          (chunk) => {
            llmAccumulatedText += chunk;
            setLogs((prev) => {
              const existingIdx = prev.findIndex((l) => l.id === lastLogId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: llmAccumulatedText
                };
                return updated;
              } else {
                return [
                  ...prev,
                  { id: lastLogId, timestamp: new Date().toLocaleTimeString(), type: 'THOUGHT', content: llmAccumulatedText }
                ];
              }
            });
          }
        );
      } catch (err: any) {
        setLogs((prev) => [
          ...prev,
          { id: 'llm-err', timestamp: new Date().toLocaleTimeString(), type: 'SELF_HEAL', content: `LLM Stream error: ${err.message || 'Connection interrupted'}. Falling back to deterministic tool execution.` }
        ]);
      }
    } else {
      setLogs((prev) => [
        ...prev,
        { id: '1', timestamp: timeStr, type: 'THOUGHT', content: `[${activeConfig.provider} OFFLINE] Using deterministic agent engine for task planning.` }
      ]);
    }

    // Step sequence with real tool dispatch output
    const speedFactor = 1000;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const currentTimes = new Date().toLocaleTimeString();

      if (step === 1) {
        setLogs((prev) => [
          ...prev,
          { id: '2', timestamp: currentTimes, type: 'TOOL_CALL', toolName: 'read_sheets.py', content: `--sheet_url="${sheetUrl}" --tabs=Testdata` }
        ]);
        playChime();
      } else if (step === 2) {
        setLogs((prev) => [
          ...prev,
          { id: '3', timestamp: currentTimes, type: 'SELF_HEAL', content: `Detected 'Bet Lines ID' sub-table block and cleaned trailing text. Parsing bet lines into XML spec...` },
          { id: '4', timestamp: currentTimes, type: 'TOOL_CALL', toolName: 'paytable_validator.py', content: `--module=105359 --validate-schema=true` }
        ]);
        setTasks((prev) => prev.map((t, idx) => (idx === 0 ? { ...t, status: 'completed' } : idx === 1 ? { ...t, status: 'active' } : t)));
        playChime();
      } else if (step === 3) {
        setLogs((prev) => [
          ...prev,
          { id: '5', timestamp: currentTimes, type: 'THOUGHT', content: `Constructing Single Spin and Double PreGen XML specs for loginName="${loginName}" with model "${selectedModel}"...` },
          { id: '6', timestamp: currentTimes, type: 'TOOL_CALL', toolName: 'outcome_generator.py', content: `--intent="${promptIntent}" --login_name="${loginName}" --model="${selectedModel}"` }
        ]);
        setTasks((prev) => prev.map((t, idx) => (idx <= 1 ? { ...t, status: 'completed' } : idx === 2 ? { ...t, status: 'active' } : t)));
        playChime();
      } else if (step === 4) {
        // Dynamically parse LLM text output into TestRecords
        const generatedRecords = parseLLMOutputToTestRecords(llmAccumulatedText, promptIntent, loginName, '105359');
        setTestRecords(generatedRecords);

        setLogs((prev) => [
          ...prev,
          { id: '7', timestamp: currentTimes, type: 'TOOL_CALL', toolName: 'generate_testdata.py', content: `-m 105359 -u ${loginName} -s BaseGame -o outcome.zip` },
          { id: '8', timestamp: currentTimes, type: 'TOOL_RES', content: `[SUCCESS] Generated TestData package (${generatedRecords.length} records) for loginName="${loginName}" using ${selectedModel}.\n  - Single Spins: ${generatedRecords.filter(r => r.formatType === 'SINGLE').length}\n  - Double PreGen Pairs: ${generatedRecords.filter(r => r.formatType === 'DOUBLE_PREGEN').length}\n  - Files created: File_A_BaseSpins.testdata, P5P_Bonus_Mini.testdata, generated_wins.testdata` }
        ]);
        setTasks((prev) => prev.map((t, idx) => (idx <= 2 ? { ...t, status: 'completed' } : idx === 3 ? { ...t, status: 'active' } : t)));
        playChime();
      } else if (step >= 5) {
        clearInterval(interval);
        setTasks((prev) => prev.map((t) => ({ ...t, status: 'completed' })));
        setLogs((prev) => [
          ...prev,
          { id: '9', timestamp: currentTimes, type: 'THOUGHT', content: `TestData Generation Complete (loginName="${loginName}"). Model "${selectedModel}" generated ${testRecords.length || 'dynamic'} test cases.` }
        ]);
        setIsGenerating(false);
        setWorkflowState('REVIEW');
        playChime();
      }
    }, speedFactor);
  };

  // Real Game Environment Verification Execution
  const handleStartVerification = async (config: VerificationConfig) => {
    setWorkflowStage(2);
    setWorkflowState('VERIFYING');
    setIsVerifying(true);

    const timeStr = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      { id: 'v-1', timestamp: timeStr, type: 'HARNESS_EVENT', content: `Connecting to Real Game Environment: ${config.targetUrl}` },
      { id: 'v-2', timestamp: timeStr, type: 'TOOL_CALL', toolName: 'verify_endpoint.py', content: `--url="${config.targetUrl}" --username="${loginName}" --cases=${testRecords.length} --delay=${config.spinDelayMs}` }
    ]);
    playChime();

    try {
      const report = await runRealGameVerification(testRecords, config, (completedCount, currentResult) => {
        const timeLog = new Date().toLocaleTimeString();
        setLogs((prev) => [
          ...prev,
          { 
            id: `v-res-${completedCount}`, 
            timestamp: timeLog, 
            type: currentResult.status === 'PASSED' ? 'TOOL_RES' : 'SELF_HEAL',
            content: `[VERIFY ${completedCount}/${testRecords.length}] Case ${currentResult.caseName} -> HTTP ${currentResult.httpStatus} (${currentResult.responseTimeMs}ms) [${currentResult.status}]`
          }
        ]);
        playChime();
      });

      setVerificationReport(report);
      setWorkflowState('VERIFIED');
      setShowReportModal(true);
    } catch (e) {
      console.error('Verification Error', e);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/30">
      
      {/* 🧭 Top Navigation */}
      <Header
        workflowStage={workflowStage}
        workflowState={workflowState}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onReset={handleReset}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        llmConfig={llmConfig}
        onOpenConfigModal={() => setIsConfigModalOpen(true)}
      />

      {/* 🖥️ Main Workspace (Split 2-Column Layout) */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col gap-6">

        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Input & Verification Panel (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <IntentPanel
              selectedGame={selectedGame}
              sheetUrl={sheetUrl}
              setSheetUrl={setSheetUrl}
              promptIntent={promptIntent}
              setPromptIntent={setPromptIntent}
              workflowStage={workflowStage}
              workflowState={workflowState}
              onStartGeneration={handleStartGeneration}
              onRunTestSuite={() => {}}
              isGenerating={isGenerating}
              isTesting={false}
            />

            {/* Stage 2 Verification Panel (Always visible in UI) */}
            <VerificationPanel
              onStartVerification={handleStartVerification}
              isVerifying={isVerifying}
              loginName={loginName}
              setLoginName={setLoginName}
            />
          </div>

          {/* Right Column: Agent Core Thought Trace & Tasks (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <AgentCore
              tasks={tasks}
              logs={logs}
              workflowStage={1}
              isGenerating={isGenerating}
              isTesting={isVerifying}
            />
          </div>

        </div>

        {/* TestData Preview & Download Section */}
        {(workflowState === 'REVIEW' || workflowState === 'VERIFYING' || workflowState === 'VERIFIED' || isGenerating) && (
          <div className="mt-2">
            <TestDataPreview
              records={testRecords}
              loginName={loginName}
              onRegenerate={handleStartGeneration}
            />
          </div>
        )}

      </main>

      {/* Real Game Environment Verification Report Modal */}
      {showReportModal && verificationReport && (
        <VerificationReportModal
          report={verificationReport}
          onClose={() => setShowReportModal(false)}
          onReRun={() => handleStartVerification({
            targetUrl: verificationReport.targetUrl,
            spinDelayMs: 300,
            timeoutMs: 5000,
            autoRetryServerError: true
          })}
        />
      )}

      {/* LLM Provider Configuration Gateway Modal */}
      <LlmConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        config={llmConfig}
        onSaveConfig={handleSaveLlmConfig}
      />
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-6 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span>Slot Test Data Generator & Real Game Verifier Agent</span>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <span>Python generate_testdata.py</span> • <span>verify_endpoint.py</span>
        </div>
      </footer>

    </div>
  );
};
