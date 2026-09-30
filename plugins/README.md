# PLUGINS 插件目录

本目录按照 SLOT AI Harness 设计文档规范预留。

## 插件架构说明

当前生产环境插件实现在 `server/tools/impl/`，遵循 `ToolPlugin` 抽象接口（MCP兼容）：

- `server/tools/base.py` - 定义 `ToolPlugin` 接口和 `ToolRegistry`
- `server/tools/impl/` - 内置插件实现：
  - `testdata_parser_tool.py` - Google Sheets 解析插件
  - `testdata_generator_tool.py` - 测试数据生成插件
  - `zip_packager_tool.py` - ZIP打包插件
  - `game_verifier_tool.py` - 游戏验证插件
  - `log_diagnoser_tool.py` - 日志诊断插件
  - `html_to_text_converter_tool.py` - HTML帮助文件转文本插件
  - `diff_comparator_tool.py` - 差异比较与关键词高亮插件
  - `helpfile_analyzer_tool.py` - AI智能分析报告插件（调用本地Ollama）
  - `portugal_plugin_parser_tool.py` - Portugal Plugin 输出解析插件（移植自 ppvACCR1.0.py）
  - `portugal_plugin_reporter_tool.py` - Portugal Plugin 一致性检查、PlayCheck 核对与 TXT/JSON/HTML 报告插件
  - `portugal_plugin_fetcher_tool.py` - 从游戏环境经 Game History → PlayCheck 自动取回 Portugal Plugin outcome

## 新增插件方式

按照设计文档 9.2 扩展规则：

1. 在 `server/tools/impl/` 新建 `.py` 文件，继承 `ToolPlugin`
2. 在 `server/tools/impl/__init__.py` 注册到 `BUILTIN_TOOLS`
3. Harness 启动时自动加载，前端即可调用

本顶级 `plugins/` 目录用于存放：
- 示例插件模板
- 第三方独立插件（可选）
- 插件开发文档

遵循增量扩展原则：**所有扩展都是增量叠加，存量稳定业务完全不受影响**。
