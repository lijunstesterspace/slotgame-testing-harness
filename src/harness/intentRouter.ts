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
import skill_verification_protocol from "../../skills/skill-verification-protocol.md?raw";

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
    keywords: ["verify testdata", "verify", "verification", "game", "spin", "游戏", "真实环境", "验证"],
    agentFile: "testdata_verifier_agent.md",
    skills: ["skill-verification-protocol.md"],
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
  "skill-verification-protocol.md": skill_verification_protocol,
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
        // Longer keywords get higher weight; exact word-boundary matches get bonus
        let kwScore = kw.length * 10;
        // Bonus for multi-word keywords (more specific intent signal)
        if (kw.includes(' ') || kw.includes('_')) {
          kwScore *= 2;
        }
        // Bonus if the keyword appears near the start of the input (stronger intent signal)
        const idx = input.indexOf(kw.toLowerCase());
        if (idx <= 3) {
          kwScore += 20;
        }
        score += kwScore;
      }
    }

    if (matched.length > 0 && (!best || score > best.matchScore)) {
      best = { scenario, matchScore: score, matchedKeywords: matched };
    }
  }

  return best;
}

/**
 * Compose the read-only "domain context" for a scenario, from:
 *   1. Agent role definition (from agents/*.md) — domain knowledge only, no tool-calling instructions
 *   2. Skill rules (from skills/*.md) — behavior constraints for the small model
 *
 * This context is NOT a tool-calling system prompt. Execution order is owned entirely by
 * ExecutionEngine + pipelineRegistry.ts (see design doc §10.7); the AI never decides which
 * plugin runs next. This context is only fed to PlannerAgent's narrow helper methods
 * (`clarify` / `summarizeStepResult`) so their dialogue/report output stays grounded in the
 * scenario's domain rules.
 */
export function getScenarioSystemPrompt(scenarioId: string): string {
  const parts: string[] = [];

  // ─ Part 1: Agent role & rules ──
  const agentMd = AGENT_CONTENT[scenarioId];
  if (agentMd) {
    parts.push("=== AGENT ROLE & DOMAIN RULES (reference only, not tool-calling instructions) ===");
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

  const prompt = parts.join("\n\n");

  // Fallback for unknown scenario
  if (!prompt.trim()) {
    return "You are a HARNESS test agent. Follow the scenario instructions.";
  }

  return prompt;
}

/**
 * A short, few-sentence stand-in for getScenarioSystemPrompt(), used only for plain small-talk
 * (see isCasualChatMessage below) — the full prompt concatenates the whole Agent .md + every
 * Skill .md for the scenario (several KB), which a local 7B-and-under model has to fully
 * re-process before it can answer even "hello". Real task messages still get the full prompt;
 * this only trims the one path where a tester is just saying hi and doesn't need any of that
 * domain detail to get a quick, friendly reply.
 */
export function getScenarioLiteSystemPrompt(scenarioId: string): string {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    return "You are the AI assistant for a SLOT game testing tool. Keep replies short and friendly.";
  }
  return (
    `You are the AI assistant for the "${scenario.label}" scenario in a SLOT game testing tool ` +
    `(${scenario.description}). This is just casual small talk, not a task — reply in 1-2 short, ` +
    `friendly sentences. Do not call tools or ask for task details unless the user brings them up.`
  );
}

// ── Casual small-talk detector ──────────────────────────────────────────
// Deliberately conservative: a false negative (treating chit-chat as a real task) only costs a
// bit of extra prompt-processing time; a false positive (treating a real task description as
// chit-chat) would starve the model of the domain rules it needs, so length alone already rules
// out anything but a short message, and every pattern is anchored to match the *whole* trimmed
// string rather than merely appearing inside it.
// Chinese input commonly uses full-width punctuation (！。，？) instead of ASCII — both forms
// need to match, so every trailing-punctuation class below includes both.
const CASUAL_CHAT_PATTERNS: RegExp[] = [
  /^(hi|hello|hey|yo|sup)[!！.。\s]*$/i,
  /^(你好|您好|嗨|哈喽)[!！.。\s]*$/,
  /^(thanks|thank you|thx|ty)[!！.。\s]*$/i,
  /^(谢谢|感谢)[!！.。\s]*$/,
  /^(bye|goodbye|see you|cya)[!！.。\s]*$/i,
  /^(再见|拜拜)[!！.。\s]*$/,
  /^(ok|okay|got it|sure|cool|nice|great)[!！.。\s]*$/i,
  /^(好的?|嗯|收到|明白了?)[!！.。\s]*$/,
  /^how are you[?？]*$/i,
  /^(早|早上好|晚安|晚上好)[!！.。\s]*$/,
];

/** True only for short, unambiguous greetings/acknowledgements — see CASUAL_CHAT_PATTERNS. */
export function isCasualChatMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 20) return false;
  return CASUAL_CHAT_PATTERNS.some((re) => re.test(trimmed));
}
