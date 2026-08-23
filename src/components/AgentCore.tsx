import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Loader2, Terminal, Copy, Check, Brain,
  Sparkles, Database, Shield, Zap, FileText, Wrench
} from 'lucide-react';
import { TaskItem, ToolCallLog, WorkflowStage, WorkflowState } from '../types';

// ── Props ──────────────────────────────────────────────────────
interface AgentCoreProps {
  tasks: TaskItem[];
  logs: ToolCallLog[];
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isGenerating: boolean;
  isTesting: boolean;
}

// ── Pipeline stages ────────────────────────────────────────────
interface PipelineStage {
  id: number;
  label: string;
  icon: React.ReactNode;
  desc: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 1, label: 'Intent',       icon: <Brain className="w-4 h-4" />,       desc: 'Parse requirements' },
  { id: 2, label: 'Generate',     icon: <Zap className="w-4 h-4" />,        desc: 'AI data generation' },
  { id: 3, label: 'Review',       icon: <FileText className="w-4 h-4" />,   desc: 'Preview results' },
  { id: 4, label: 'Verify',       icon: <Wrench className="w-4 h-4" />,     desc: 'Game verification' },
  { id: 5, label: 'Complete',     icon: <CheckCircle2 className="w-4 h-4" />, desc: 'Done' },
];

// ── Component ──────────────────────────────────────────────────
export const AgentCore: React.FC<AgentCoreProps> = ({
  tasks,
  logs,
  workflowStage,
  workflowState,
  isGenerating,
  isTesting,
}) => {
  const [activeTab, setActiveTab] = useState<'COT' | 'RAW_TOOLS' | 'SYSTEM'>('COT');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.type}] ${l.toolName ? `[${l.toolName}] ` : ''}${l.content}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isRunning = isGenerating || isTesting;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Pipeline Visualization ── */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-950/60 border border-indigo-800/50 text-indigo-400">
              <Database className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Pipeline</span>
          </div>
          <span className={`text-[10px] font-mono px-2 py-1 rounded-full ${
            isRunning
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse'
              : 'bg-slate-800 text-slate-500 border border-slate-700'
          }`}>
            {isRunning ? 'RUNNING' : workflowState}
          </span>
        </div>

        <div className="flex items-center gap-0">
          {PIPELINE_STAGES.map((stage, i) => {
            const isActive = workflowStage === stage.id;
            const isPast = workflowStage > stage.id;
            const isFuture = workflowStage < stage.id;

            return (
              <React.Fragment key={stage.id}>
                {/* Node */}
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`p-2 rounded-xl border-2 transition-all duration-500 ${
                    isActive
                      ? 'bg-emerald-950/40 border-emerald-400 shadow-lg shadow-emerald-500/20 scale-110'
                      : isPast
                      ? 'bg-slate-800 border-emerald-700/50 text-emerald-400'
                      : 'bg-slate-950 border-slate-700 text-slate-600'
                  }`}>
                    <span className={isActive ? 'text-emerald-400' : isPast ? 'text-emerald-400' : 'text-slate-600'}>
                      {stage.icon}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold font-mono ${
                    isActive ? 'text-emerald-300' : isPast ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {stage.label}
                  </span>
                  <span className={`text-[9px] font-mono hidden sm:block ${
                    isActive ? 'text-emerald-400/70' : 'text-slate-600'
                  }`}>
                    {stage.desc}
                  </span>
                </div>

                {/* Connector line */}
                {i < PIPELINE_STAGES.length - 1 && (
                  <div className={`flex-1 h-px mb-6 ${
                    isPast || (isActive && workflowState === 'GENERATING')
                      ? 'bg-emerald-500/50'
                      : isActive
                      ? 'bg-gradient-to-r from-emerald-500/50 to-slate-700'
                      : 'bg-slate-800'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Execution Console ── */}
      <div className="flex-1 flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Terminal Header */}
        <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <Terminal className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-300">Execution Console</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('COT')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition ${
                  activeTab === 'COT'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                COT Logs
              </button>
              <button
                onClick={() => setActiveTab('RAW_TOOLS')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition ${
                  activeTab === 'RAW_TOOLS'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tool Payloads
              </button>
            </div>

            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-1.5 rounded text-[10px] transition ${
                autoScroll ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
            >
              <span className="font-mono">{autoScroll ? 'A⇣' : 'A⇢'}</span>
            </button>

            <button
              onClick={handleCopyLogs}
              className="p-1.5 rounded text-[10px] text-slate-400 hover:text-slate-200 transition"
              title="Copy logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Terminal Content */}
        <div ref={terminalContainerRef} className="flex-1 p-4 overflow-y-auto flex flex-col gap-2 font-mono text-[11px] leading-relaxed bg-slate-950">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic p-4 text-center">
              Execution console idle. Start a task to stream live AI reasoning &amp; tool dispatches...
            </div>
          ) : (
            logs.map((log) => {
              if (log.type === 'THOUGHT') {
                return (
                  <div key={log.id} className="text-slate-300 flex items-start gap-2">
                    <span className="text-slate-600 flex-shrink-0 text-[10px]">[{log.timestamp}]</span>
                    <span className="text-emerald-400 font-bold flex-shrink-0 text-[10px]">[THOUGHT]</span>
                    <span className="text-slate-200">{log.content}</span>
                  </div>
                );
              }

              if (log.type === 'TOOL_CALL') {
                return (
                  <div key={log.id} className="text-cyan-300 flex items-start gap-2 bg-cyan-950/20 p-2 rounded border border-cyan-900/30">
                    <span className="text-slate-600 flex-shrink-0 text-[10px]">[{log.timestamp}]</span>
                    <span className="text-cyan-400 font-bold flex-shrink-0 text-[10px]">[TOOL CALL]</span>
                    <span className="font-bold text-white">{log.toolName}</span>
                    <span className="text-cyan-200/90">{log.content}</span>
                  </div>
                );
              }

              if (log.type === 'TOOL_RES') {
                return (
                  <div key={log.id} className="text-slate-400 pl-4 border-l-2 border-slate-700 my-0.5">
                    <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {log.content}
                    </pre>
                  </div>
                );
              }

              if (log.type === 'SELF_HEAL') {
                return (
                  <div key={log.id} className="text-amber-300 bg-amber-950/30 p-2 rounded border border-amber-700/50 flex items-start gap-2">
                    <span className="text-amber-400 font-bold text-[10px]">[SELF-HEAL]</span>
                    <span className="text-slate-200">{log.content}</span>
                  </div>
                );
              }

              if (log.type === 'HARNESS_EVENT') {
                return (
                  <div key={log.id} className="text-emerald-300 bg-emerald-950/30 p-2 rounded border border-emerald-700/50 flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-200">{log.content}</span>
                  </div>
                );
              }

              return null;
            })
          )}
        </div>
      </div>
    </div>
  );
};