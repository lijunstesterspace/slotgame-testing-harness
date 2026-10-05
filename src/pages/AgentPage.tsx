import React, { useState } from "react";
import {
  ArrowLeft, Bot, Zap, Shield, Search,
  FileText, CheckCircle2, AlertTriangle,
  Sparkles, Database, Eye, BrainCircuit, Globe,
} from "lucide-react";

// ── Agent data (embedded from agents/*.md) ───────────────────
interface AgentInfo {
  id: string;
  name: string;
  shortDesc: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  bgColor: string;
  mission: string;
  rules: { title: string; items: string[] }[];
  outputSpec: string;
  systemPrompt: string;
}

const AGENTS: AgentInfo[] = [
  {
    id: "planner",
    name: "Planner Agent",
    shortDesc: "Semantic reasoning unit — drives AI conversation loop and tool orchestration",
    icon: <BrainCircuit className="w-4 h-4" />,
    color: "text-violet-400",
    borderColor: "border-violet-800/40",
    bgColor: "bg-violet-950/60",
    mission:
      "Acts as the semantic reasoning core of the HARNESS. Receives scenario-specific System Prompts from the Intent Router, drives the AI conversation loop (streaming output, parse tool_call, execute tool, feed back results), and performs self-healing when outputs are malformed. The 4B model serves as a 'semantic sensor' — parsing user intent into structured tool calls and performing basic semantic understanding of tool results. All flow control, retry logic, and state machines are handled by code, not the model.",
    rules: [
      {
        title: "Tool Call Parsing and Execution",
        items: [
          "Parses tool_call XML tags from model output: name + JSON params.",
          "Calls the corresponding HARNESS tool via executeTool and feeds the result back into the conversation.",
          "Maximum 12 cycles per run; each cycle streams LLM output then parses for tool_call or task_complete tags.",
        ],
      },
      {
        title: "Self-Healing Protocol",
        items: [
          "Tool call fails: push error message back to model, let it reflect and retry with corrected parameters.",
          "No valid tags in output: instruct model to strictly follow the tool_call or task_complete format and retry.",
          "Task reports failure: capture reason, abort execution, return failure outcome with partial records.",
        ],
      },
      {
        title: "Side-Effect Collection",
        items: [
          "testdata_parser: auto-saves parsed records to database and updates progress.",
          "testdata_generator: collects generated file list for downstream packaging.",
          "zip_packager: captures download URL for user access.",
        ],
      },
    ],
    outputSpec: "PlannerRunOutcome: { success, executionId, records[], zipUrl?, message? }",
    systemPrompt: "Planner Agent does not have a fixed system prompt — it dynamically loads the scenario-specific prompt from intentRouter (testdata_generation, game_verification, or easyhelp_checking). Each scenario prompt defines the agent's role, required tool call sequence, and completion criteria.",
  },
  {
    id: "testdata_generator",
    name: "TestData Generator Agent",
    shortDesc: "Parse Google Sheet paytable to generate .testdata XML files",
    icon: <Zap className="w-4 h-4" />,
    color: "text-emerald-400",
    borderColor: "border-emerald-800/40",
    bgColor: "bg-emerald-950/60",
    mission:
      "Parse user-provided Google Sheets paytable testdata specs, execute data cleaning, schema validation, and generate standardized, game-prefixed .testdata XML specification files (up to 22 distinct test files per module) and package them into a ZIP archive.",
    rules: [
      {
        title: "Module ID Extraction",
        items: [
          'Read cell A1. Match regex Module\\s*ID\\s*#?:?\\s*(\\d+). Extract integer module ID (e.g., 105359).',
        ],
      },
      {
        title: "Batch & Index Sanitization",
        items: [
          "Remove all trailing text or notes (e.g., with max meter).",
          "Extract batch and index using pattern ^\\d+,\\d+$.",
        ],
      },
      {
        title: "File Naming & Categorical Aggregation",
        items: [
          "Game Prefix: Default prefix is P5P_ (customizable per game).",
          "Regular Wins File: Combines micro win, Small win, Medium win, Large win.",
          "Big Wins File: Combines Big win, Mega win, Epic Win, Super Win.",
          "BetLines Collection File: Combines all 20 lines (0 to 19) into a single 20-spin file.",
          "Dedicated Feature Trigger Files: Each specific feature scenario generates its own standalone file.",
        ],
      },
    ],
    outputSpec:
      "Generated ZIP package: outcome_testdata_module_{moduleID}.zip containing 22 distinct .testdata files + manifest.json",
    systemPrompt: `You are the TestData Generator Agent for Slot Machine QA Automation.
Your objective is to:
1. Parse target Google Sheets containing test case mappings (Single Spins, Double PreGen Bonus Pairs, and Bet Lines ID blocks).
2. Clean and sanitize all input data:
   - Extract Module ID from cell A1 (e.g. "Module ID 105359" -> "105359").
   - Strip accidental trailing prose from Batch/Index cells (e.g. "371,0 with max meter" -> "371,0").
   - Classify cases into Single Spin, Double PreGen (Bonus Feature) pairs, or Multi-Spin Bet Lines ID blocks.
3. Apply standard file naming conventions with Game Code Prefix (default "P5P_").
4. Construct standard XML nodes (<Spin>, <PreGen>, <Feature>) according to schema requirements.
5. Package all 22 output files into a ZIP archive with manifest metadata.`,
  },
  {
    id: "testdata_verifier",
    name: "TestData Verifier Agent",
    shortDesc: "Dispatch testdata against real game environment and verify payouts",
    icon: <Shield className="w-4 h-4" />,
    color: "text-cyan-400",
    borderColor: "border-cyan-800/40",
    bgColor: "bg-cyan-950/60",
    mission:
      "Receive generated .testdata XML records, dispatch test spin calls against the specified target Real/Staging Game Environment, inspect real game engine HTTP/socket responses, and verify server seed acceptance and payout consistency.",
    rules: [
      {
        title: "Endpoint & Auth Connection",
        items: [
          "Verify target URL accessibility. Suppress untrusted SSL warnings if testing against internal staging servers.",
          "Include optional Authorization Bearer token or Game Session ID if required by the game server.",
        ],
      },
      {
        title: "Payload Construction & Dispatch",
        items: [
          "Construct spin API payload for each test record with moduleId, stage, basePreGen, bonusPreGen.",
          "Respect configured spin delay (default: 500ms) between API calls to prevent staging rate limits.",
        ],
      },
      {
        title: "Server Response Assertions",
        items: [
          "Pass (PASSED): HTTP 200 OK + Game Engine accepted seed + valid spin response payload returned.",
          "Discrepancy (DISCREPANCY): HTTP 200 OK but server returned an unexpected error message or rejected pregen seed.",
          "Error (ERROR): HTTP 4xx / 5xx error, CORS failure, or timeout > 5000ms.",
        ],
      },
    ],
    outputSpec: `Verification Execution Report:
{
  "targetUrl": "http://staging-game.casino.com/api/test_spin",
  "totalCases": 6,
  "passedCount": 6,
  "failedCount": 0,
  "passRate": 100.0,
  "totalTimeMs": 3120,
  "results": [{ "recordId": "TR-001", "caseName": "...", "status": "PASSED", ... }]
}`,
    systemPrompt: `You are the TestData Verifier Agent.
Your objective is to:
1. Accept generated .testdata test cases (Single Spins, Double PreGen Bonus Pairs, and BetLines).
2. Connect to the user-specified Game Test Environment Endpoint.
3. Dispatch test spin requests with seed batch and index parameters.
4. Listen to the Game Engine server response:
   - Verify HTTP status code 200 OK.
   - Parse returned server payload (reel stops, feature stage state, total payout).
   - Flag any server-side exceptions, invalid seed rejections, or network timeouts.
5. Compute real pass rate KPIs and generate the Verification Execution Report.`,
  },
  {
    id: "portugal_plugin_verifier",
    name: "Portugal Plugin Verification Agent",
    shortDesc: "Fetch the Portugal Plugin outcome from PlayCheck, parse it and check it against the recorded payout",
    icon: <Globe className="w-4 h-4" />,
    color: "text-amber-400",
    borderColor: "border-amber-800/40",
    bgColor: "bg-amber-950/60",
    mission:
      "Replace the standalone ppv*.py Tk tools and their hand-edited LETTER_TO_SYM tables: resolve the game's symbol mapping from its Output Guide (.md) or the stored profile, fetch the outcome from the game environment (Game History → PlayCheck → GetReportAsync) or take it pasted, parse it into spins (reel rows, winning symbols/positions, bets, multipliers, win amounts), total the win amount, and write a text report identical to the old tool plus JSON/HTML reports with advisory consistency checks.",
    rules: [
      {
        title: "Symbol Mapping (portugal_plugin_symbol_map) — runs first",
        items: [
          "Attached Output Guide (.md): read the Definition / Corresponding letter table, validate, self-test on the guide's examples, diff and save symbol_profiles/<GAME>.json.",
          "No guide: use the stored profile whose module_ids contain the run's moduleId; none → stop and ask for the guide before any browser work.",
          "A guide whose moduleId differs from the run's moduleId is rejected (wrong game's document).",
          "No moduleId at all (pasted outcome): built-in ACCR table, as the original tool did.",
        ],
      },
      {
        title: "Fetching (portugal_plugin_fetcher)",
        items: [
          "Log in via the Titan Harness page or a direct launch URL, spin, then ••• → Game History to open PlayCheck.",
          "Pick the open login session (no ENDED AT, newest) and its last transaction(s), or an explicit session/trans.",
          "Call GameReport/GetReportAsync inside the PlayCheck tab with its X-SPA-ASPNET-SessionId and read Data.",
          "Pasted outcome text skips the browser entirely.",
        ],
      },
      {
        title: "Parsing (portugal_plugin_parser)",
        items: [
          "Split spins with (\d+):(.*?)(?=\s*\d+:|$); skip empty spins; ignore text before the first N:.",
          "#-blocks before the first R/MV/MT/MG marker are reel rows; ';' separates cells.",
          "Letters are upper-cased and mapped via the game profile (ACCR by default); unmapped values pass through.",
          "MG values are summed into Total Win Amount; a non-numeric MG is a warning, not a failure.",
        ],
      },
      {
        title: "Advisory Checks (portugal_plugin_reporter)",
        items: [
          "unmapped_symbol / unmapped_winning_symbol: value not in the profile's SYM set.",
          "row_width_mismatch: rows of one spin have different cell counts.",
          "param_count_mismatch: MV / MT / MG counts differ within one spin; R is checked against whether the spin won.",
          "Fetch mode (hard): sum(MG)/100 = PlayCheck PAYOUT, first MV/100 = WAGERED, = game financials.win → otherwise FAIL.",
          "verdict = FAIL on a PlayCheck mismatch, REVIEW on findings/warnings, otherwise CLEAN.",
        ],
      },
    ],
    outputSpec:
      "server/data/artifacts/portugal_plugin_{GAME}_{execution_id}.txt (identical to ppvACCR1.0) + .json + .html",
    systemPrompt: `The Portugal Plugin Verification Agent has no autonomous prompt — the portugal-plugin-verify-pipeline
(resolve_symbol_map → fetch_portugal_plugin → parse_portugal_plugin → report_portugal_plugin) is fixed code. The AI only asks for the Portugal Plugin string when it is
missing and summarizes the final report (spin count, total win, verdict, flagged spins).`,
  },
];

// ── Props ──────────────────────────────────────────────────────
interface Props {
  onBack: () => void;
}

// ── Component ──────────────────────────────────────────────────
export const AgentPage: React.FC<Props> = ({ onBack }) => {
  const [selectedId, setSelectedId] = useState<string>(AGENTS[0].id);
  const [activeSection, setActiveSection] = useState<
    "mission" | "rules" | "prompt" | "output"
  >("mission");

  const selected = AGENTS.find((a) => a.id === selectedId)!;

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
              <h1 className="text-sm font-bold text-white">Agent Repository</h1>
              <p className="text-[10px] text-slate-500 font-mono">
                Browse and inspect registered AI agents
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ── Left: Agent List ── */}
        <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col flex-shrink-0">
          <div className="px-3 py-3 border-b border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Registered Agents ({AGENTS.length})
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {AGENTS.map((a) => {
              const isSelected = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedId(a.id);
                    setActiveSection("mission");
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? "bg-slate-800/80 border border-slate-700 shadow-sm"
                      : "hover:bg-slate-800/40 border border-transparent"
                  }`}
                >
                  <span
                    className={`${a.color} flex-shrink-0 p-1.5 rounded-lg ${a.bgColor} border ${a.borderColor}`}
                  >
                    {a.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">
                      {a.name}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                      {a.shortDesc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right: Agent Detail ── */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Agent Info Card */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`p-2 rounded-lg ${selected.bgColor} border ${selected.borderColor} ${selected.color}`}
                >
                  {selected.icon}
                </span>
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-slate-100">
                    {selected.name}
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {selected.shortDesc}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-950/30 text-emerald-300 border border-emerald-800/40 font-mono">
                  v1.0.0
                </span>
              </div>
            </div>

            {/* Section Tabs */}
            <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
              {(
                [
                  {
                    key: "mission",
                    label: "Mission",
                    icon: <Sparkles className="w-3 h-3" />,
                  },
                  {
                    key: "rules",
                    label: "Rules",
                    icon: <FileText className="w-3 h-3" />,
                  },
                  {
                    key: "prompt",
                    label: "System Prompt",
                    icon: <Database className="w-3 h-3" />,
                  },
                  {
                    key: "output",
                    label: "Output Spec",
                    icon: <Eye className="w-3 h-3" />,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveSection(tab.key)}
                  className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition ${
                    activeSection === tab.key
                      ? "bg-slate-800 text-emerald-300 border border-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Mission ── */}
            {activeSection === "mission" && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                  Role &amp; Mission
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selected.mission}
                </p>
              </div>
            )}

            {/* ── Rules ── */}
            {activeSection === "rules" && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Diagnostic / Parsing Rules
                </div>
                {selected.rules.map((rule, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-200">
                        Rule {i + 1}: {rule.title}
                      </span>
                    </div>
                    <ul className="ml-5 space-y-1">
                      {rule.items.map((item, j) => (
                        <li
                          key={j}
                          className="text-[11px] text-slate-400 leading-relaxed font-mono"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* ── System Prompt ── */}
            {activeSection === "prompt" && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                  System Prompt (cached prefix)
                </div>
                <pre className="text-[11px] text-slate-300 font-mono bg-slate-950/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-slate-800/60 overflow-x-auto">
                  {selected.systemPrompt}
                </pre>
              </div>
            )}

            {/* ── Output Spec ── */}
            {activeSection === "output" && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                  Output Specification
                </div>
                <pre className="text-[11px] text-slate-300 font-mono bg-slate-950/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-slate-800/60 overflow-x-auto">
                  {selected.outputSpec}
                </pre>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
