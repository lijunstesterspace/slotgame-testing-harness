import React, { useState, useEffect } from 'react';
import { 
  X, 
  Cpu, 
  Globe, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Save, 
  Eye, 
  EyeOff, 
  Sparkles,
  Zap
} from 'lucide-react';
import { LlmProviderConfig, LlmProviderType } from '../types';
import { PROVIDER_PRESETS, testLlmConnection } from '../utils/llmGateway';

interface LlmConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LlmProviderConfig;
  onSaveConfig: (newConfig: LlmProviderConfig) => void;
}

export const LlmConfigModal: React.FC<LlmConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig
}) => {
  const [provider, setProvider] = useState<LlmProviderType>(config.provider || 'OLLAMA');
  const [baseUrl, setBaseUrl] = useState<string>(config.baseUrl || '/ollama');
  const [apiKey, setApiKey] = useState<string>(config.apiKey || '');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>(config.selectedModel || 'qwen2.5-coder:7b');
  const [customModelInput, setCustomModelInput] = useState<string>('');

  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    online: boolean;
    models: string[];
    latencyMs: number;
    error?: string;
  } | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setProvider(config.provider || 'OLLAMA');
      setBaseUrl(config.baseUrl || '/ollama');
      setApiKey(config.apiKey || '');
      setSelectedModel(config.selectedModel || 'qwen2.5-coder:7b');
      setTestResult(null);
    }
  }, [isOpen, config]);

  // Handle Provider preset switch
  const handleProviderSwitch = (newProvider: LlmProviderType) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    setBaseUrl(preset.defaultUrl);
    setSelectedModel(preset.defaultModels[0]);
    setTestResult(null);
  };

  // Test LLM Endpoint Connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const activeModel = customModelInput.trim() || selectedModel;
    const tempConfig: LlmProviderConfig = {
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      selectedModel: activeModel,
      availableModels: PROVIDER_PRESETS[provider].defaultModels
    };

    const result = await testLlmConnection(tempConfig);
    setTestResult(result);
    setTesting(false);

    if (result.online && result.models.length > 0) {
      if (!result.models.includes(activeModel)) {
        setSelectedModel(result.models[0]);
      }
    }
  };

  const handleSave = () => {
    const finalModel = customModelInput.trim() || selectedModel;
    const newConfig: LlmProviderConfig = {
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      selectedModel: finalModel,
      availableModels: testResult?.models.length ? testResult.models : PROVIDER_PRESETS[provider].defaultModels
    };

    onSaveConfig(newConfig);
    onClose();
  };

  if (!isOpen) return null;

  const currentModels = testResult?.models?.length 
    ? testResult.models 
    : PROVIDER_PRESETS[provider].defaultModels;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-800/60 text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Universal LLM Provider Gateway Configuration
              </h2>
              <p className="text-xs text-slate-400">
                Connect and configure local Ollama, OpenAI, Claude, or custom enterprise gateways
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[75vh]">
          
          {/* 1. Provider Tabs */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
              Select AI LLM Provider Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(PROVIDER_PRESETS) as LlmProviderType[]).map((pKey) => {
                const isActive = provider === pKey;
                return (
                  <button
                    key={pKey}
                    type="button"
                    onClick={() => handleProviderSwitch(pKey)}
                    className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition ${
                      isActive
                        ? 'bg-cyan-950/50 border-cyan-500/80 text-cyan-300 shadow-md glow-cyan'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Zap className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span>{pKey}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Base Endpoint URL Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-cyan-400" /> Base Endpoint URL
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Default: {PROVIDER_PRESETS[provider].defaultUrl}
              </span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="e.g. http://localhost:11434 or https://api.openai.com/v1"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* 3. API Key Input */}
          {provider !== 'OLLAMA' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-amber-400" /> Bearer API Key (Optional / Masked)
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full pl-3 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* 4. Active Model Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-emerald-400" /> Active Reasoning Model
              </span>
            </label>

            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
            >
              {currentModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                placeholder="Or type custom model name (e.g. qwen2.5-coder-32b)"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* 5. Connection Test Banner */}
          {testResult && (
            <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
              testResult.online
                ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
            }`}>
              <div className="flex items-center gap-2">
                {testResult.online ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
                <div>
                  <span className="font-bold">{testResult.online ? 'Connection Successful!' : 'Connection Failed'}</span>
                  <p className="text-[11px] text-slate-400">{testResult.error || `Latency: ${testResult.latencyMs}ms • Found ${testResult.models.length} models`}</p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Toolbar */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin text-cyan-400" /> : <Sparkles className="w-4 h-4 text-cyan-400" />}
            <span>{testing ? 'Testing Endpoint...' : '⚡ Test Connection'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 text-xs font-bold shadow-lg glow-emerald flex items-center gap-1.5 transition"
            >
              <Save className="w-4 h-4" />
              <span>Save Configuration</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
