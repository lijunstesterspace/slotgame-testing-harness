import type { TestScenario } from "./sharedTypes";

// ── Agent files (Vite ?raw → build-time string inlining) ────────────
import agent_testdata_gen from "../../agents/testdata_generator_agent.md?raw";
import agent_testdata_verifier from "../../agents/testdata_verifier_agent.md?raw";
import agent_log_diagnoser from "../../agents/ui_log_diagnoser_agent.md?raw";
import agent_helpfile from "../../agents/helpfile_conversion_agent.md?raw";

// ── Skill files (Vite ?raw → build-time string inlining) ────────────
import skill_sheet_clean from "../../skills/skill-sheet-data-clean.md?raw";
import skill_generator_contract from "../../skills/skill-generator-plugin-contract.md?raw";
import skill_helpfile_conversion from "../../skills/skill-helpfile-conversion.md?raw";
import skill_helpfile_plugin from "../../skills/skill-helpfile-plugin-contract.md?raw";

// ─ Test Scenario Registry ─────────────────────────────────────────────
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
    label: "TestData Verification",
    description: "Send generated testdata to real game environment, verify seed acceptance and payout consistency",
    keywords: ["verify", "game", "spin", "游戏", "真实环境"],
    agentFile: "testdata_verifier_agent.md",
    skills: [],
    pipelineId: "game-verify-pipeline",
    requiredPlugins: ["testdata_verifier", "log_diagnoser"],
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
  {
    id: "easyhelp_checking",
    label: "EasyHelp Checking",
    description: "Batch convert HTML help files to text, perform diff comparison with keyword highlighting, and generate AI-powered analysis report",
    keywords: ["helpfile", "help", "conversion", "convert", "diff", "keyword", "帮助文件", "转换", "差异", "关键词"],
    agentFile: "helpfile_conversion_agent.md",
    skills: ["skill-helpfile-conversion.md", "skill-helpfile-plugin-contract.md"],
    pipelineId: "helpfile-conversion-pipeline",
    requiredPlugins: ["html_to_text_converter", "diff_comparator", "helpfile_analyzer"],
    icon: "file-text",
  },
];

// ── Agent content map (scenarioId → raw markdown) ─────────────────────
const AGENT_CONTENT: Record<string, string> = {
  testdata_generation: agent_testdata_gen,
  game_verification: agent_testdata_verifier,
  log_diagnosis: agent_log_diagnoser,
  easyhelp_checking: agent_helpfile,
};

// ── Skill content map (filename → raw markdown) ───────────────────────
const SKILL_CONTENT: Record<string, string> = {
  "skill-sheet-data-clean.md": skill_sheet_clean,
  "skill-generator-plugin-contract.md": skill_generator_contract,
  "skill-helpfile-conversion.md": skill_helpfile_conversion,
  "skill-helpfile-plugin-contract.md": skill_helpfile_plugin,
};

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
 * Compose the full System Prompt for a scenario:
 *   1. Agent role definition (from agents/*.md)
 *   2. Skill rules (from skills/*.md) — behavior constraints for the small model
 *   3. Tool call format instructions
 */
export function getScenarioSystemPrompt(scenarioId: string): string {
  const parts: string[] = [];

  // ─ Part 1: Agent role & rules ──
  const agentMd = AGENT_CONTENT[scenarioId];
  if (agentMd) {
    parts.push("=== AGENT ROLE & RULES ===");
    parts.push(agentMd.trim());
    parts.push("");
  }

  // ── Part 2: Skill constraints ──
  const scenario = SCENARIOS.find(s => s.id === scenarioId);
  if (scenario?.skills?.length) {
    parts.push("=== SKILL RULES (must follow strictly) ===");
    for (const skillFile of scenario.skills) {
      const content = SKILL_CONTENT[skillFile];
      if (content) {
        parts.push(`--- ${skillFile} ---`);
        parts.push(content.trim());
        parts.push("");
      }
    }
  }

  // ── Part 3: Tool call format (universal) ──
  parts.push("=== TOOL CALL FORMAT ===");
  parts.push("When calling a tool, output exactly:");
  parts.push('<tool_call><name>tool_name</name><params>{"key": "value"}</params></tool_call>');
  parts.push("After all tasks are complete, output: <task_complete />");
  parts.push("If the task fails, output: <task_complete success=\"false\" reason=\"...\" />");

  const prompt = parts.join("\n\n");

  // Fallback for unknown scenario
  if (!prompt.trim()) {
    return "You are a HARNESS test agent. Follow the scenario instructions.";
  }

  return prompt;
}
