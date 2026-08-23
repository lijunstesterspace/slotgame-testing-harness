import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Plus, Trash2, Check, Star, StarOff,
  Server, Key, Wifi, WifiOff, CheckCircle2, RefreshCw,
  Shield, ShieldAlert, GripVertical, Save, Bot,
} from "lucide-react";
import type { LlmModelEntry, LlmProviderType } from "../types";
import {
  PROVIDER_PRESETS,
  loadStoredModels,
  saveStoredModels,
  testLlmConnection,
  toLlmProviderConfig,
  getActiveModelConfig,
  saveLlmConfig,
} from "../utils/llmGateway";

interface Props {
  onBack: () => void;
  onConfigChanged: () => void;
}

const TABS: LlmProviderType[] = ["OLLAMA", "OPENAI", "ANTHROPIC", "CUSTOM"];

const COMPLIANCE_REMINDER =
  "⚠️ Selecting an external Provider will send request data to third-party APIs. Confirm compliance with company policies before proceeding.";

function genId(): string {
  return `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createNewEntry(provider: LlmProviderType): LlmModelEntry {
  const preset = PROVIDER_PRESETS[provider];
  return {
    id: genId(),
    name: `New ${provider}`,
    provider,
    baseUrl: preset.defaultUrl,
    apiKey: "",
    selectedModel: preset.defaultModels[0],
    availableModels: [...preset.defaultModels],
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
}

export const LlmConfigPage: React.FC<Props> = ({ onBack, onConfigChanged }) => {
  const [models, setModels] = useState<LlmModelEntry[]>(() => loadStoredModels());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const m = loadStoredModels();
    return m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? null;
  });

  // Edit draft
  const [draft, setDraft] = useState<LlmModelEntry | null>(null);
  const [activeTab, setActiveTab] = useState<LlmProviderType>("OLLAMA");
  const [complianceChecked, setComplianceChecked] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<null | { online: boolean; latencyMs: number; error?: string; models: string[] }>(null);
  const [pinging, setPinging] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load draft when selected model changes
  useEffect(() => {
    const m = models.find((x) => x.id === selectedId);
    if (m) {
      setDraft({ ...m });
      setActiveTab(m.provider);
      setHealth(null);
    } else {
      setDraft(null);
    }
  }, [selectedId, models]);

  const selectedModel = models.find((x) => x.id === selectedId);
  const preset = activeTab ? PROVIDER_PRESETS[activeTab] : null;
  const isRisky = preset?.complianceRisk ?? false;
  const riskLocked = isRisky && !complianceChecked[activeTab];

  const switchTab = (tab: LlmProviderType) => {
    if (!draft) return;
    setActiveTab(tab);
    const p = PROVIDER_PRESETS[tab];
    setDraft({
      ...draft,
      provider: tab,
      baseUrl: p.defaultUrl,
      selectedModel: p.defaultModels[0],
      availableModels: [...p.defaultModels],
      apiKey: "",
    });
    setHealth(null);
    setDirty(true);
  };

  const updateDraft = (partial: Partial<LlmModelEntry>) => {
    if (!draft) return;
    setDraft({ ...draft, ...partial });
    setDirty(true);
  };

  const handleSelectModel = (id: string) => {
    setSelectedId(id);
    setDirty(false);
    setHealth(null);
  };

  const handleAddModel = () => {
    const entry = createNewEntry("OLLAMA");
    const updated = [...models, entry];
    setModels(updated);
    saveStoredModels(updated);
    setSelectedId(entry.id);
    setDirty(true);
    setHealth(null);
  };

  const handleDeleteModel = () => {
    if (!draft || models.length <= 1) return;
    const updated = models.filter((m) => m.id !== draft.id);
    // If deleting default, set next as default
    if (draft.isDefault && updated.length > 0) {
      updated[0].isDefault = true;
    }
    setModels(updated);
    saveStoredModels(updated);
    setSelectedId(updated[0]?.id ?? null);
    setDirty(false);
    setHealth(null);
  };

  const handleSetDefault = () => {
    if (!draft) return;
    const updated = models.map((m) => ({ ...m, isDefault: m.id === draft.id }));
    setModels(updated);
    saveStoredModels(updated);
    setDraft({ ...draft, isDefault: true });
    setDirty(true);
  };

  const handleSave = () => {
    if (!draft) return;
    const updated = models.map((m) => (m.id === draft.id ? { ...draft } : m));
    setModels(updated);
    saveStoredModels(updated);
    // Sync active config
    const active = getActiveModelConfig(updated);
    saveLlmConfig(active);
    setDirty(false);
    onConfigChanged();
  };

  const handleTestConnection = async () => {
    if (!draft) return;
    setPinging(true);
    setHealth(null);
    try {
      const cfg = toLlmProviderConfig(draft);
      const res = await testLlmConnection(cfg);
      setHealth(res);
      if (res.models.length) {
        updateDraft({ availableModels: res.models });
      }
    } catch (e: any) {
      setHealth({ online: false, latencyMs: 0, models: [], error: String(e?.message ?? e) });
    } finally {
      setPinging(false);
    }
  };

  const canSave = useMemo(() => {
    if (!draft) return false;
    if (isRisky && !complianceChecked[activeTab]) return false;
    if (!draft.baseUrl) return false;
    if (!draft.selectedModel) return false;
    return true;
  }, [draft, isRisky, complianceChecked, activeTab]);

  const providerColor = (p: LlmProviderType) => {
    switch (p) {
      case "OLLAMA": return "text-emerald-400";
      case "OPENAI": return "text-green-400";
      case "ANTHROPIC": return "text-purple-400";
      case "CUSTOM": return "text-cyan-400";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* ── Header ── */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-5 py-3 flex items-center justify-between shadow-lg flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/30">
              <Bot className="w-4 h-4 text-slate-950" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Model Management</h1>
              <p className="text-[10px] text-slate-500 font-mono">Manage LLM provider configurations</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty || !canSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition hover:shadow-lg hover:shadow-emerald-500/20"
          >
            <Save className="w-3.5 h-3.5" />
            Save Changes
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ── Left: Model List ── */}
        <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col flex-shrink-0">
          <div className="px-3 py-3 border-b border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Configured Models ({models.length})
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {models.map((m) => {
              const isSelected = m.id === selectedId;
              const pColor = providerColor(m.provider);
              return (
                <button
                  key={m.id}
                  onClick={() => handleSelectModel(m.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? "bg-slate-800/80 border border-slate-700 shadow-sm"
                      : "hover:bg-slate-800/40 border border-transparent"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200 truncate">{m.name}</span>
                      {m.isDefault && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex-shrink-0">
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                      {m.provider} · {m.selectedModel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-slate-800">
            <button
              onClick={handleAddModel}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white border border-dashed border-slate-700 hover:border-emerald-500/50 hover:bg-emerald-950/20 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Model
            </button>
          </div>
        </aside>

        {/* ── Right: Model Detail Editor ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {!draft ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">
              Select a model to configure
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-5">

              {/* Provider Tabs */}
              <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
                {TABS.map((t) => {
                  const p = PROVIDER_PRESETS[t];
                  const selected = activeTab === t;
                  const risk = !!p.complianceRisk;
                  const isChecked = complianceChecked[t];
                  return (
                    <button
                      key={t}
                      onClick={() => switchTab(t)}
                      className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition ${
                        selected
                          ? "bg-slate-800 text-emerald-300 border border-slate-700 shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {risk ? (
                        isChecked
                          ? <Shield className="w-3.5 h-3.5 text-amber-300" />
                          : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {t}
                    </button>
                  );
                })}
              </div>

              {/* Compliance Check */}
              {isRisky && (
                <label className={`rounded-xl p-3 border flex items-start gap-3 text-xs ${
                  riskLocked
                    ? "bg-rose-950/25 border-rose-800/60 text-rose-200"
                    : "bg-amber-950/25 border-amber-700/50 text-amber-200"
                }`}>
                  <input
                    type="checkbox"
                    checked={complianceChecked[activeTab] ?? false}
                    onChange={(e) => setComplianceChecked((c) => ({ ...c, [activeTab]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <div className="leading-relaxed">
                    <div className="font-semibold mb-0.5">
                      {riskLocked ? "External Provider disabled · Check to unlock" : "Compliance confirmed · Configuration enabled"}
                    </div>
                    <div className="opacity-90">{COMPLIANCE_REMINDER}</div>
                  </div>
                </label>
              )}

              {/* Model Name */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  {preset?.name ?? "Configuration"}
                </div>

                <label className="flex flex-col gap-1.5 text-xs">
                  <span className="font-semibold text-slate-300">Model Name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    disabled={riskLocked}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] disabled:opacity-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="My Model"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" /> Base URL
                  </span>
                  <input
                    value={draft.baseUrl}
                    disabled={riskLocked}
                    onChange={(e) => updateDraft({ baseUrl: e.target.value })}
                    placeholder={preset?.defaultUrl}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] disabled:opacity-50 focus:outline-none focus:border-emerald-500/50"
                  />
                </label>

                {isRisky && (
                  <label className="flex flex-col gap-1.5 text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5" /> API Key
                    </span>
                    <input
                      type="password"
                      value={draft.apiKey ?? ""}
                      disabled={riskLocked}
                      onChange={(e) => updateDraft({ apiKey: e.target.value })}
                      placeholder="sk-... (stored locally only)"
                      className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] disabled:opacity-50 focus:outline-none focus:border-emerald-500/50"
                    />
                  </label>
                )}

                {/* Model Select + Ping */}
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Model</span>
                    <button
                      onClick={handleTestConnection}
                      disabled={riskLocked || pinging}
                      className="px-2.5 py-1 text-[10px] rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center gap-1 disabled:opacity-50 transition"
                    >
                      <RefreshCw className={`w-3 h-3 ${pinging ? "animate-spin" : ""}`} />
                      {pinging ? "Testing..." : "Test & Fetch Models"}
                    </button>
                  </div>
                  <select
                    value={draft.selectedModel}
                    disabled={riskLocked}
                    onChange={(e) => updateDraft({ selectedModel: e.target.value })}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-[11px] disabled:opacity-50 focus:outline-none focus:border-emerald-500/50"
                  >
                    {draft.availableModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {health && (
                    <div className={`rounded-lg p-2.5 border text-[11px] flex items-center gap-2 ${
                      health.online
                        ? "bg-emerald-950/25 border-emerald-800/50 text-emerald-200"
                        : "bg-rose-950/25 border-rose-800/50 text-rose-200"
                    }`}>
                      {health.online ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                      )}
                      <span className="font-semibold">
                        {health.online
                          ? `Online · ${health.models.length} models · ${health.latencyMs}ms`
                          : `Offline · ${health.error ?? "Connection failed"}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {!draft.isDefault && (
                  <button
                    onClick={handleSetDefault}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-600/30 text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    <Star className="w-3.5 h-3.5" />
                    Set as Default
                  </button>
                )}
                {draft.isDefault && (
                  <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-600/30 text-amber-300">
                    <Star className="w-3.5 h-3.5 fill-amber-300" />
                    Default Model
                  </div>
                )}
                {models.length > 1 && (
                  <button
                    onClick={handleDeleteModel}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-600/30 text-rose-300 hover:bg-rose-500/20 transition ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>

              {/* Info */}
              <div className="rounded-xl bg-slate-900/30 border border-slate-800 p-3 text-[10px] text-slate-500 leading-relaxed space-y-1 font-mono">
                <p>ID: {draft.id}</p>
                <p>Created: {new Date(draft.createdAt).toLocaleString()}</p>
                <p>API Key is stored in browser localStorage only · Never sent to backend</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};