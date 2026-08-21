# WORKFLOWS 流水线配置目录

本目录按照 SLOT AI Harness 设计文档规范预留。

## 当前状态

P0-P1 阶段：流水线硬编码在 `src/harness/plannerAgent.ts`，分为：
- **Stage 1**：测试数据生成（解析 → 生成 → 打包）
- **Stage 2**：测试数据验证（验证 → 诊断）

## 未来扩展

P2 阶段计划支持：
- YAML 格式流水线定义
- DAG 可视化编排
- 多流水线并存切换
- 变量插值与条件分支

示例结构：
```yaml
# workflows/slot-test-pipeline.yaml
name: slot-test-full-pipeline
steps:
  - id: parse
    tool: paytable_parser
    params:
      raw_text: "{{input.raw_text}}"
  - id: generate
    tool: testdata_generator
    depends_on: [parse]
    params:
      records: "{{parse.output.records}}"
  - id: package
    tool: zip_packager
    depends_on: [generate]
    params:
      files: "{{generate.output.files}}"
```

遵循设计文档 9.5 扩展原则：前端画布可实现多流水线切换、独立运行、各自日志隔离。
