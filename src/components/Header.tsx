import React from "react";
import { Bot, LogOut, Volume2, VolumeX, RotateCcw, ServerCog } from "lucide-react";
import { SlotGameConfig, WorkflowStage, WorkflowState, LlmProviderConfig } from "../types";
import { PROVIDER_PRESETS } from "../utils/llmGateway";

interface Props {
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  onReset: () => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  llmConfig: LlmProviderConfig;
  onOpenConfigModal: () => void;
  user: { username: string; role: string; isAdmin: boolean } | null;
  onLogout: () => void;
}

const STAGE_LABELS = ["1. Intent", "2. Generation", "3. Review", "4. Verification", "5. Verified"];

export const Header: React.FC<Props> = ({
  workflowStage,
  workflowState,
  isMuted,
  setIsMuted,
  onReset,
  selectedModel,
  setSelectedModel,
  llmConfig,
  onOpenConfigModal,
  user,
  onLogout,
}) => {
  const preset = PROVIDER_PRESETS[llmConfig.provider];
  const risky = !!preset.complianceRisk;

  const stateBadge: Record<WorkflowState, { text: string; cls: string }> = {
    READY: { text: "READY", cls: "bg-slate-800 text-slate-300" },
    GENERATING: { text: "GENERATING", cls: "bg-cyan-950 text-cyan-300 border border-cyan-700/50 animate-pulse" },
    REVIEW: { text: "REVIEW", cls: "bg-amber-950 text-amber-300 border border-amber-700/50" },
    VERIFYING: { text: "VERIFYING", cls: "bg-purple-950 text-purple-300 border border-purple-700/50 animate-pulse" },
    VERIFIED: { text: "VERIFIED", cls: "bg-emerald-950 text-emerald-300 border border-emerald-700/50" },
  };
  const badge = stateBadge[workflowState];

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-900 shadow-lg shadow-emerald-500/20">
          <Bot className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Slot AI HARNESS</h1>
          <p className="text-[10px] text-slate-400 font-mono">HOLISTIC AGENT RUNTIME · E2E SLO & AUDIT</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {STAGE_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <div className={`w-4 h-px ${i <= 3 ? "bg-emerald-500/50" : "bg-slate-700"}`} />}
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  workflowStage === i + 1
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                    : workflowStage > i + 1
                    ? "bg-slate-800 border-slate-700 text-slate-300"
                    : "bg-slate-900 border-slate-800 text-slate-500"
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono ${badge.cls}`}>{badge.text}</span>

        <button
          onClick={onOpenConfigModal}
          title={`${preset.name} · ${llmConfig.baseUrl}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs hover:border-emerald-500/50 transition-colors"
        >
          <ServerCog className={`w-4 h-4 ${risky ? "text-amber-400" : "text-emerald-400"}`} />
          <span className="text-slate-300">{preset.name}</span>
        </button>

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          title={preset.name}
          className="bg-slate-800 border border-slate-700 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
        >
          {(llmConfig.availableModels.length ? llmConfig.availableModels : preset.defaultModels).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {user && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700">
            <span className="text-[10px] font-mono text-cyan-300">👤 {user.username}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${user.isAdmin ? "bg-purple-950 text-purple-300 border border-purple-800/50" : "bg-slate-900 text-slate-400"}`}>
              {user.role}
            </span>
          </div>
        )}

        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>

        {user && (
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950/30 border border-rose-800/40 hover:bg-rose-950/50 transition-colors"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        )}
      </div>
    </header>
  );
};
