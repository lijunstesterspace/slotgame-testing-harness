import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, 
  Loader2, 
  Circle, 
  Terminal, 
  Copy, 
  Check, 
  Wrench, 
  Brain, 
  ShieldAlert, 
  Lock, 
  Unlock,
  Sparkles
} from 'lucide-react';
import { TaskItem, ToolCallLog, WorkflowStage } from '../types';

interface AgentCoreProps {
  tasks: TaskItem[];
  logs: ToolCallLog[];
  workflowStage: WorkflowStage;
  isGenerating: boolean;
  isTesting: boolean;
}

export const AgentCore: React.FC<AgentCoreProps> = ({
  tasks,
  logs,
  workflowStage,
  isGenerating,
  isTesting
}) => {
  const [activeTab, setActiveTab] = useState<'COT' | 'RAW_TOOLS' | 'SYSTEM'>('COT');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom inside terminal container ONLY (keeps browser page fixed)
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

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4 h-full min-h-[520px]">
      
      {/* 1. Header & Section Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
            <Brain className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">Agent Core & Thought Trace</h2>
            <p className="text-xs text-slate-400">Real-time COT reasoning, tool dispatching & self-healing</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
            isGenerating || isTesting
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isGenerating || isTesting ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {isGenerating ? 'Stage 1 Generating...' : isTesting ? 'Stage 2 Executing...' : 'Agent Idle / Standing By'}
          </span>
        </div>
      </div>

      {/* 2. Dynamic Task Checklist */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 flex items-center justify-between">
          <span>Task Planning & Execution Steps ({workflowStage === 1 ? 'Stage 1' : 'Stage 2'})</span>
          <span className="text-emerald-400">{tasks.filter((t) => t.status === 'completed').length} / {tasks.length} Done</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`p-2.5 rounded-lg border text-xs flex items-center gap-2.5 transition ${
                task.status === 'completed'
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
                  : task.status === 'active'
                  ? 'bg-amber-950/30 border-amber-500/50 text-amber-200 shadow-md glow-amber'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 opacity-70'
              }`}
            >
              {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
              {task.status === 'active' && <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />}
              {task.status === 'pending' && <Circle className="w-4 h-4 text-slate-600 flex-shrink-0" />}
              <span className="font-medium truncate">{task.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Live Thought & Tool Console Terminal */}
      <div className="flex-1 flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs">
        
        {/* Terminal Header & Toolbar */}
        <div className="bg-slate-900/90 px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          
          {/* Tab Switcher */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('COT')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                activeTab === 'COT'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Streaming COT Logs
            </button>
            <button
              onClick={() => setActiveTab('RAW_TOOLS')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                activeTab === 'RAW_TOOLS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tool Payloads
            </button>
          </div>

          {/* Terminal Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-1.5 rounded text-[11px] transition ${
                autoScroll ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={autoScroll ? 'Auto-scroll lock enabled' : 'Auto-scroll lock disabled'}
            >
              {autoScroll ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={handleCopyLogs}
              className="p-1.5 rounded text-[11px] text-slate-400 hover:text-slate-200 transition flex items-center gap-1"
              title="Copy terminal logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

        </div>

        {/* Terminal Content Box */}
        <div ref={terminalContainerRef} className="flex-1 p-3 overflow-y-auto max-h-[340px] flex flex-col gap-2 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic p-4 text-center">
              Terminal idle. Click "Start Agent Generation" to stream live reasoning & Python tool dispatches...
            </div>
          ) : (
            logs.map((log) => {
              if (log.type === 'THOUGHT') {
                return (
                  <div key={log.id} className="text-slate-300 flex items-start gap-2">
                    <span className="text-slate-500 flex-shrink-0">[{log.timestamp}]</span>
                    <span className="text-emerald-400 font-bold flex-shrink-0">🧠 [THOUGHT]</span>
                    <span className="text-slate-200">{log.content}</span>
                  </div>
                );
              }

              if (log.type === 'TOOL_CALL') {
                return (
                  <div key={log.id} className="text-cyan-300 flex items-start gap-2 bg-cyan-950/20 p-1.5 rounded border border-cyan-900/30">
                    <span className="text-slate-500 flex-shrink-0">[{log.timestamp}]</span>
                    <span className="text-cyan-400 font-bold flex-shrink-0">⚡ [TOOL CALL]</span>
                    <span className="font-bold text-white">{log.toolName}</span>
                    <span className="text-cyan-200/90">{log.content}</span>
                  </div>
                );
              }

              if (log.type === 'TOOL_RES') {
                return (
                  <div key={log.id} className="text-slate-400 pl-6 border-l-2 border-slate-700 my-0.5">
                    <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {log.content}
                    </pre>
                  </div>
                );
              }

              if (log.type === 'SELF_HEAL') {
                return (
                  <div key={log.id} className="text-amber-300 bg-amber-950/30 p-2 rounded border border-amber-700/50 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-400">🔧 [SELF-HEALING DETECTED]</span>
                      <p className="mt-0.5 text-slate-200">{log.content}</p>
                    </div>
                  </div>
                );
              }

              if (log.type === 'HARNESS_EVENT') {
                return (
                  <div key={log.id} className="text-emerald-300 bg-emerald-950/30 p-2 rounded border border-emerald-700/50 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-emerald-400">🧪 [HARNESS TEST EVENT]</span>
                      <p className="mt-0.5 text-slate-200">{log.content}</p>
                    </div>
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
