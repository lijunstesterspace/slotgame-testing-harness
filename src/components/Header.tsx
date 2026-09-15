import React from 'react';
import {
  Settings, RotateCcw, Volume2, VolumeX,
  Bot, Activity, Sparkles, Shield, CheckCircle2, Wrench, FileText, Zap
} from 'lucide-react';
import { WorkflowStage, WorkflowState } from '../types';

interface HeaderProps {
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isMuted: boolean;
  setIsMuted: (v: boolean) => void;
  onReset: () => void;
  onOpenConfig: () => void;
}

const STAGE_META: Record<number, { label: string; icon: React.ReactNode }> = {
  1: { label: 'Intent', icon: <Sparkles className="w-3.5 h-3.5" /> },
  2: { label: 'Generate', icon: <Zap className="w-3.5 h-3.5" /> },
  3: { label: 'Review', icon: <FileText className="w-3.5 h-3.5" /> },
  4: { label: 'Verify', icon: <Wrench className="w-3.5 h-3.5" /> },
  5: { label: 'Done', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

export const Header: React.FC<HeaderProps> = ({
  workflowStage,
  workflowState,
  isMuted,
  setIsMuted,
  onReset,
  onOpenConfig,
}) => {
  return (
    <header className="bg-slate-900/90 border-b border-slate-800 px-5 py-2.5 flex items-center justify-between shadow-lg">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/30">
            <Bot className="w-4 h-4 text-slate-950" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold text-white tracking-tight">Slot Game Testing <span className="text-emerald-400">Harness</span></h1>
            <p className="text-[9px] text-slate-500 font-mono">v2 · PlannerAgent + ToolRegistry</p>
          </div>
        </div>
      </div>

      {/* Center: Stage indicators */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((stage) => {
          const meta = STAGE_META[stage];
          const isActive = workflowStage === stage;
          const isPast = workflowStage > stage;
          return (
            <div
              key={stage}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isPast
                  ? 'bg-slate-800 text-slate-400 border border-slate-700'
                  : 'text-slate-600'
              }`}
            >
              <span className={isActive ? 'text-emerald-400' : isPast ? 'text-emerald-400' : 'text-slate-600'}>
                {meta.icon}
              </span>
              <span className="hidden sm:inline">{meta.label}</span>
            </div>
          );
        })}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono px-2 py-1 rounded-full ${
          workflowState === 'GENERATING' || workflowState === 'VERIFYING'
            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse'
            : 'bg-slate-800 text-slate-500 border border-slate-700'
        }`}>
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {workflowState}
          </span>
        </span>

        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onOpenConfig}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          title="Model Management"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onReset}
          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
          title="Reset workflow"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};