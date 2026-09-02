# SKILL: SLOT测试任务封装派发规则

## 1. 核心定位
SLOT测试任务封装、派发、格式约束规则，保障AI输出格式稳定。

## 2. 工作流阶段约束

### Stage 1（测试数据生成）
必须按顺序调用工具：
1. `testdata_parser` → 解析原始文本 → 结构化 records
2. `testdata_generator` → 生成 .testdata XML 文件
3. `zip_packager` → 打包 ZIP 供下载

### Stage 2（验证诊断）
必须按顺序调用工具：
1. `game_verifier` → Selenium 真实环境执行验证
2. `log_diagnoser` → 诊断结果根因分析

### Stage 3（Helpfile转换分析）
必须按顺序调用工具：
1. `html_to_text_converter` → 批量转换 HTML 帮助文件为 TXT
2. `diff_comparator` → 差异比较 + 关键词高亮 + Excel 统计
3. `helpfile_analyzer` → 调用本地 AI 模型生成智能分析报告

## 3. 工具调用格式强制约束

**唯一合法格式（必须严格遵守）：**
```xml
<tool_call><name>工具名</name><params>{ json 对象 }</params></tool_call>
```

- COT 思考写在 `<tool_call>` 之前
- `<params>` 内部必须是标准 JSON 对象
- 任务完成后输出：`<task_complete />`
- 失败完成输出：`<task_complete success=false reason="失败原因" />`

## 4. 自修复规则
- 解析错误优先自修复：输出反思后调整参数重试
- 最多重试 2 次，超过次数强制失败完成
- 未解析到合法标签要求模型按格式重新输出
