import type { PipelineDef } from "./sharedTypes";

// ── 流水线注册表 ─────────────────────────────────────────────
// 每条流水线定义一组有序的 stage，每个 stage 内的步骤可并行执行
// 新增流水线只需在 PIPELINES 数组中添加一条定义

export const PIPELINES: PipelineDef[] = [
  // ─── TestData 生成流水线 ───
  {
    id: "testdata-gen-pipeline",
    name: "TestData 生成",
    description: "解析 Paytable → 生成 XML → 打包 ZIP",
    stages: [
      // Stage 0: 解析
      [
        {
          id: "parse",
          plugin: "testdata_parser",
          label: "解析 Paytable",
          description: "从原始文本/Sheet URL 解析出结构化记录",
          dependsOn: [],
          retryOnFail: true,
          maxRetries: 2,
        },
      ],
      // Stage 1: 生成
      [
        {
          id: "generate",
          plugin: "testdata_generator",
          label: "生成 .testdata",
          description: "将结构化记录写入 .testdata XML 文件",
          dependsOn: ["parse"],
          retryOnFail: true,
          maxRetries: 2,
        },
      ],
      // Stage 2: 打包
      [
        {
          id: "package",
          plugin: "zip_packager",
          label: "打包 ZIP",
          description: "将所有 .testdata 文件打包为 outcome_testdata.zip",
          dependsOn: ["generate"],
          retryOnFail: false,
          maxRetries: 0,
        },
      ],
    ],
  },

  // ─── 游戏验证流水线 ───
  {
    id: "game-verify-pipeline",
    name: "游戏环境验证",
    description: "发送 testdata 到真实游戏 → 验证派彩一致性",
    stages: [
      // Stage 0: 验证
      [
        {
          id: "verify",
          plugin: "game_verifier",
          label: "执行验证",
          description: "通过 Selenium 连接真实游戏环境执行验证",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
        },
      ],
      // Stage 1: 诊断（仅对失败用例）
      [
        {
          id: "diagnose",
          plugin: "log_diagnoser",
          label: "根因诊断",
          description: "分析失败用例的日志和截图，归责根因",
          dependsOn: ["verify"],
          retryOnFail: false,
          maxRetries: 0,
        },
      ],
    ],
  },

  // ─── 日志诊断流水线 ───
  {
    id: "log-diagnose-pipeline",
    name: "日志诊断",
    description: "分析验证失败日志，生成根因归责报告",
    stages: [
      [
        {
          id: "diagnose",
          plugin: "log_diagnoser",
          label: "日志分析",
          description: "分析失败日志和截图，输出根因报告",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
        },
      ],
    ],
  },
];

// ── 查询工具函数 ──────────────────────────────────────────────

/** 根据 ID 获取流水线定义，未找到返回 undefined */
export function getPipeline(pipelineId: string): PipelineDef | undefined {
  return PIPELINES.find((p) => p.id === pipelineId);
}

/** 获取所有流水线摘要（用于 UI 展示） */
export function listPipelines(): Array<{ id: string; name: string; stageCount: number }> {
  return PIPELINES.map((p) => ({
    id: p.id,
    name: p.name,
    stageCount: p.stages.length,
  }));
}
