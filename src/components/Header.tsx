import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Cpu, 
  ChevronDown, 
  Volume2, 
  VolumeX, 
  RotateCcw, 
  Sparkles,
  Settings,
  Globe
} from 'lucide-react';
import { WorkflowStage, WorkflowState, LlmProviderConfig } from '../types';
import { testLlmConnection } from '../utils/llmGateway';

interface HeaderProps {
  workflowStage: WorkflowStage;
  workflowState: WorkflowState;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  onReset: () => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  llmConfig: LlmProviderConfig;
  onOpenConfigModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workflowStage,
  workflowState,
  isMuted,
  setIsMuted,
  onReset,
  selectedModel,
  setSelectedModel,
  llmConfig,
  onOpenConfigModal
}) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{ online: boolean; latencyMs?: number }>({ online: true });

  useEffect(() => {
    testLlmConnection(llmConfig).then((res) => {
      setConnectionStatus({ online: res.online, latencyMs: res.latencyMs });
      if (res.online && res.models.length > 0 && !res.models.includes(selectedModel)) {
        setSelectedModel(res.models[0]);
      }
    });
  }, [llmConfig]);

  const availableModels = llmConfig.availableModels && llmConfig.availableModels.length > 0
    ? llmConfig.availableModels
    : [selectedModel];

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        
        {/* Left: App Title & Brand */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Bot className="w-6 h-6 text-slate-950 stroke-[2.25]" />
            </div>
            <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 border-2 border-slate-900 rounded-full ${connectionStatus.online ? 'bg-emerald-400 animate-pulse' : 'bg-amber-500'}`}></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Slot Test Automation AI Assistant
              </h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> UNIVERSAL AI HARNESS
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Dynamic TestData Generation Engine & Universal Multi-Model LLM Harness
            </p>
          </div>
        </div>

        {/* Center: Model Selector & Provider Status */}
        <div className="flex items-center gap-2.5">
          
          {/* Provider Badge */}
          <div className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${
            connectionStatus.online 
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
          }`} title={llmConfig.baseUrl}>
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>{llmConfig.provider} {connectionStatus.online ? 'Online' : 'Offline'}</span>
          </div>

          {/* Model Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 text-xs font-medium text-slate-200 transition"
            >
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>{selectedModel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isModelDropdownOpen && (
              <div className="absolute left-0 mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 py-1">
                <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                  Select Active Model ({llmConfig.provider})
                </div>
                {availableModels.map((model) => (
                  <button
                    key={model}
                    onClick={() => {
                      setSelectedModel(model);
                      setIsModelDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-800 transition ${
                      selectedModel === model ? 'text-emerald-400 font-semibold bg-emerald-950/30' : 'text-slate-300'
                    }`}
                  >
                    <span>{model}</span>
                    {selectedModel === model && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* LLM Config Button */}
          <button
            onClick={onOpenConfigModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-700/70 text-cyan-300 text-xs font-semibold shadow-sm transition"
            title="Configure LLM Provider & Gateway"
          >
            <Settings className="w-3.5 h-3.5 text-cyan-400" />
            <span>LLM Config</span>
          </button>

        </div>

        {/* Right: Sound & Reset Controls */}
        <div className="flex items-center gap-2">

          {/* Sound Mute Toggle */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/70 text-slate-400 hover:text-slate-200 transition"
            title={isMuted ? 'Unmute audio feedback' : 'Mute audio feedback'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* Reset State Button */}
          <button
            onClick={onReset}
            className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/70 text-slate-400 hover:text-rose-400 transition"
            title="Reset Workflow State"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};
