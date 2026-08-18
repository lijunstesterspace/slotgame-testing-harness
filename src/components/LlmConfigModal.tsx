import React, { useEffect, useMemo, useState } from "react";
import { X, Shield, ShieldAlert, CheckCircle2, RefreshCw, Server, Key, Wifi, WifiOff } from "lucide-react";
import type { LlmProviderConfig, LlmProviderType } from "../types";
import {
  DEFAULT_LLM_CONFIG,
  PROVIDER_PRESETS,
  testLlmConnection,
} from "../utils/llmGateway";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  config: LlmProviderConfig;
  onSaveConfig: (c: LlmProviderConfig) => void;
}

const TABS: LlmProviderType[] = ["OLLAMA", "OPENAI", "ANTHROPIC", "CUSTOM"];

const COMPLIANCE_REMINDER =
  "⚠️ 选择此外部 Provider 会把请求数据（包括 paytable、Case 名、验证结果摘要等）发送到第三方 API。选择前必须确认符合公司保密协议。";

export const LlmConfigModal: React.FC<Props> = ({ isOpen, onClose, config, onSaveConfig }) => {
  const [activeTab, setActiveTab] = useState<LlmProviderType>(config.provider);
  const [draft, setDraft] = useState<LlmProviderConfig>(config);
  const [complianceChecked, setComplianceChecked] = useState<Record<LlmProviderType, boolean>>({
    OLLAMA: true,
    OPENAI: false,
    ANTHROPIC: false,
    CUSTOM: false,
  });
  const [health, setHealth] = useState<null | { online: boolean; latencyMs: number; error?: string; models: string[] }>(null);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(config.provider);
    setDraft(config);
  }, [isOpen, config]);

  const preset = PROVIDER_PRESETS[activeTab];
  const isRisky = !!preset.complianceRisk;
  const riskLocked = isRisky && !complianceChecked[activeTab];

  const applyTabDefaults = () => {
    const baseUrl = draft.baseUrl && draft.provider === activeTab ? draft.baseUrl : preset.defaultUrl;
    setDraft({
      provider: activeTab,
      baseUrl,
      apiKey: isRisky ? (riskLocked ? "" : draft.apiKey ?? "") : draft.apiKey ?? "",
      selectedModel: draft.selectedModel && draft.provider === activeTab ? draft.selectedModel : preset.defaultModels[0],
      availableModels: draft.provider === activeTab && draft.availableModels?.length ? draft.availableModels : preset.defaultModels,
    });
  };

  useEffect(() => {
    applyTabDefaults();
    setHealth(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const onPing = async () => {
    setPinging(true);
    setHealth(null);
    try {
      const res = await testLlmConnection(draft);
      setHealth(res);
      if (res.models.length) {
        setDraft((d) => ({ ...d, availableModels: res.models }));
      }
    } catch (e: any) {
      setHealth({ online: false, latencyMs: 0, models: [], error: String(e?.message ?? e) });
    } finally {
      setPinging(false);
    }
  };

  const canSave = useMemo(() => {
    if (riskLocked) return false;
    if (!draft.baseUrl) return false;
    if (!draft.selectedModel) return false;
    if (isRisky && draft.provider !== "CUSTOM") {
      // allow empty key placeholder for extensibility demo purpose (won't call)
    }
    return true;
  }, [draft, riskLocked, isRisky]);

  const onSave = () => {
    if (!canSave) return;
    // 对外部 Provider：若 compliance 未勾选（理论已被 canSave 拦截），强制回退到 OLLAMA
    const finalRisky = !!PROVIDER_PRESETS[draft.provider].complianceRisk;
    if (finalRisky && !complianceChecked[draft.provider]) {
      onSaveConfig({ ...DEFAULT_LLM_CONFIG });
    } else {
      onSaveConfig(draft);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/50 text-emerald-300">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-white">LLM Provider · Planner 模型配置</h2>
              <p className="text-xs text-slate-400">默认本机 Ollama · 外部 Provider 必须勾选合规确认</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 pt-4 border-b border-slate-800">
          {TABS.map((t) => {
            const preset = PROVIDER_PRESETS[t];
            const selected = activeTab === t;
            const risk = !!preset.complianceRisk;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 transition ${
                  selected
                    ? "border-emerald-400 text-emerald-300 bg-slate-950/50"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {risk ? (complianceChecked[t] ? <Shield className="w-3.5 h-3.5 text-amber-300" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />) : <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {isRisky && (
            <label className={`rounded-xl p-3 border flex items-start gap-3 text-xs ${riskLocked ? "bg-rose-950/25 border-rose-800/60 text-rose-200" : "bg-amber-950/25 border-amber-700/50 text-amber-200"}`}>
              <input
                type="checkbox"
                checked={complianceChecked[activeTab]}
                onChange={(e) => setComplianceChecked((c) => ({ ...c, [activeTab]: e.target.checked }))}
                className="mt-0.5"
              />
              <div className="leading-relaxed">
                <div className="font-semibold mb-0.5">
                  {riskLocked ? "外部 Provider 当前禁用 · 勾选后解锁（证明可扩展性 UI）" : "已确认合规 · 可输入配置并测试连接"}
                </div>
                <div className="opacity-90">{COMPLIANCE_REMINDER}</div>
              </div>
            </label>
          )}

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 flex flex-col gap-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{preset.name}</div>

            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" /> Base URL</span>
              <input
                value={draft.baseUrl}
                disabled={riskLocked}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={preset.defaultUrl}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-[11px] disabled:opacity-50"
              />
            </label>

            {isRisky && (
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> API Key 🔒 仅保存在本机 localStorage · 绝不发送到后端</span>
                <input
                  type="password"
                  value={draft.apiKey ?? ""}
                  disabled={riskLocked}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-... （仅为扩展展示；启用前请确认合规）"
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-[11px] disabled:opacity-50"
                />
              </label>
            )}

            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Model</span>
                <button
                  onClick={onPing}
                  disabled={riskLocked || pinging}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${pinging ? "animate-spin" : ""}`} /> {pinging ? "检测中..." : "检测连接 / 拉取模型列表"}
                </button>
              </div>
              <select
                value={draft.selectedModel}
                disabled={riskLocked}
                onChange={(e) => setDraft({ ...draft, selectedModel: e.target.value })}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] disabled:opacity-50"
              >
                {(draft.availableModels.length ? draft.availableModels : preset.defaultModels).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {health && (
                <div className={`rounded-lg p-2.5 border text-[11px] flex items-center gap-2 ${health.online ? "bg-emerald-950/25 border-emerald-800/50 text-emerald-200" : "bg-rose-950/25 border-rose-800/50 text-rose-200"}`}>
                  {health.online ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-400" />}
                  <span className="font-semibold">{health.online ? `Online · ${health.models.length} 个模型 · 延迟 ${health.latencyMs}ms` : `Offline · ${health.error ?? "连接失败"}`}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 text-[11px] text-slate-400 leading-relaxed space-y-1.5">
            <p>🧩 <b className="text-slate-200">多 Provider 扩展性说明</b>：PlannerAgent 的 `PlannerProvider` 接口抽象了 Ollama / OpenAI / Anthropic / Custom 四种实现；健康检测、流式聊天、tokens 估算、合规锁逻辑共享。</p>
            <p>🔒 <b className="text-slate-200">合规说明</b>：除 Ollama 外的三个 Provider 默认灰显并强制合规勾选锁。即使勾选，API Key 仅写入本机浏览器 localStorage，HARNESS 后端没有任何 LLM Key 变量，审计日志只记录 provider/model/tokens 元数据，不记录 prompt 内容。</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2 bg-slate-950/60">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">取消</button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存 & 启用
          </button>
        </div>
      </div>
    </div>
  );
};
