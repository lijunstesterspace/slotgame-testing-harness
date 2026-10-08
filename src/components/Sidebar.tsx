import React, { useState } from 'react';
import {
  Puzzle, CheckCircle2, Loader2, Circle,
  ChevronDown, ChevronRight, Brain, Bot,
  Zap, Shield, Bug, FileText, Globe, History,
} from 'lucide-react';
import { TaskItem } from '../types';
import { SCENARIOS } from '../harness/intentRouter';
import type { TestScenario } from '../harness/sharedTypes';

// ── icon mapping ─────────────────────────────────────────────────
const SCENARIO_ICONS: Record<TestScenario['icon'], React.ReactNode> = {
  zap: <Zap className="w-3.5 h-3.5" />,
  shield: <Shield className="w-3.5 h-3.5" />,
  bug: <Bug className="w-3.5 h-3.5" />,
  'file-text': <FileText className="w-3.5 h-3.5" />,
  globe: <Globe className="w-3.5 h-3.5" />,
};

// ── Props ─────────────────────────────────────────────────────
interface SidebarProps {
  tasks: TaskItem[];
  onOpenPlugin?: () => void;
  onOpenAgent?: () => void;
  onOpenHistory?: () => void;
  selectedScenarioId?: string;
  onSelectScenario?: (scenarioId: string) => void;
}

// ── Component ──────────────────────────────────────────────────
export const Sidebar: React.FC<SidebarProps> = ({ tasks, onOpenPlugin, onOpenAgent, onOpenHistory, selectedScenarioId, onSelectScenario }) => {
  const [taskOpen, setTaskOpen] = useState(true);
  const [scenarioOpen, setScenarioOpen] = useState(true);

  return (
    <aside className="w-[220px] min-w-[220px] bg-slate-900/80 border-r border-slate-800 flex flex-col overflow-y-auto select-none">

      {/* ── Plugin (navigates to PluginPage) ── */}
      <div className="border-b border-slate-800">
        <button
          onClick={onOpenPlugin}
          className="w-full flex items-center gap-2 px-3 py-3 hover:bg-slate-800/50 transition-colors"
        >
          <div className="p-1 rounded-md bg-cyan-950/60 border border-cyan-800/40 text-cyan-400">
            <Puzzle className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Plugin</span>
        </button>
      </div>

      {/* ─ Agents (navigates to AgentPage) ─ */}
      <div className="border-b border-slate-800">
        <button
          onClick={onOpenAgent}
          className="w-full flex items-center gap-2 px-3 py-3 hover:bg-slate-800/50 transition-colors"
        >
          <div className="p-1 rounded-md bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Agents</span>
        </button>
      </div>

      {/* ── History (navigates to HistoryPage, reopens a past Verification report) ── */}
      <div className="border-b border-slate-800">
        <button
          onClick={onOpenHistory}
          className="w-full flex items-center gap-2 px-3 py-3 hover:bg-slate-800/50 transition-colors"
        >
          <div className="p-1 rounded-md bg-amber-950/60 border border-amber-800/40 text-amber-400">
            <History className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">History</span>
        </button>
      </div>

      {/* ── Scenarios (test scenario selector) ── */}
      <div className="border-b border-slate-800">
        <button
          onClick={() => setScenarioOpen(!scenarioOpen)}
          className="w-full flex items-center justify-between px-3 py-3 hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-violet-950/60 border border-violet-800/40 text-violet-400">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Scenarios</span>
          </div>
          {scenarioOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
        </button>

        {scenarioOpen && (
          <div className="px-3 pb-3 flex flex-col gap-1">
            {SCENARIOS.map((sc) => {
              const isSelected = selectedScenarioId === sc.id;
              return (
                <button
                  key={sc.id}
                  onClick={() => onSelectScenario?.(sc.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] text-left transition-all ${
                    isSelected
                      ? 'bg-violet-950/30 border-violet-500/50 text-violet-200 shadow-md'
                      : 'bg-slate-950/40 border-slate-800/50 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  <span className={isSelected ? 'text-violet-400' : 'text-slate-500'}>
                    {SCENARIO_ICONS[sc.icon]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{sc.label}</div>
                    <div className="text-[9px] text-slate-500 truncate">{sc.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Task List ── */}
      <div className="flex-1">
        <button
          onClick={() => setTaskOpen(!taskOpen)}
          className="w-full flex items-center justify-between px-3 py-3 hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-amber-950/60 border border-amber-800/40 text-amber-400">
              <Brain className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Task List</span>
            <span className="text-[10px] text-slate-500 font-mono">
              ({tasks.filter((t) => t.status === 'completed').length}/{tasks.length})
            </span>
          </div>
          {taskOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
        </button>

        {taskOpen && (
          <div className="px-3 pb-3 flex flex-col gap-1">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] transition-all ${
                  task.status === 'completed'
                    ? 'bg-emerald-950/20 border-emerald-800/30 text-emerald-200'
                    : task.status === 'active'
                    ? 'bg-amber-950/30 border-amber-500/50 text-amber-200 shadow-md'
                    : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                }`}
              >
                {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
                {task.status === 'active' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />}
                {task.status === 'pending' && <Circle className="w-3 h-3 text-slate-600 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{task.title}</div>
                  <div className="text-[9px] text-slate-500 truncate">{task.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};