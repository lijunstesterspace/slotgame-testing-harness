import React from 'react';
import { CheckCircle2, Brain, Database, Zap, FileText, Wrench } from 'lucide-react';
import { WorkflowStage, WorkflowState } from '../types';

// ── Props ──────────────────────────────────────────────────────
interface PipelineVisualizationProps {
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isGenerating: boolean;
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
export const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({
  workflowStage,
  workflowState,
  isGenerating,
}) => {
  const isRunning = isGenerating;

  return (
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

      <div className="flex flex-col gap-0">
        {PIPELINE_STAGES.map((stage, i) => {
          const isActive = workflowStage === stage.id;
          const isPast = workflowStage > stage.id;

          return (
            <React.Fragment key={stage.id}>
              {/* Node */}
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border-2 transition-all duration-500 flex-shrink-0 ${
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
                <div className="flex flex-col min-w-0">
                  <span className={`text-[10px] font-bold font-mono ${
                    isActive ? 'text-emerald-300' : isPast ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {stage.label}
                  </span>
                  <span className={`text-[9px] font-mono truncate ${
                    isActive ? 'text-emerald-400/70' : 'text-slate-600'
                  }`}>
                    {stage.desc}
                  </span>
                </div>
              </div>

              {/* Connector line (vertical, in the stacked right-column layout) */}
              {i < PIPELINE_STAGES.length - 1 && (
                <div className={`w-px h-4 ml-[19px] ${
                  isPast || (isActive && workflowState === 'GENERATING')
                    ? 'bg-emerald-500/50'
                    : isActive
                    ? 'bg-gradient-to-b from-emerald-500/50 to-slate-700'
                    : 'bg-slate-800'
                }`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
