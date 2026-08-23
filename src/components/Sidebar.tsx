import React, { useState } from 'react';
import {
  Puzzle, CheckCircle2, Loader2, Circle,
  ChevronDown, ChevronRight, Brain,
} from 'lucide-react';
import { TaskItem } from '../types';

// ── Props ──────────────────────────────────────────────────────
interface SidebarProps {
  tasks: TaskItem[];
  onOpenPlugin?: () => void;
}

// ── Component ──────────────────────────────────────────────────
export const Sidebar: React.FC<SidebarProps> = ({ tasks, onOpenPlugin }) => {
  const [taskOpen, setTaskOpen] = useState(true);

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