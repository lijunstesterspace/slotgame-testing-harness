import type { TestScenario } from "./sharedTypes";

// ── 测试场景注册表 ─────────────────────────────────────────────
// 新增场景只需在此数组中添加一条定义，HARNESS 自动识别

export const SCENARIOS: TestScenario[] = [
  {
    id: "testdata_generation",
    label: "TestData 生成",
    description: "从 Google Sheet 解析 Paytable，生成 .testdata XML 文件并打包 ZIP",
    keywords: ["testdata", "生成", "paytable", "sheet", "表格", "生成测试数据"],
    agentFile: "testdata_generator_agent.md",
    skills: ["skill-sheet-data-clean.md", "skill-generator-plugin-contract.md"],
    pipelineId: "testdata-gen-pipeline",
    requiredPlugins: ["testdata_parser", "testdata_generator", "zip_packager"],
    icon: "zap",
  },
  {
    id: "game_verification",
    label: "游戏环境验证",
    description: "将生成的 testdata 发送到真实游戏环境，验证种子接受和派彩一致性",
    keywords: ["验证", "verify", "game", "spin", "游戏", "真实环境"],
    agentFile: "testdata_verifier_agent.md",
    skills: [],
    pipelineId: "game-verify-pipeline",
    requiredPlugins: ["game_verifier", "log_diagnoser"],
    icon: "shield",
  },
  {
    id: "log_diagnosis",
    label: "日志诊断",
    description: "分析验证失败的日志和截图，自动生成根因归责报告",
    keywords: ["诊断", "diagnose", "日志", "log", "根因", "分析"],
    agentFile: "ui_log_diagnoser_agent.md",
    skills: [],
    pipelineId: "log-diagnose-pipeline",
    requiredPlugins: ["log_diagnoser"],
    icon: "bug",
  },
];

// ── 意图路由器 ────────────────────────────────────────────────

export interface RouteResult {
  scenario: TestScenario;
  matchScore: number;   // 0-100，关键词命中得分
  matchedKeywords: string[];
}

/**
 * 根据用户输入的自然语言，匹配最合适的测试场景。
 * 使用关键词规则匹配（不依赖 AI，规避小模型不可靠性）。
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
        // 长关键词权重更高
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
 * 获取场景对应的 System Prompt 前缀。
 * 从 agents/*.md 文件中读取，此处提供内嵌默认值。
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
