import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Play, Bot, Puzzle, Table2, Zap, Package,
  Wrench, FileText, Loader2, CheckCircle2, XCircle, AlertCircle,
} from "lucide-react";
import { ToolInfoDto, ToolResultDto } from "../harness/sharedTypes";
import { harnessClient } from "../harness/client";

interface Props {
  onBack: () => void;
}

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  paytable_parser: <Table2 className="w-4 h-4" />,
  testdata_generator: <Zap className="w-4 h-4" />,
  zip_packager: <Package className="w-4 h-4" />,
  game_verifier: <Wrench className="w-4 h-4" />,
  log_diagnoser: <FileText className="w-4 h-4" />,
};

export const PluginPage: React.FC<Props> = ({ onBack }) => {
  const [plugins, setPlugins] = useState<ToolInfoDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ToolResultDto | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    harnessClient.listTools().then((res) => {
      setPlugins(res.tools);
      if (res.tools.length > 0) {
        setSelected(res.tools[0].name);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const selectedPlugin = plugins.find((p) => p.name === selected);

  const handleParamChange = (name: string, value: string) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const handleExecute = async () => {
    if (!selectedPlugin) return;
    setExecuting(true);
    setResult(null);
    try {
      const parsedParams: Record<string, unknown> = {};
      for (const prop of selectedPlugin.inputSchema.properties) {
        const raw = params[prop.name] ?? "";
        if (!raw) continue;
        switch (prop.type) {
          case "number":
            parsedParams[prop.name] = Number(raw);
            break;
          case "boolean":
            parsedParams[prop.name] = raw === "true";
            break;
          case "object":
            try { parsedParams[prop.name] = JSON.parse(raw); } catch { parsedParams[prop.name] = raw; }
            break;
          default:
            parsedParams[prop.name] = raw;
        }
      }
      const res = await harnessClient.executeTool(selectedPlugin.name, parsedParams);
      setResult(res);
    } catch (e: any) {
      setResult({ success: false, content: null, error: String(e?.message ?? e), execution_ms: 0, artifacts: [] });
    } finally {
      setExecuting(false);
    }
  };

  const getIcon = (name: string) => PLUGIN_ICONS[name] ?? <Bot className="w-4 h-4" />;

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
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 shadow-lg shadow-emerald-500/30">
              <Puzzle className="w-4 h-4 text-slate-950" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Plugin Manager</h1>
              <p className="text-[10px] text-slate-500 font-mono">Browse and execute registered plugins</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ── Left: Plugin List ── */}
        <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col flex-shrink-0">
          <div className="px-3 py-3 border-b border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Registered Plugins ({plugins.length})
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-xs">Loading...</div>
            ) : plugins.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-xs">No plugins registered</div>
            ) : (
              plugins.map((p) => {
                const isSelected = p.name === selected;
                return (
                  <button
                    key={p.name}
                    onClick={() => { setSelected(p.name); setResult(null); setParams({}); }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                      isSelected
                        ? "bg-slate-800/80 border border-slate-700 shadow-sm"
                        : "hover:bg-slate-800/40 border border-transparent"
                    }`}
                  >
                    <span className="text-cyan-400 flex-shrink-0">{getIcon(p.name)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-200 truncate">{p.name}</span>
                        <span className="text-[8px] text-emerald-500 font-mono flex-shrink-0">v{p.version}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">{p.description}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Right: Plugin Detail + Execute ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedPlugin ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">
              Select a plugin to inspect
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Plugin Info */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/40 text-cyan-400">
                    {getIcon(selectedPlugin.name)}
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-100">{selectedPlugin.name}</h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">{selectedPlugin.description}</p>
                  </div>
                  <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-emerald-950/30 text-emerald-300 border border-emerald-800/40 font-mono">
                    v{selectedPlugin.version}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                  <span>Timeout: {selectedPlugin.timeout_seconds}s</span>
                  <span className="text-slate-700">|</span>
                  <span>Permissions: {selectedPlugin.permissions?.join(", ") || "none"}</span>
                </div>
              </div>

              {/* Parameters */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                  Parameters ({selectedPlugin.inputSchema.properties.length})
                </div>

                {selectedPlugin.inputSchema.properties.length === 0 ? (
                  <div className="text-xs text-slate-500 font-mono">No parameters required</div>
                ) : (
                  <div className="space-y-3">
                    {selectedPlugin.inputSchema.properties.map((prop) => (
                      <label key={prop.name} className="flex flex-col gap-1.5 text-xs">
                        <span className="font-semibold text-slate-300">
                          {prop.name}
                          <span className="text-slate-500 font-normal ml-1">({prop.type})</span>
                          {prop.required && <span className="text-rose-400 ml-1">*</span>}
                        </span>
                        <p className="text-[10px] text-slate-500">{prop.description}</p>
                        {prop.type === "boolean" ? (
                          <select
                            value={params[prop.name] ?? ""}
                            onChange={(e) => handleParamChange(prop.name, e.target.value)}
                            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
                          >
                            <option value="">--</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : prop.type === "object" ? (
                          <textarea
                            value={params[prop.name] ?? ""}
                            onChange={(e) => handleParamChange(prop.name, e.target.value)}
                            placeholder='{"key": "value"}'
                            rows={3}
                            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50 resize-none"
                          />
                        ) : (
                          <input
                            value={params[prop.name] ?? ""}
                            onChange={(e) => handleParamChange(prop.name, e.target.value)}
                            placeholder={prop.type === "number" ? "0" : "Enter value..."}
                            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleExecute}
                  disabled={executing}
                  className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-900 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {executing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Executing...</>
                  ) : (
                    <><Play className="w-4 h-4" /> Execute Plugin</>
                  )}
                </button>
              </div>

              {/* Result */}
              {result && (
                <div className={`rounded-xl p-4 border ${
                  result.success
                    ? "bg-emerald-950/20 border-emerald-800/40"
                    : "bg-rose-950/20 border-rose-800/40"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {result.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span className={`text-xs font-bold ${result.success ? "text-emerald-300" : "text-rose-300"}`}>
                      {result.success ? "Success" : "Error"}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono ml-auto">{result.execution_ms}ms</span>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-300 bg-slate-950/50 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto">
                    {JSON.stringify(result.content ?? result.error, null, 2)}
                  </pre>
                  {result.artifacts?.length > 0 && (
                    <div className="mt-2 text-[10px] text-slate-400 font-mono">
                      Artifacts: {result.artifacts.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};