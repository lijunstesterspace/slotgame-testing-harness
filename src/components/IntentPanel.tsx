import React from 'react';
import { 
  FileSpreadsheet, 
  Sparkles, 
  Play, 
  Bot,
  RefreshCw
} from 'lucide-react';
import { SlotGameConfig, WorkflowStage, WorkflowState } from '../types';

interface IntentPanelProps {
  selectedGame: SlotGameConfig;
  sheetUrl: string;
  setSheetUrl: (url: string) => void;
  promptIntent: string;
  setPromptIntent: (intent: string) => void;
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  onStartGeneration: () => void;
  onRunTestSuite: () => void;
  isGenerating: boolean;
  isTesting: boolean;
}

export const IntentPanel: React.FC<IntentPanelProps> = ({
  selectedGame,
  sheetUrl,
  setSheetUrl,
  promptIntent,
  setPromptIntent,
  onStartGeneration,
  isGenerating
}) => {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-5 relative overflow-hidden">
      
      {/* Background Subtle Gradient Glow */}
      <div className="absolute top-0 right-0 -mt-12 -mr-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Title Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">TestData Generation Intent & Data Source</h2>
            <p className="text-xs text-slate-400">Feed testdata file</p>
          </div>
        </div>
      </div>

      {/* 1. Google Sheet Source Input */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Google sheet for testdata file
          </span>
        </label>

        <div className="relative">
          <input
            type="text"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-full pl-3 pr-24 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/30 font-mono transition"
          />
          <button 
            onClick={() => setSheetUrl(`https://docs.google.com/spreadsheets/d/1X9_MedusasGold_Paytable_v2/edit#gid=10539`)}
            className="absolute right-1.5 top-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition"
          >
            Reset URL
          </button>
        </div>

      </div>

      {/* 2. Prompt / Intent Input */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            Natural Language Agent Intent / Test Goal
          </span>
        </label>

        <textarea
          value={promptIntent}
          onChange={(e) => setPromptIntent(e.target.value)}
          rows={3}
          placeholder="Create testdata"
          className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/30 transition resize-none leading-relaxed"
        />

      </div>

      {/* 3. Primary CTA Generation Button */}
      <div className="pt-2">
        <button
          onClick={onStartGeneration}
          disabled={isGenerating}
          className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm text-slate-950 flex items-center justify-center gap-2 shadow-lg transition transform active:scale-[0.99] ${
            isGenerating
              ? 'bg-amber-400 cursor-not-allowed opacity-90'
              : 'bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 glow-emerald'
          }`}
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Agent Generating TestData...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-slate-950" />
              <span>🚀 Start TestData Generation</span>
            </>
          )}
        </button>
      </div>

    </div>
  );
};
