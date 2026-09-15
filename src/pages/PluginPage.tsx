import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Bot, Puzzle, Table2, Zap, Package,
  Wrench, FileText, BookOpen,
} from "lucide-react";
import { ToolInfoDto, SkillInfoDto } from "../harness/sharedTypes";
import { harnessClient } from "../harness/client";

interface Props {
  onBack: () => void;
}

type TabId = "plugins" | "skills";

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  testdata_parser: <Table2 className="w-4 h-4" />,
  testdata_generator: <Zap className="w-4 h-4" />,
  zip_packager: <Package className="w-4 h-4" />,
  testdata_verifier: <Wrench className="w-4 h-4" />,
  log_diagnoser: <FileText className="w-4 h-4" />,
};

const SKILL_ICONS: Record<string, React.ReactNode> = {
  "skill-generator-plugin-contract": <Puzzle className="w-5 h-5" />,
  "skill-sheet-data-clean": <Table2 className="w-5 h-5" />,
  "skill-verification-protocol": <Wrench className="w-5 h-5" />,
  "skill-helpfile-conversion": <FileText className="w-5 h-5" />,
  "skill-helpfile-plugin-contract": <Puzzle className="w-5 h-5" />,
};

// ── Hardcoded skill data (from skills/*.md) ─────────────────────
// Kept in sync with the skills actually wired into intentRouter.ts's SKILL_CONTENT map —
// every entry here must correspond to a skill file some scenario in SCENARIOS references.
const HARDCODED_SKILLS: SkillInfoDto[] = [
  {
    id: "skill-generator-plugin-contract",
    name: "Test Generation Plugin Interface Contract",
    description: "Defines the interface contract between the Plugin tool layer and the Agent layer, ensuring consistent parameter formats. Covers input/output specifications for five tools: testdata_parser, testdata_generator, zip_packager, game_verifier, and log_diagnoser.",
    file: "skill-generator-plugin-contract.md",
    size_kb: 2.6,
  },
  {
    id: "skill-sheet-data-clean",
    name: "SLOT Test Sheet Data Cleaning Rules",
    description: "Dedicated cleaning, filtering, and standardization skills for SLOT test sheets, providing constraint specifications for the data generation Agent. Includes Module ID extraction, Batch & Index cleanup, file classification naming rules, etc.",
    file: "skill-sheet-data-clean.md",
    size_kb: 1.3,
  },
  {
    id: "skill-verification-protocol",
    name: "SLOT TestData Verification Protocol",
    description: "Dedicated verification skill for the TestData Verification scenario: pre-flight environment checks, seed injection & spin execution timing, boundary conditions, exception classification, and result judgment criteria.",
    file: "skill-verification-protocol.md",
    size_kb: 4.0,
  },
  {
    id: "skill-helpfile-conversion",
    name: "Helpfile HTML Conversion & Diff Analysis Rules",
    description: "Rules for batch-converting help-file HTML to text and diff/keyword analysis, constraining the Helpfile Conversion Agent's behavior.",
    file: "skill-helpfile-conversion.md",
    size_kb: 2.5,
  },
  {
    id: "skill-helpfile-plugin-contract",
    name: "Helpfile Conversion Plugin Interface Contract",
    description: "Defines the interface contract between the helpfile conversion/analysis Plugins and the Agent layer, ensuring consistent parameter formats across html_to_text_converter, diff_comparator, and helpfile_analyzer.",
    file: "skill-helpfile-plugin-contract.md",
    size_kb: 3.7,
  },
];

export const PluginPage: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<TabId>("plugins");

  // ── Plugins state ──
  const [plugins, setPlugins] = useState<ToolInfoDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pluginsLoading, setPluginsLoading] = useState(true);

  // ── Skills state ──
  const [skills] = useState<SkillInfoDto[]>(HARDCODED_SKILLS);
  const [skillsLoading] = useState(false);

  useEffect(() => {
    harnessClient.listTools().then((res) => {
      setPlugins(res.tools);
      if (res.tools.length > 0) {
        setSelected(res.tools[0].name);
      }
    }).catch(() => {}).finally(() => setPluginsLoading(false));
  }, []);

  const selectedPlugin = plugins.find((p) => p.name === selected);
  const getPluginIcon = (name: string) => PLUGIN_ICONS[name] ?? <Bot className="w-4 h-4" />;
  const getSkillIcon = (id: string) => SKILL_ICONS[id] ?? <BookOpen className="w-5 h-5" />;

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
              <p className="text-[10px] text-slate-500 font-mono">Browse plugins & skills</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-5 flex-shrink-0">
        <div className="flex gap-1">
          {([
            { id: "plugins" as TabId, label: "Plugins", count: plugins.length },
            { id: "skills" as TabId, label: "Skills", count: skills.length },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 ${
                activeTab === tab.id
                  ? "text-white border-cyan-400 bg-slate-800/50"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-[10px] text-slate-500 font-mono">({tab.count})</span>
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 flex overflow-hidden">
        {activeTab === "plugins" ? (
          /* ═══ Plugins Tab ═══ */
          <>
            {/* Left: Plugin List */}
            <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col flex-shrink-0">
              <div className="px-3 py-3 border-b border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Registered Plugins ({plugins.length})
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {pluginsLoading ? (
                  <div className="flex items-center justify-center py-8 text-slate-500 text-xs">Loading...</div>
                ) : plugins.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-slate-500 text-xs">No plugins registered</div>
                ) : (
                  plugins.map((p) => {
                    const isSelected = p.name === selected;
                    return (
                      <button
                        key={p.name}
                        onClick={() => setSelected(p.name)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                          isSelected
                            ? "bg-slate-800/80 border border-slate-700 shadow-sm"
                            : "hover:bg-slate-800/40 border border-transparent"
                        }`}
                      >
                        <span className="text-cyan-400 flex-shrink-0">{getPluginIcon(p.name)}</span>
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

            {/* Right: Plugin Detail (Read-Only) */}
            <div className="flex-1 overflow-y-auto p-6">
              {!selectedPlugin ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">
                  Select a plugin to inspect
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-5">
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/40 text-cyan-400">
                        {getPluginIcon(selectedPlugin.name)}
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

                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                      Parameters ({selectedPlugin.inputSchema.properties.length})
                    </div>

                    {selectedPlugin.inputSchema.properties.length === 0 ? (
                      <div className="text-xs text-slate-500 font-mono">No parameters required</div>
                    ) : (
                      <div className="space-y-3">
                        {selectedPlugin.inputSchema.properties.map((prop) => (
                          <div key={prop.name} className="flex flex-col gap-1 text-xs">
                            <span className="font-semibold text-slate-300">
                              {prop.name}
                              <span className="text-slate-500 font-normal ml-1">({prop.type})</span>
                              {prop.required && <span className="text-rose-400 ml-1">*</span>}
                            </span>
                            <p className="text-[10px] text-slate-500">{prop.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-slate-800 text-[10px] text-slate-500 font-mono flex items-center gap-1.5">
                      <Bot className="w-3 h-3 text-cyan-500" />
                      Plugins are invoked automatically by the AI Agent — no manual execution needed.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* ═══ Skills Tab ═══ */
          <div className="flex-1 overflow-y-auto p-6">
            {skillsLoading ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">Loading skills...</div>
            ) : skills.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">No skills registered</div>
            ) : (
              <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-start gap-3 hover:border-slate-700 transition-colors"
                  >
                    <span className="p-2 rounded-lg bg-violet-950/60 border border-violet-800/40 text-violet-400 flex-shrink-0">
                      {getSkillIcon(skill.id)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-100 truncate">{skill.name}</h3>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{skill.description}</p>
                      <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500 font-mono">
                        <span>{skill.file}</span>
                        <span className="text-slate-700">·</span>
                        <span>{skill.size_kb} KB</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
