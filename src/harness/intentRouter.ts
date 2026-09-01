import type { TestScenario } from "./sharedTypes";

// ── Test Scenario Registry ─────────────────────────────────────────────
// Add a new scenario by appending an entry to this array; HARNESS auto-discovers it

export const SCENARIOS: TestScenario[] = [
  {
    id: "testdata_generation",
    label: "TestData Generation",
    description: "Parse Paytable from Google Sheet, generate .testdata XML files and package as ZIP",
    keywords: ["testdata", "generate", "paytable", "sheet", "表格", "生成测试数据"],
    agentFile: "testdata_generator_agent.md",
    skills: ["skill-sheet-data-clean.md", "skill-generator-plugin-contract.md"],
    pipelineId: "testdata-gen-pipeline",
    requiredPlugins: ["testdata_parser", "testdata_generator", "zip_packager"],
    icon: "zap",
  },
  {
    id: "game_verification",
    label: "Game Environment Verification",
    description: "Send generated testdata to real game environment, verify seed acceptance and payout consistency",
    keywords: ["verify", "game", "spin", "游戏", "真实环境"],
    agentFile: "testdata_verifier_agent.md",
    skills: [],
    pipelineId: "game-verify-pipeline",
    requiredPlugins: ["game_verifier", "log_diagnoser"],
    icon: "shield",
  },
  {
    id: "log_diagnosis",
    label: "Log Diagnosis",
    description: "Analyze verification failure logs and screenshots, auto-generate root cause attribution report",
    keywords: ["diagnose", "log", "根因", "分析"],
    agentFile: "ui_log_diagnoser_agent.md",
    skills: [],
    pipelineId: "log-diagnose-pipeline",
    requiredPlugins: ["log_diagnoser"],
    icon: "bug",
  },
];

// ── Intent Router ────────────────────────────────────────────────

export interface RouteResult {
  scenario: TestScenario;
  matchScore: number;   // 0-100, keyword match score
  matchedKeywords: string[];
}

/**
 * Match the most suitable test scenario based on user's natural language input.
 * Uses keyword rule matching (no AI dependency, avoids small model unreliability).
 */
export function routeIntent(userInput: string): RouteResult | null {
  const input = userInput.toLowerCase();
  let best: RouteResult | null = null;

  for (const scenario of SCENARIOS) {
    const matched: string[] = [];
    let score = 0;

    for (const kw of scenario.keywords) {
      if (input.includes(kw.toLowerCase())) {
        matched.push(kw);
        // Longer keywords get higher weight
        score += kw.length * 10;
      }
    }

    if (matched.length > 0 && (!best || score > best.matchScore)) {
      best = { scenario, matchScore: score, matchedKeywords: matched };
    }
  }

  return best;
}

/**
 * Get the System Prompt prefix for a scenario.
 * Read from agents/*.md files; inline defaults provided here.
 */
export function getScenarioSystemPrompt(scenarioId: string): string {
  const prompts: Record<string, string> = {
    testdata_generation: [
      "You are a Slot QA TestData Generator Agent for slot machine test automation.",
      "",
      "Your task: Parse user intent + Google Sheets / paytable raw text, then call HARNESS-provided tools:",
      "  1) testdata_parser - Read raw text into structured records + fileMap",
      "  2) testdata_generator - Write .testdata XML files to server sandbox",
      "  3) zip_packager - Package outcome_testdata zip for download",
      "",
      "Tool call format: Use XML tags tool_call with name and params.",
      "After task completion, output: task_complete",
      "",
      "Requirements:",
      "- For stage=1 (generation): call at least testdata_parser then testdata_generator then zip_packager.",
      "- Use gamePrefix=P5P for all files unless user specifies otherwise.",
    ].join("\n"),

    game_verification: [
      "You are a Slot QA TestData Verifier Agent for slot machine test automation.",
      "",
      "Your task: For already generated testdata, call:",
      "  1) game_verifier - Selenium real verification + screenshots",
      "",
      "Tool call format: Same as above.",
      "Completion: task_complete",
      "",
      "Requirements:",
      "- Verify each test record against the real game server.",
      "- Report any discrepancies in payout or seed acceptance.",
    ].join("\n"),

    log_diagnosis: [
      "You are a Slot QA UI/Log Diagnoser Agent for slot machine test automation.",
      "",
      "Your task: Analyze verification failure logs and screenshots, then generate root cause attribution reports.",
      "Call HARNESS-provided tools:",
      "  1) log_diagnoser - Output root cause diagnosis for each verification result",
      "",
      "Tool call format: Same as above.",
      "Completion: task_complete",
      "",
      "Requirements:",
      "- Analyze each failed verification case.",
      "- Attribute root cause to game server, client UI, or test data.",
    ].join("\n"),
  };

  return prompts[scenarioId] ?? "You are a HARNESS test agent. Follow the scenario instructions.";
}
