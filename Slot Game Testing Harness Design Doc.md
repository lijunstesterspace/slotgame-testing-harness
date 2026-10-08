# Slot Game Testing Harness Design Doc

> **修订说明（2026-10-08，以代码为蓝本的全面校订）**
>
> 本版逐节对照当前代码（基准：`main` 分支 commit `6c03e2a`）重新校订，原则是**"代码即事实"**：凡文档与代码不一致处，一律按代码改写文档；属于设计愿景、尚未落地的内容保留，但明确标注为"规划 / 未实现"。主要修订：
>
> - 场景与流水线：由"2-3 个场景"更正为当前已注册的 **4 个场景 / 4 条流水线**（TestData Generation、TestData Verification、EasyHelp Checking、Portugal Plugin Verification）；"日志诊断"不再是独立场景，已并入验证报告；
> - **TestData Verification 场景不经过 ExecutionEngine**，而是由 `verificationEngine.ts` 直接驱动三种验证方式之一（默认 Titan Harness 方式），见 10.2 / 10.7；
> - Agent / Skill / Plugin 清单按实际文件更正（5 个 Agent 文件、8 个 Skill 文件、14 个已注册 Plugin），Agent/Skill 为**构建期内联**而非运行时热加载；
> - 模型网关按实际 Preset（OLLAMA / OPENAI / ANTHROPIC / CUSTOM）、参数（温度 0.3、输出上限 512 tokens）与 AI 实际调用点改写；KV 缓存、自动择模、Token/缓存统计面板标注为未实现；
> - UI 布局、目录结构按实际代码改写；新增第 12 章"后端服务架构"、第 13 章"代码现状与已知差异"。

## 1\. 项目总览与核心定位

### 1\.1 项目定位

本项目为**面向SLOT游戏测试的垂直领域AI Agent调度座舱（AI Harness）**。

技术定位采用行业最优组合范式：

- **调度内核**：吸收 Hermes\-Agent 标准 Harness 工程理念，以「代码强约束、AI弱决策、流程可管控、执行可追溯」为核心设计原则，规避小模型随机性问题。

- **界面形态**：沿用 TraeWork 极简工程化桌面UI设计，摒弃通用AI平台冗余功能，聚焦测试流水线高效执行。当前以 React + Vite 前端 + FastAPI 后端实现，既可浏览器访问，也可经 PyInstaller + pywebview 打包为单个桌面 exe 分发（见第12章）。

- **业务场景**：专为 SLOT 游戏测试数据生成、真实游戏环境测试数据验证、帮助文件（EasyHelp）比对检查、Portugal Plugin 输出校验等测试闭环打造的**垂直专用AI工作台**，非通用AI对话工具、非传统SaaS业务系统。

### 1\.2 设计核心目标

- 适配 7B 规模轻量模型（本地 Ollama 优先，默认模型 `qwen2.5-coder:7b`，亦可切换云端同规模/更大规模模型），实现低成本、可离线、高稳定的AI测试流水线；

- 明确 AI 的职责边界：仅承担 7B 模型可胜任的**简单对话交互、任务分类与推流调度、执行结果的分析报告生成**三类轻量语义任务，不承担复杂多步规划、精确数值计算等超出小模型能力范围的工作（当前代码中"任务分类与推流"由确定性代码完成，AI 实际只承担对话与报告两类，见 10.7）；

- 通过 Harness 调度层\+Plugin代码层兜底，弥补小模型规划、记忆、格式约束短板；

- 建立标准化的 Agent/Skill/Plugin 分层体系，实现测试能力可沉淀、可复用、可迭代；

- 以极简工程化界面，突出AI调度、工具执行、流程轨迹核心能力，彻底区分传统SaaS后台。

### 1\.3 核心差异化（对外认知统一口径）

区别于传统SaaS系统：无纯业务增删改查、无云端强依赖、无固定业务数据表驱动，核心是**AI智能体调度与自动化工作流执行**。

区别于通用AI工具：无通用办公、闲聊创作冗余能力，100%聚焦SLOT游戏测试垂直场景，流水线高度定制、执行效率更高。

---

## 2\. 整体架构设计（Hermes Harness 内核思想落地）

### 2\.1 架构设计哲学（适配7B本地模型）

完全遵循 Hermes Harness 工程化核心逻辑：**重代码、轻模型；重约束、轻自由；重流程、轻决策**。

为规避本地7B模型上下文短、推理弱、易乱格式、易跑偏的问题，做能力分层收敛：

- **机械固定逻辑**（数据解析、清洗、格式标准化、文件生成、比对、流程顺序）：全部下沉 Harness 调度代码 \+ Plugin 工具层；

- **智能语义逻辑**（意图澄清、执行结果归纳、失败原因归因）：交由 Agent \+ Skill 提供领域上下文，由模型做单轮语义输出；

- **流程调度权**：完全由 Harness 代码接管（`pipelineRegistry.ts` 声明 + `ExecutionEngine` 执行），禁止AI自主动态调度、禁止AI随意变更流水线步骤。

### 2\.2 四层分层架构（标准工业级AI Harness结构）

#### 第一层：Harness 调度内核（中枢层）

系统唯一总指挥，完全代码固化逻辑，以 TypeScript 实现于前端 `src/harness/`：

- **意图路由**（`intentRouter.ts`）：场景注册表 `SCENARIOS` + 关键词打分路由，不依赖 AI；

- **流水线声明**（`pipelineRegistry.ts`）：每个场景一条固定 Pipeline，步骤间参数映射由 `buildParams` 声明；

- **执行引擎**（`executionEngine.ts`）：按 stage 顺序串行调用后端 Plugin，负责状态流转、失败重试、用户中止；

- **模型调度管理**：统一的**多网关模型适配层**（`plannerProvider.ts` + `utils/llmGateway.ts`），支持本地 Ollama、OpenAI 兼容、Anthropic 兼容及自定义端点，模型来源一键切换、参数统一管控（详见第5章）；

- **全流程追踪**：每次运行创建一条 execution 记录，每次 Plugin 调用落库为 tool_call，前端执行控制台实时展示（详见第12章）；

- **固定上下文前缀**：每个场景的 Agent + Skill 文本以固定顺序拼接为该场景的领域上下文，同一场景内保持不变（有利于推理端的前缀缓存，但代码中**未实现**显式的缓存策略或缓存命中统计）。

#### 第二层：Agent 智能角色层（领域上下文层）

Agent 文件**不是自主执行体**，而是各场景的**只读领域参考上下文**：每个文件开头都声明"Execution Model：执行顺序由 Pipeline + ExecutionEngine 决定"，模型只在澄清问题与生成报告时参考其中的领域知识。当前仓库根目录 `agents/` 下共 5 个文件：

| Agent 文件 | 绑定场景 | 状态 |
|---|---|---|
| `testdata_generator_agent.md` | testdata_generation | 已接入 |
| `testdata_verifier_agent.md` | game_verification | 已接入 |
| `helpfile_conversion_agent.md` | easyhelp_checking | 已接入 |
| `portugal_plugin_verifier_agent.md` | portugal_plugin | 已接入 |
| `ui_log_diagnoser_agent.md` | （原 log_diagnosis 场景，已退役） | **未接入**，仅保留文件 |

Agent 内容通过 Vite `?raw` 在**构建期内联**进前端包（`intentRouter.ts` 的 `AGENT_CONTENT` 映射），修改后需重新构建前端，不支持运行时热更新。

#### 第三层：Skill 技能规则层（能力层）

配套专属技能手册，固定规则、约束AI行为。`skills/` 下共 8 个文件，全部被至少一个场景引用：

| Skill 文件 | 引用场景 |
|---|---|
| `skill-sheet-data-clean.md` | testdata_generation |
| `skill-generator-plugin-contract.md` | testdata_generation |
| `skill-verification-protocol.md` | game_verification |
| `skill-helpfile-conversion.md` | easyhelp_checking |
| `skill-helpfile-plugin-contract.md` | easyhelp_checking |
| `skill-portugal-plugin-symbol-map.md` | portugal_plugin |
| `skill-portugal-plugin-parsing-rules.md` | portugal_plugin |
| `skill-portugal-plugin-contract.md` | portugal_plugin |

（早期规划中的 `skill-task-dispatch-rule.md` 未创建。）Skill 同样经 `?raw` 构建期内联；后端 `GET /api/tools/skills/list` 另外从 `skills/` 目录实时列出文件元数据供界面展示。

#### 第四层：Plugin 本地工具层（执行层）

纯代码工具，以 Python 实现于 `server/tools/impl/*_tool.py`，统一继承 `ToolPlugin`（MCP 兼容的 name / description / inputSchema 描述），在 `server/tools/impl/__init__.py` 的 `BUILTIN_TOOLS` 中注册，后端启动时装入 `ToolRegistry`。当前共 14 个：

| 场景 | Plugin |
|---|---|
| TestData Generation | `testdata_parser`（解析粘贴的表格文本）、`testdata_generator`（写出 .testdata XML）、`zip_packager`（打包 ZIP + manifest） |
| TestData Verification | `testdata_verifier_harness`（Titan Harness 启动页登录 + Selenium，默认）、`testdata_verifier_api`（直连游戏 HTTP API，无浏览器）、`testdata_verifier`（真实游戏 URL + 借用 Chrome 配置 + Okta，旧方式）、`log_diagnoser`（规则式失败归因） |
| EasyHelp Checking | `html_to_text_converter`、`diff_comparator`（含关键词高亮与 Excel 输出）、`helpfile_analyzer`（服务端直调本地 Ollama 生成分析报告） |
| Portugal Plugin | `portugal_plugin_symbol_map`、`portugal_plugin_fetcher`（Selenium → Game History → PlayCheck 取回 outcome）、`portugal_plugin_parser`、`portugal_plugin_reporter`（TXT/JSON/HTML 报告） |

> 注：早期规划中的"GoogleSheet 读取 Plugin（表格 API 连接、拉取原始数据）"**未实现**。当前 TestData 生成的数据来源是用户把表格行**粘贴**进输入框，或用"+"附加本地文本/CSV 文件（浏览器端读取后并入输入框）；输入框中的 Google Sheet URL 仅用于场景/URL 类型校验，不会被抓取。

---

## 3\. 核心工作流水线（固定闭环）

全程由 Harness 代码固定调度，无AI自主决策步骤。所有经 ExecutionEngine 的场景共用同一条运行主线：

**用户选择场景（或关键词自动路由）→ 输入任务 / 附加文件 → 点击 ▲ 显示测试计划预览并确认 → 代码检查必填项（缺失时 AI 发起一轮澄清提问）→ 创建 execution 记录 → ExecutionEngine 按 Pipeline 逐 stage 调用后端 Plugin → 产物落盘、日志与工具调用落库 → 界面展示结果 → AI 对最后一步结果生成简要总结（异步、不阻塞完成状态）**

各场景的实际固定流程：

| 场景 | 驱动方式 | 固定步骤 |
|---|---|---|
| TestData Generation | ExecutionEngine | `testdata_parser` → `testdata_generator` → `zip_packager` |
| EasyHelp Checking | ExecutionEngine | `html_to_text_converter` → `diff_comparator` → `helpfile_analyzer` |
| Portugal Plugin Verification | ExecutionEngine | `portugal_plugin_symbol_map` → `portugal_plugin_fetcher`（粘贴模式下直通）→ `portugal_plugin_parser` → `portugal_plugin_reporter` |
| TestData Verification | `verificationEngine.ts` 直接驱动（**不经** ExecutionEngine） | 选定的一个验证 Plugin（异步执行 + SSE 实时进度）→ 有失败用例时 AI 诊断（失败则回退 `log_diagnoser`） |

所有流程步骤、执行顺序、异常兜底均代码固化，AI仅承担轻量化语义工作。

---

## 4\. UI界面设计规范（TraeWork 极简工程风）

完全对标 TraeWork 桌面Harness极简设计，舍弃WorkBuddy通用臃肿样式，适配SLOT专项测试场景，从视觉层面彻底区分传统SaaS。

### 4\.1 全局布局（实际实现）

工作台（Workbench）为"顶栏 + 三栏 + 底部状态栏"结构：

- **顶栏（Header）**：工作流阶段与状态、静音开关、模型管理入口、重置工作流。

- **左侧：资源导航栏（Sidebar）**（纯AI资源体系，无业务菜单）
    - **Plugin** / **Agents** / **History** 三个入口，分别打开插件与技能页、Agent 详情页、执行历史页；
    - **Scenarios** 场景选择器：列出 `SCENARIOS` 中全部场景，用户显式选择；
    - **Task List**：当前场景的固定步骤列表，随 ExecutionEngine 回调实时更新状态；
    - 无权限管理、无用户角色、无业务数据菜单。

- **中间：对话式执行区**
    - **执行控制台（ExecutionConsole）**：聊天式时间线，分 COT（事件/对话流）与 RAW_TOOLS（原始工具调用与返回）两个标签，支持历史轮次折叠；
    - **AI 澄清面板**：缺少必填信息时出现，仅一轮问答；
    - **测试计划预览面板**：点击 ▲ 后列出该场景的测试项供勾选确认（目前勾选仅作确认用途，唯一会影响执行的是 Portugal 场景的"Save Imported Mapping"）；TestData Verification 场景在此选择待验证文件与验证方式并填写所需凭据；
    - **输入框（固定在底部）**：自动从文本中拆出首个 URL；Enter 与 AI 简单对话，Shift+Enter 换行，▲ 提交测试任务；"+" 附件菜单（Add file(s) / Add folder，按场景决定打开的选择器）；右侧模型下拉选择。

- **右侧：流水线与产物**
    - **PipelineVisualization**：通用 5 阶段进度（Intent → Generate → Review → Verify → Complete），反映工作流阶段而非具体 Pipeline 步骤；
    - **TestDataPreview**：仅 TestData Generation 场景完成后显示，含 XML 预览与 ZIP 下载。

- **独立页面**：模型管理（LlmConfigPage，多模型配置存储与连通性测试）、Plugin（后端工具列表 + 技能列表）、Agents、History（历史执行列表，可重新打开验证报告）。

- **底部状态栏**：HARNESS v2、当前场景名、工作流状态。

> 规划中但**尚未实现**的界面能力：单步调试；模型推理 Token 消耗 / 推理耗时 / 缓存命中统计面板（后端已有 `llm_audit` 表与 `/api/executions/audit-llm` 接口，但前端未调用）。

> **登录说明**：Harness 自身**无登录**——打开即用。`server/infra/security.py` 的 `require_user()` 固定返回本地用户 `LOCAL_USER`，不做任何密码或 session 校验；早期的 `auth_router.py` 等账号体系已删除。Harness 登录与真实游戏/后台环境登录是两套互不相通的系统，早期"登录 Harness 即可免登录游戏环境"的假设不成立，因此移除。
>
> 游戏环境侧的登录现由验证方式自身解决（见 10.2 模块三补充说明）：默认的 **Harness 方式**经 QA 专用 Titan Harness 启动页表单登录（共享测试密码，无 Okta/MFA），testdata 上传走 Axiom API Key 直连；**API 方式**需要测试人员粘贴 Okta access_token 与 Axiom API Key；早期的 **Selenium 方式**（借用测试人员本机 Chrome 已登录配置 + 交互式 Okta）已不在界面提供，仅保留后端工具供历史报告重开。

### 4\.2 视觉与交互规范

- 极简工程化风格，深色主题，大圆角、弱阴影、低饱和科技色调，无冗余装饰；

- 核心突出「工作流、AI推理、工具执行、轨迹日志」四大AI Harness专属模块；

- 去除所有传统SaaS密集表单、批量操作、数据筛选、增删改查组件；

- 配套AI专属加载动效、节点流转动效、步骤完成提示音（可静音）。

---

## 5\. 模型适配策略（统一多网关设计，本地7B为主力）

模型策略的本质是"统一网关、多源接入"：本地 7B 模型是当前主力与默认选项，云端/其他 Provider 是面向扩展预留的能力，切换 Provider 不改变 AI 的职责边界。

### 5\.1 网关实现与 Provider Preset

前端统一网关为 `src/utils/llmGateway.ts`（`streamUniversalLlmChat` 流式调用 + `testLlmConnection` 连通性测试），`plannerProvider.ts` 在其上封装为 `PlannerProvider`。当前 Preset：

| Preset | 默认地址 | 默认模型 | 合规提示 |
|---|---|---|---|
| `OLLAMA` | `http://localhost:11434` | `qwen2.5-coder:7b`、`deepseek-r1:8b`、`qwen3-vl:8b`、`qwen3:latest` | 无（默认 · 合规） |
| `OPENAI` | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4o-mini` 等 | ⚠️ 外部服务 |
| `ANTHROPIC` | `https://api.anthropic.com/v1` | `claude-3-5-sonnet` / `haiku` | ⚠️ 外部服务 |
| `CUSTOM` | `http://localhost:8000/v1` | 自定义（OpenAI 兼容协议，如 vLLM） | ⚠️ 外部服务 |

- 没有独立的 DeepSeek Preset；DeepSeek 等 OpenAI 兼容服务通过 `OPENAI` / `CUSTOM` 配置 Base URL 接入；
- 选用带合规提示的 Provider 运行流水线时，执行控制台会输出合规警告；API Key 仅保存在浏览器 localStorage；
- 模型配置（含多模型列表与当前激活模型）保存在浏览器 localStorage（`slot_harness_llm_config` / `slot_harness_llm_models`），由模型管理页维护；
- 新增一个 Provider 类型需在 `LlmProviderType`、`PROVIDER_PRESETS` 增加条目，并在 `streamUniversalLlmChat` 中处理其协议（当前协议分支：Ollama `/api/chat`、Anthropic `/v1/messages`、其余按 OpenAI `chat/completions`）。

### 5\.2 统一参数约束

- 网关所有调用共享 `HARNESS_LLM_TEMPERATURE = 0.3`、`HARNESS_LLM_MAX_OUTPUT_TOKENS = 512`；Ollama 调用附带 `keep_alive: "30m"` 以减少冷启动；
- 所有调用均为**单轮、无工具调用（无 function calling）**；
- 代码未强制 JSON 输出格式（未使用 Ollama `format: json` 等约束）；需要结构化输出的调用（验证诊断）在 Prompt 中给出 JSON 模板，并由代码做容错解析（见 11.4）；
- 对纯寒暄消息（`isCasualChatMessage`：≤20 字的问候/致谢等）改用几句话的精简 System Prompt（`getScenarioLiteSystemPrompt`），避免本地小模型为一句"你好"重新处理数 KB 的 Agent+Skill 上下文。

### 5\.3 AI 实际调用点

| 调用点 | 位置 | 模型来源 | 用途 |
|---|---|---|---|
| `PlannerAgent.clarify()` | 前端 | 当前激活模型（网关） | 必填项缺失时生成一轮澄清问题；Enter 键简单对话 |
| `PlannerAgent.summarizeStepResult()` | 前端 | 当前激活模型（网关） | 流水线完成后对最后一步结果生成 3-6 句总结 |
| `runAIDiagnosis()` | 前端 `verificationEngine.ts` | localStorage 中保存的配置（网关） | 验证失败用例的根因诊断（JSON） |
| `helpfile_analyzer` Plugin | 后端 Python | **直连 Ollama**（默认 `http://localhost:11434`、`qwen3:latest`，温度 0.3），不经前端网关 | EasyHelp 分析报告 |

### 5\.4 为何采用多网关而非硬编码两个Provider

- **面向扩展，而非当前必需**：当前 4 条固定流水线本地 7B 模型即可覆盖；多网关的意义在于未来更换模型来源、接入客户自有模型API时无需重构 Harness；

- **架构解耦**：模型来源变化只影响 Provider 适配层，不影响意图路由、流水线定义、执行引擎、Agent/Skill 内容，符合第9章"层与层完全解耦"的扩展原则（`helpfile_analyzer` 的服务端直连是目前唯一例外）；

- **非通用能力冗余**：多网关不等于引入通用AI对话/办公能力，Provider 切换后 AI 的职责边界保持不变，不违背第1.3节"非通用AI工具"的定位。

---

## 6\. 目录结构（实际代码）

```Plain Text
slotgame-testing-harness/
├── agents/                    # Agent 领域参考上下文（构建期 ?raw 内联）
│   ├── testdata_generator_agent.md
│   ├── testdata_verifier_agent.md
│   ├── helpfile_conversion_agent.md
│   ├── portugal_plugin_verifier_agent.md
│   └── ui_log_diagnoser_agent.md          # 未接入任何场景
├── skills/                    # Skill 规则手册（8 个，见 2.2）
├── symbol_profiles/           # Portugal Plugin 符号映射存档（如 ADPC.json）
├── plugins/README.md          # 预留目录，仅说明文档；实际插件在 server/tools/impl/
├── workflows/README.md        # 预留目录，仅说明文档；实际流水线在 src/harness/pipelineRegistry.ts
├── src/                       # 前端：React + Vite + Tailwind
│   ├── harness/               # Harness 调度内核（TypeScript）
│   │   ├── intentRouter.ts        # 场景注册表 + 关键词路由 + 场景上下文拼接
│   │   ├── pipelineRegistry.ts    # 4 条流水线的声明式定义
│   │   ├── executionEngine.ts     # 执行引擎（stage 串行、重试、中止）
│   │   ├── plannerAgent.ts        # 收窄后的语义辅助单元（clarify / summarizeStepResult）
│   │   ├── plannerProvider.ts     # LLM Provider 适配
│   │   ├── client.ts              # 后端 API 客户端（含 SSE）
│   │   └── sharedTypes.ts         # 前后端共享类型
│   ├── utils/
│   │   ├── llmGateway.ts          # 多 Provider 网关
│   │   ├── verificationEngine.ts  # TestData Verification 驱动 + AI 诊断
│   │   ├── logVisionDiagnoser.ts  # 验证报告弹窗中的规则式单用例诊断
│   │   ├── paytableSheetParser.ts # 前端 mock 数据用的 paytable 解析
│   │   └── zipGenerator.ts        # 前端 ZIP 生成（TestDataPreview 下载）
│   ├── components/            # Header / Sidebar / ExecutionConsole / PipelineVisualization / TestDataPreview / VerificationReportModal / LlmConfigModal / XmlViewer
│   ├── pages/                 # LlmConfigPage / PluginPage / AgentPage / HistoryPage
│   └── App.tsx                # 工作台：场景状态、参数组装、运行入口
├── server/                    # 后端：FastAPI
│   ├── main.py                # 应用入口、SSE Hub、静态文件托管
│   ├── config.py              # 端口、CORS、数据目录（server/data/）
│   ├── api/                   # tools_router / executions_router / records_router
│   ├── services/execution_queue.py  # 串行执行队列
│   ├── infra/                 # storage（SQLite）/ security / cancellation / process_runner / logger
│   └── tools/                 # base.py（ToolPlugin / ToolRegistry）+ impl/（14 个 Plugin）
├── build.py / slot_harness.spec / harness.cmd   # PyInstaller + pywebview 桌面打包
└── generate_testdata.py / verify_testdata.py    # 独立命令行脚本
```

> 立项之初的设计意图目录（`agents/agent-sheet-reader.md`、`plugins/google_sheet_reader.py`、`workflows/slot-test-pipeline.yaml`、`harness/scheduler.py` 等）未按原样落地：调度内核以 TypeScript 实现在 `src/harness/`，Plugin 以 Python 实现在 `server/tools/impl/`，流水线以 TypeScript 声明在 `pipelineRegistry.ts`（YAML 流水线配置为规划能力）。四层解耦的分层理念不变。

---

## 7\. 核心优势总结（可用于汇报、评审、落地归档）

1. **架构先进**：吸收Hermes标准Harness工程内核，以约束化调度解决小模型落地难题，区别于普通Agent框架；

2. **场景垂直**：专为SLOT游戏测试定制，无通用冗余能力，执行效率远高于通用AI平台；

3. **形态纯正**：采用TraeWork极简工程桌面UI，三栏式AI专属布局，完全规避传统SaaS观感；

4. **多网关兼容**：本地7B模型免费调试为主，OpenAI 兼容 / Anthropic 兼容 / 自定义端点为辅，一套架构适配研发全流程，且预留未来扩展空间；

5. **工程可沉淀**：Agent/Skill/Plugin分层解耦，测试能力可复用、可迭代、可标准化沉淀。

---

## 8\. 最终项目定位定稿（官方标准话术）

本系统是**吸收Hermes Harness调度内核思想、采用TraeWork极简工程化桌面UI、专为SLOT游戏测试场景打造的垂直领域AI智能体调度座舱**。依托分层化Agent、标准化Skill规则、本地化Plugin工具与约束式Harness调度引擎，以7B规模模型（本地Ollama为主，多网关云端Provider为扩展补充）稳定承担简单对话、分析报告生成等轻量语义任务，由预先设计好的固定工作流（Agent+Skill+Plugin组合）驱动完成测试数据生成、真实环境测试数据验证、帮助文件比对、Portugal Plugin 输出校验等测试闭环，是轻量化、高专注度、工程化的垂直AI测试工作台，区别于通用AI办公工具与传统SaaS业务系统。

---

## 9\. 未来能力扩展性设计（系统可迭代规划）

本套Slot Game Testing Harness架构**支持横向扩展、能力插拔、场景迭代**，并非只能做单一「TestData生成与验证」——当前已从最初的生成/验证扩展到 EasyHelp 检查与 Portugal Plugin 校验共 4 个场景，即是这一点的实际验证。

本章说明：**如何新增插件、新增Agent技能、新增测试流水线、新增业务模块**。

### 9\.1 核心扩展原理：四层架构支持插拔式迭代

- **Harness调度层**：新增场景 = 新增一条 Scenario + 一条 Pipeline 声明，执行引擎代码无需修改；

- **Agent角色层**：新增场景专属的领域参考文件，不影响其他场景；

- **Skill技能层**：技能文件可叠加、可被多个场景复用；

- **Plugin工具层**：新增工具注册到 `ToolRegistry` 即可被任何流水线调用。

👉 **扩展以「增量叠加」为主，存量稳定业务不受影响**；但当前仍有若干处需要手工同步的硬编码清单（见 9.2 / 9.3 的操作步骤与第13章）。

### 9\.2 Plugin插件扩展（最核心的扩展方式）

当前已落地 14 个 Plugin（见 2.2）。后续可新增的 SLOT 专项插件方向：

- **SLOT数值校验插件**：倍率校验、概率校验、随机值分布合规性校验；
- **关卡/剧情测试插件**：多场景剧情数据批量生成与合法性验证；
- **异常用例生成插件**：边界值、非法参数、异常场景自动构造；
- **自动化报告导出插件**：测试覆盖率、数据合规报告、批量执行报表；
- **版本比对插件**：新旧版本测试数据差异对比、变更风险识别。

**实际扩展步骤**：

1. 在 `server/tools/impl/` 新建 `xxx_tool.py`，继承 `ToolPlugin`，声明 `info`（name / description / inputSchema）并实现 `_run_impl`；
2. 在 `server/tools/impl/__init__.py` 的 `BUILTIN_TOOLS` 中注册（后端启动时自动装入 `ToolRegistry`，`/api/tools/list` 即可列出）；
3. 若属于某场景，在 `server/api/tools_router.py` 的 `SCENARIO_PLUGINS` 和 `intentRouter.ts` 对应场景的 `requiredPlugins` 中加入；
4. 在 `pipelineRegistry.ts` 中以步骤形式引用该 Plugin，并用 `buildParams` 声明入参映射；
5. 若需长时间运行且可被"停止"按钮中断，在获取资源（如 WebDriver）后调用 `server/infra/cancellation.register()` 注册清理回调。

> 注意：前端执行引擎只会额外附加 `__execution_id` 元数据；`ToolPlugin.validate()` 会把 inputSchema 之外的任何参数当作 `unknown_param` 拒绝。

### 9\.3 Agent智能角色扩展

可规划的领域上下文方向：校验评审、场景拆解、风险巡检、报告总结等。所有 Agent 仍遵循"只读领域上下文、不驱动执行"的模型。

**实际扩展步骤**：在 `agents/` 新增 `.md` 文件 → 在 `intentRouter.ts` 用 `?raw` 导入并加入 `AGENT_CONTENT`（以场景 id 为键）→ 重新构建前端。Agent 详情页（`AgentPage.tsx`）的展示数据为硬编码，需同步手工维护。（"新增 .md 即被 Harness 自动加载、前端自动展示"为规划目标，当前未实现。）

### 9\.4 Skill技能库持续沉淀（能力资产化）

可持续沉淀的方向：SLOT概率合规性判定、倍率溢出校验、特殊玩法数据校验、边界场景识别等。

**实际扩展步骤**：在 `skills/` 新增 `.md` → 在 `intentRouter.ts` 用 `?raw` 导入并加入 `SKILL_CONTENT`（以文件名为键）→ 在场景的 `skills` 数组中引用 → 同步 `PluginPage.tsx` 的 `HARDCODED_SKILLS` 展示数据。

### 9\.5 工作流流水线扩展（多场景流水线）

当前已有 4 条独立流水线（见第3章）。可继续扩展：

- 快速冒烟测试流水线（轻量、极速校验）
- 全量批量回归测试流水线（大规模量产）
- 异常场景专项测试流水线
- 版本迭代对比测试流水线

**实际扩展步骤**：`pipelineRegistry.ts` 新增 PipelineDef → `intentRouter.ts` 新增 TestScenario（含关键词）→ `App.tsx` 中补充该场景的 `STAGE1_TASKS`（任务列表）、`SCENARIO_TEST_ITEMS`（测试计划预览项）、`checkMissingField`（必填项检查，可选）以及 `runPipeline` 中的 `extraParams` 组装 → `tools_router.py` 的 `SCENARIO_PLUGINS`。

前端已支持多流水线切换（Sidebar 场景选择器）；各次运行的日志在执行控制台按轮次分组，后端按 execution_id 隔离工作目录。

### 9\.6 UI界面扩展能力

- 左侧场景选择器自动列出 `SCENARIOS` 中新增的场景；Agent/Skill 展示页目前需手工同步；
- 中间对话区与"+"附件菜单按场景切换行为，可为新场景增加分支；
- 右侧可增加专项面板（校验统计、覆盖率统计、风险统计等，规划中）。

UI无需重构，仅增量新增功能模块，始终保持极简高效，不会变成臃肿SaaS。

### 9\.7 模型能力拓展

- 支持后续无缝升级 14B/32B 本地大模型（仅需在模型管理页切换）；
- 支持接入多家云端模型；按任务复杂度自动择优调度为规划能力（见 11.5）；
- 支持模型微调对接，针对SLOT场景持续优化专项能力（规划）。

### 9\.8 最终扩展结论（可对外汇报）

本Slot Game Testing Harness**不是一次性固定工具，而是一套可持续生长的AI测试工程体系**。

当前已完成「测试数据生成、真实环境验证、帮助文件比对、Portugal Plugin 校验」四条闭环，依托Hermes式分层约束架构与插件化设计，可**低成本、增量式**拓展为覆盖「数据生成、智能校验、异常测试、回归测试、风险巡检、自动报告」的全站SLOT游戏AI自动化测试平台。

---

## 10\. HARNESS框架扩展设计（多场景流水线架构）

### 10\.1 架构演进说明

早期 HARNESS 采用**单一流水线硬编码**模式（`用户输入 → PlannerAgent(stage1) → testdata_parser → testdata_generator → zip_packager`，由 PlannerAgent 驱动工具调用），新增场景需修改代码、Prompt 和前端 stage 枚举。

该模式**已完成升级**：当前由 意图路由器 + 流水线注册表 + 执行引擎 三个模块组成多场景架构，PlannerAgent 被收窄为不参与流程控制的语义辅助单元。以下各节描述的是当前代码实现。

### 10\.2 HARNESS三层核心模块

#### 模块一：意图路由器（Intent Router，`intentRouter.ts`）

**职责**：维护场景注册表；根据用户自然语言做关键词匹配；为场景拼接 Agent + Skill 领域上下文。

```typescript
interface TestScenario {
  id: string;                    // 场景唯一标识
  label: string;                 // 前端显示名称
  description: string;           // 场景说明（也用于精简 System Prompt）
  keywords: string[];            // 关键词匹配规则
  agentFile: string;             // 对应的 Agent .md 文件
  skills: string[];              // 需要的 Skill 文件列表
  pipelineId: string;            // 流水线ID
  requiredPlugins: string[];     // 依赖的 Plugin 列表
  icon: "zap" | "shield" | "bug" | "file-text" | "globe";
}
```

当前注册的 4 个场景：

| id | label | pipelineId | requiredPlugins |
|---|---|---|---|
| `testdata_generation` | TestData Generation | `testdata-gen-pipeline` | testdata_parser, testdata_generator, zip_packager |
| `game_verification` | TestData Verification | `game-verify-pipeline` | testdata_verifier, testdata_verifier_api, testdata_verifier_harness, log_diagnoser |
| `easyhelp_checking` | EasyHelp Checking | `helpfile-conversion-pipeline` | html_to_text_converter, diff_comparator, helpfile_analyzer |
| `portugal_plugin` | Portugal Plugin Verification | `portugal-plugin-verify-pipeline` | portugal_plugin_symbol_map, portugal_plugin_fetcher, portugal_plugin_parser, portugal_plugin_reporter |

**路由策略**（不依赖 AI）：

- 用户在 Sidebar 显式选择场景为主；
- 点击 ▲ 时 `routeIntent()` 对输入做关键词打分：每个命中关键词得 `长度 × 10` 分，含空格/下划线的多词关键词翻倍，出现在输入开头（位置 ≤ 3）再加 20 分；
- 仅当最高分场景与当前所选不同**且得分 > 100** 时才自动切换场景，并在控制台记录命中关键词与得分，避免误判覆盖用户选择。

**上下文拼接**：`getScenarioSystemPrompt()` 按"Agent 角色与领域规则（仅供参考，非工具调用指令）→ Skill 规则（严格遵守）"顺序拼接；该上下文只供 PlannerAgent 的 `clarify` / `summarizeStepResult` 使用，不是工具调用 System Prompt。

#### 模块二：流水线编排器（Pipeline Registry，`pipelineRegistry.ts`）

**职责**：声明式定义每个场景的执行步骤、重试策略与**步骤间参数映射**。

```typescript
interface PipelineParamContext {
  extraParams: Record<string, unknown>;   // 启动参数（由 App.tsx 根据 UI 状态组装）
  stepResults: Record<string, unknown>;   // 之前各步骤成功后的 result.content，key 为 stepId
}

interface PipelineStepDef {
  id: string;
  plugin: string;              // 调用的 Plugin 名称
  label: string;               // 前端显示名
  description?: string;
  dependsOn: string[];         // 依赖的前置步骤（声明性，见下方说明）
  retryOnFail: boolean;        // 失败是否重试
  maxRetries: number;
  buildParams?: (ctx: PipelineParamContext) => Record<string, unknown>;  // 入参映射
}

interface PipelineDef {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStepDef[][];  // 二维数组：外层=阶段(串行)，内层=阶段内步骤
}
```

当前 4 条流水线（`PIPELINES` 数组）：

| Pipeline | 步骤（plugin，重试） |
|---|---|
| `testdata-gen-pipeline` | parse（testdata_parser，重试2）→ generate（testdata_generator，重试2）→ package（zip_packager，不重试） |
| `game-verify-pipeline` | verify（testdata_verifier，不重试）→ diagnose（log_diagnoser，不重试）——**已声明但当前未被调用**，见模块三补充说明 |
| `helpfile-conversion-pipeline` | convert（html_to_text_converter，重试1）→ compare（diff_comparator）→ analyze（helpfile_analyzer） |
| `portugal-plugin-verify-pipeline` | resolve_symbol_map → fetch_portugal_plugin → parse_portugal_plugin → report_portugal_plugin（均不重试） |

`buildParams` 是"AI 不决定参数"的关键：例如 generate 步骤取 `stepResults.parse.records`，Portugal 的 parse 步骤直接使用 stage 0 解析出的 `symbol_map`。未声明 `buildParams` 的步骤退化为直接透传 `extraParams`。

> 说明：外层 stage 严格串行；**内层步骤按声明顺序串行执行**，stage 内并行为架构预留（当前每个 stage 仅含一个步骤）。`dependsOn` 目前仅为声明性元数据，执行引擎**不做依赖校验**——依赖关系实际由 stage 顺序保证。

#### 模块三：执行引擎 + 状态机（Execution Engine，`executionEngine.ts`）

**职责**：按流水线定义逐步执行，管理状态流转，处理失败与中止。

```
执行引擎（代码控制，AI不参与）：
  初始化上下文：所有步骤 = pending，pipeline = running
  for each stage in pipeline.stages:
    for each step in stage:                    # 串行
      for attempt in 1..(retryOnFail ? maxRetries+1 : 1):
        status = running / retrying
        params = step.buildParams(extraParams, stepResults) + { __execution_id }
        result = POST /api/tools/execute { tool_name: step.plugin, params }
        success → status = success，stepResults[step.id] = result.content，下一步
        failure → 还有次数则重试，否则 status = failed
    stage 内有失败步骤 → pipeline = failed，停止
  全部完成 → pipeline = completed
  AbortSignal 触发 → pipeline = aborted
```

- 步骤状态：`pending / running / retrying / success / failed`（类型中另有 `skipped`，当前未使用）；流水线状态：`running / completed / failed / aborted`（类型中另有 `idle / paused`，当前未使用）；
- 通过 `EngineCallbacks`（onStepChange / onStepComplete / onStepFail / onStatusChange / onLog）把进度同步到任务列表与执行控制台；
- **停止**：前端 AbortController 中止后续步骤；对正在后端运行的浏览器类 Plugin（`portugal_plugin_fetcher` 等），前端另调 `POST /api/executions/{id}/cancel`，由后端 cancellation 注册表强制关闭 WebDriver。

**AI 在流水线中的位置**（由 App.tsx 编排，均在引擎之外）：

- 运行前：代码检查必填项（`checkMissingField`），缺失时 `PlannerAgent.clarify()` 生成**一轮**澄清问题，用户回答由代码直接写入对应字段（不经 AI 二次解读），然后运行流水线；
- 运行后：流水线完成状态立即生效，随后**异步、不阻塞**地调用 `summarizeStepResult()` 对最后一步结果生成总结，LLM 不可用时只记录警告。

**补充说明：TestData Verification 场景的执行路径**

该场景**不经过 ExecutionEngine**，`game-verify-pipeline` 虽已声明但未被调用。实际路径（`App.tsx` → `utils/verificationEngine.ts` 的 `runRealGameVerification`）：

1. 用户通过"+"上传 .testdata 文件或文件夹（后端 `/api/tools/upload-testdata` 落盘），在测试计划预览面板选择文件与验证方式并填写凭据；
2. 按验证方式选择**一个** Plugin：`harness`（默认）→ `testdata_verifier_harness`，需 Titan Harness 启动页 URL、Axiom API Key、Product Id、Client Id（Brand 可选），Username / Module Id 从 testdata 文件 `<Key>` 中推导；`api` → `testdata_verifier_api`，需 Okta access_token 与 Axiom API Key，无截图；`selenium` → `testdata_verifier`，界面已不再提供；
3. `POST /api/tools/execute-async` 后台执行，前端经 SSE（`/api/executions/stream/{id}`）实时接收逐用例进度，完成后读取 execution 详情汇总为验证报告；
4. 存在失败用例时调用 `runAIDiagnosis()`：LLM 按 Prompt 中的 JSON 模板输出诊断；若调用抛错，回退为调用 `log_diagnoser` Plugin 做规则式诊断；
5. 报告在 VerificationReportModal 中展示（弹窗内另有前端规则式单用例诊断 `logVisionDiagnoser.ts`），并可在 History 页重新打开。

### 10\.3 新增测试场景完整示例：翻译文件验证（架构扩展能力示例，非当前已实现场景）

> 注：本节"翻译文件验证"是用于说明架构可扩展性上限的**假设性示例**，当前代码中不存在该场景、对应 Agent/Skill 或 `file_scanner` / `translation_checker` / `report_generator` 等 Plugin。

**用户需求**："验证Phoenix5游戏名在33个翻译文件中的翻译是否正确"

```
┌─ HARNESS意图路由器 ─────────────────────────────
│  匹配关键词"翻译" → 场景: translation_verification  │
│  加载Agent: translation_verifier_agent.md          │
│  加载Skill: skill-translation-check.md             │
│  加载Pipeline: translation-verify-pipeline         │
│  检查Plugin: file_scanner, translation_checker     │
──────────────────────────────────────────────────┘
         ↓
┌─ 流水线执行 ─────────────────────────────────────
│  Stage 1: file_scanner                            │
│    → 扫描指定目录下33个翻译文件                      │
│    → 提取每个文件中"Phoenix5"对应的翻译文本          │
│    → 输出: [{file: "zh-CN.json", value: "凤凰5"},  │
│             {file: "ja-JP.json", value: "フェニックス5"}, ...] │
│                                                    │
│  Stage 2: translation_checker                      │
│    → AI判断每个翻译是否合理（语义校验）               │
│    → 检查术语一致性、格式规范性                       │
│    → 输出: 通过/不通过 + 原因                        │
│                                                    │
│  Stage 3: report_generator                         │
│    → 汇总结果，生成差异报告                           │
│    → 输出: JSON报告 + 前端可视化                     │
└──────────────────────────────────────────────────┘
```

按 9.5 的实际扩展步骤，落地该场景需要：新增 3 个 Plugin、1 个 Agent 文件、1 个 Skill 文件、1 条 PipelineDef、1 条 TestScenario，以及 App.tsx 中该场景的任务列表、测试计划项与参数组装。

### 10\.4 前端适配（实际实现）

左侧导航栏已升级为包含**场景选择器**的结构：

```
Sidebar:
├── Plugin        → 插件与技能页
├── Agents        → Agent 详情页
├── History       → 执行历史页
├── Scenarios
│   ├── TestData Generation
│   ├── TestData Verification
│   ├── EasyHelp Checking
│   └── Portugal Plugin Verification
└── Task List     → 当前场景的固定步骤与实时状态
```

用户先选场景，再输入任务描述 / 附加文件。HARNESS 根据场景决定输入框提示文案、"+"附件行为、测试计划项、参数组装与所运行的 Pipeline。

### 10\.5 HARNESS目录结构

```
src/harness/
├── intentRouter.ts        # 场景注册表 + 意图路由 + 场景上下文拼接
├── pipelineRegistry.ts    # 流水线定义（声明式，含 buildParams）
├── executionEngine.ts     # 执行引擎（状态机 + 步骤调度 + 重试 + 中止）
├── plannerAgent.ts        # AI 语义辅助（clarify / summarizeStepResult，不控制流程）
├── plannerProvider.ts     # LLM 调用适配
├── client.ts              # 后端 API 客户端（REST + SSE）
└── sharedTypes.ts         # 类型定义
```

### 10\.6 关键设计原则

| 原则 | 说明 | 当前落实情况 |
|------|------|------|
| **场景驱动，非流程驱动** | 用户选场景 → HARNESS 自动组装 Agent+Skill+Pipeline+Plugin | 已落实 |
| **流水线声明式定义** | 新增测试类型在 `pipelineRegistry.ts` 加定义 + 写对应 Plugin，不改执行引擎 | 引擎无需修改；但 App.tsx 中仍需补充场景专属的参数组装与 UI 清单 |
| **AI只做语义，代码做流程** | 流程由 `ExecutionEngine` 代码硬控，AI 不决定"下一步调什么工具" | 已落实；所有 LLM 调用均为单轮、无工具调用 |
| **Plugin即插即用** | 每个新测试能力 = 一个 Plugin 文件，注册到 `ToolRegistry` 即可被任何流水线调用 | 已落实 |
| **Agent/Skill配置化** | 新增场景只需加 `.md` 文件，不改代码 | 部分落实：需在 `intentRouter.ts` 导入并重新构建前端 |

### 10\.7 当前工作流范围说明（固定工作流驱动，非AI自主编排）

**当前实际范围**：项目覆盖 **4 个固定测试场景**——TestData Generation、TestData Verification、EasyHelp Checking、Portugal Plugin Verification。每个场景对应一条**预先设计好的固定流程**，运行前已经确定，不由 AI 临场决定。原"日志诊断"已不再是独立场景，失败诊断作为验证报告的一部分自动执行。

**执行模型的关键澄清**：

- 流程调度权在代码：三个场景由 ExecutionEngine 按 Pipeline 声明执行；TestData Verification 由 `verificationEngine.ts` 按固定顺序执行。AI **不参与"下一步该调用哪个工具"的决策**，也不决定 Plugin 入参；

- AI（7B模型）的三类职责在代码中的落实情况：
  1. **简单对话交互** —— 已实现：输入框 Enter 键单轮对话；必填项缺失时一轮澄清提问（`PlannerAgent.clarify`）；
  2. **任务分类与推流** —— 由确定性代码承担：场景路由为关键词打分，数据分类/分组由各 Plugin 内部规则完成（如 testdata_parser 按规则分组文件），当前不调用模型；
  3. **分析报告生成** —— 已实现：流水线结束后的步骤结果总结（`summarizeStepResult`）、验证失败用例 AI 诊断（`runAIDiagnosis`）、EasyHelp 分析报告（`helpfile_analyzer` 服务端调用 Ollama）；

- 第9.5节的更多流水线、第10.3节的"翻译文件验证"均为**面向未来的架构扩展示例**，不代表已经实现。

---

## 11\. 本地/云端 AI 模型（7B规模）功能定位与使用规范

### 11\.1 7B模型能力边界

| 能做好 | 做不好 |
|--------|--------|
| 理解一段自然语言的意思 | 记住很长的上下文（>4K tokens容易丢） |
| 判断文本A和文本B是否语义一致 | 复杂的多步逻辑推理 |
| 按固定模板输出JSON | 自由发挥时格式容易乱 |
| 从文本中提取结构化信息 | 数学计算、精确数值比较 |
| 识别明显的翻译错误 | 细微的文化语境差异 |

**核心定位**：7B模型是HARNESS的"语义传感器"，负责看和听（语义理解），但"手脚"和"大脑"（流程控制、决策、执行）全是代码。结合本项目实际场景，7B模型的职责收敛为三类具体任务（与第1.2节、第10.7节保持一致）：

1. **简单对话交互**：理解用户自然语言意图、澄清缺失参数，不做多轮复杂推理；
2. **任务分类与推流**：判断一条数据/结果应归入哪个类别（当前由代码规则承担，保留为模型可承担的职责）；
3. **分析报告生成**：把 Plugin 的结构化执行结果整理成简明的分析/诊断文本。

超出以上三类的工作（如精确数值计算、多步骤自主规划）一律下沉到代码层完成，不交给模型判断。

### 11\.2 AI在各环节的具体职责

#### 场景1：TestData生成（已实现）

```
┌─ 代码层（ExecutionEngine + Plugin）────────────────┐
│  0. 输入: 用户粘贴的表格行 / "+" 附加的文本或CSV       │
│     （不抓取 Google Sheet URL）                       │
│  1. testdata_parser:                                 │
│     - 正则提取 Module ID: /Module\s*ID\s*#?:?\s*(\d+)/i │
│       （未找到时用默认值 105359）                       │
│     - 清洗 batch,index 对、识别 case 名与 Bet Lines ID  │
│     - 按规则分组文件（文件名前缀默认 P5P）               │
│  2. testdata_generator: 生成 .testdata XML             │
│  3. zip_packager: 打包 ZIP + manifest.json             │
└────────────────────────────────────────────────────┘
         ↑ 这些全是代码，AI不参与

┌─ AI层（7B模型）──────────────────────────────────┐
│  运行前（仅当输入中没有 "数字,数字" 形式的行时）：       │
│    clarify → 生成一句话澄清问题，请用户粘贴表格行        │
│  运行后（异步、不阻塞）：                               │
│    summarizeStepResult → 对 package 步骤结果写 3-6 句总结 │
└────────────────────────────────────────────────────┘
```

**AI占比：远低于10%**。数据解析、分类、生成全部由代码完成；早期设想中"AI 判断某行数据属于哪个分类""AI 检查 batch 是否异常"均未实现，分类由 testdata_parser 规则完成。

#### 场景2：翻译文件验证（架构示例，未实现，见 10.3 / 10.7）

```
┌─ 代码层（HARNESS执行引擎）─────────────────────────┐
│  1. 扫描目录下所有.json/.xml翻译文件                  │
│  2. 正则提取每个文件中"Phoenix5"对应的翻译值           │
│  3. 构建对照表: {file: "zh-CN.json", value: "凤凰5"}  │
│  4. 检查格式规范性（编码、特殊字符、长度限制）            │
│  5. 统计通过率、生成报告框架                            │
└────────────────────────────────────────────────────┘

┌─ AI层（7B模型）──────────────────────────────────┐
│                                                      │
│  任务A: 语义一致性判断                                │
│  输入: [{lang: "zh-CN", value: "凤凰5"},             │
│         {lang: "ja-JP", value: "フェニックス5"},     │
│         {lang: "ko-KR", value: "피닉스5"}]           │
│  Prompt: "以下翻译是否都指向同一游戏名'Phoenix5'？    │
│         输出JSON: {consistent: bool, issues: []}"    │
│  输出: {"consistent": true, "issues": []}             │
│                                                      │
│  任务B: 翻译质量评估                                  │
│  输入: {lang: "de-DE", value: "Phönix Fünf"}         │
│  Prompt: "这个德语翻译是否准确传达了'Phoenix5'的含义？ │
│         评分1-5，给出理由"                             │
│  输出: {"score": 4, "reason": "Fünf是5的德语，       │
│          但游戏名通常保留原文或音译"}                    │
│                                                      │
│  任务C: 术语一致性检查                                │
│  输入: 33个文件中所有翻译值的列表                      │
│  Prompt: "检查以下翻译列表中是否有不一致的术语使用"      │
│  输出: {"inconsistencies": [                          │
│    {file: "fr-FR.json", issue: "使用了'Phoenix Cinq'  │
│     而非'Phoenix 5'，数字应保留阿拉伯数字"}            │
│  ]}                                                    │
────────────────────────────────────────────────────┘
```

**AI占比（设想）：约30%**。代码做文件扫描和格式检查，AI做语义判断和质量评估。

#### 其他已实现场景的 AI 职责（摘要）

| 场景 | 代码层 | AI 层 |
|---|---|---|
| TestData Verification | 选定验证 Plugin 执行、SSE 进度、报告汇总、规则式诊断回退 | 失败用例根因诊断（JSON：summary / diagnoses / recommendations） |
| EasyHelp Checking | HTML→TXT 转换、基线差异比对、关键词计数与高亮、Excel 输出 | `helpfile_analyzer` 生成分析报告（服务端 Ollama）；流水线结束后的步骤总结 |
| Portugal Plugin | 符号映射导入/校验/自测、PlayCheck 取数、解析、汇总与一致性检查、TXT/JSON/HTML 报告 | 缺少输入时的澄清提问；流水线结束后的步骤总结 |

### 11\.3 7B模型Prompt设计要点

因为模型小，Prompt必须**极度收敛**：

```typescript
// ❌ 错误：让模型自由发挥
const badPrompt = `
  你是一个翻译专家，请检查这些翻译文件的质量...
  （模型可能输出任意格式，甚至开始闲聊）
`;

// ✅ 正确：强制结构化输出
const goodPrompt = `
  你是翻译一致性检查器。

  输入：33个翻译文件中"Phoenix5"的翻译值列表

  任务：判断是否有不一致的翻译

  输出格式（严格JSON，不要输出其他内容）：
  {
    "consistent": true/false,
    "issues": [
      {"file": "文件名", "value": "翻译值", "reason": "原因"}
    ]
  }

  开始检查：
  [数据列表]
`;
```

**关键技巧**：
1. **角色限定**：不是"翻译专家"，而是"翻译一致性检查器"（缩小行为空间）——代码中的对应做法：`clarify` 限定为"lightweight clarification assistant"，`summarizeStepResult` 限定为"report-summary assistant"；
2. **输出格式锁定**：给JSON Schema，不让模型自由组织语言——验证诊断 Prompt 即按此给出 JSON 模板；
3. **任务单一**：一次Prompt只做一个判断，不堆叠多个任务——代码中每次调用只做一件事，并明确"不调用工具、不规划下一步"；
4. **长度约束**：限定回答句数（澄清 1-3 句、总结 3-6 句），输入结果截断至 4000 字符；
5. **Few-shot示例**：给1-2个输入输出示例，7B模型模仿能力强（当前代码未使用，可按需引入）。

### 11\.4 代码兜底策略

**当前已实现的兜底**：

| 调用 | 失败/异常时 |
|---|---|
| `clarify`（澄清提问） | LLM 不可用 → 使用代码内置的固定问句（"Looks like I'm missing …"），并记录警告 |
| `clarify`（Enter 对话） | 记录"AI chat unavailable"警告，不影响任何流程 |
| `summarizeStepResult` | 异步执行；失败只记录警告，流水线已是完成状态，不回滚、不阻塞 |
| `runAIDiagnosis` | 用正则提取响应中的 JSON 对象解析；解析失败 → 把原始文本作为 summary；调用抛错 → 回退为 `log_diagnoser` 规则式诊断；`log_diagnoser` 也失败 → 返回最小诊断 |
| `helpfile_analyzer` | 插件内部自带回退结果（提示检查 Ollama 模型可用性） |

**示意代码（设想，以翻译场景为例，未实现）**：

```typescript
async function runTranslationCheck(files: TranslationFile[]) {
  // 1. 代码做确定性工作
  const extracted = files.map(f => ({
    file: f.name,
    value: f.content.match(/"Phoenix5":\s*"([^"]+)"/)?.[1] ?? "",
  }));

  // 2. AI做语义判断
  let aiResult = await callLocalLLM({
    prompt: buildConsistencyCheckPrompt(extracted),
    temperature: 0.2,  // 低温，减少随机性
    maxTokens: 500,    // 限制输出长度
  });

  // 3. 代码校验AI输出格式
  let parsed: CheckResult;
  try {
    parsed = JSON.parse(aiResult);
    if (!('consistent' in parsed)) throw new Error("格式错误");
  } catch {
    // AI输出格式错误 → 重试一次
    aiResult = await callLocalLLM({ ...retryPrompt });
    parsed = JSON.parse(aiResult);  // 再失败就上报异常
  }

  // 4. 代码做最终决策
  return {
    totalFiles: files.length,
    aiJudgment: parsed,
    autoFixable: parsed.issues.filter(i => isAutoFixable(i)),
    manualReview: parsed.issues.filter(i => !isAutoFixable(i)),
  };
}
```

**通用兜底原则**（规划，当前仅部分落实）：
- AI输出格式错误 → 自动重试1次（当前未实现重试，采用容错解析 + 回退）；
- AI判断矛盾（如说consistent=true但issues非空）→ 代码标记为"需人工复核"；
- AI超时/失败 → 降级为纯规则检查（验证诊断已按此实现）。

### 11\.5 7B本地模型 vs 云端多Provider模型分工

| 任务类型 | 7B本地模型 | 云端模型（OpenAI/Anthropic兼容等） |
|----------|------------|--------------------------|
| 简单分类判断 | ✅ 胜任 | ✅ 胜任（浪费） |
| 格式结构化输出 | ✅ 胜任（需严格Prompt） | ✅ 胜任 |
| 复杂语义推理（如文化语境） | ⚠️ 勉强，需人工复核 | ✅ 胜任 |
| 长文本摘要（>2K tokens） | ❌ 容易丢失信息 | ✅ 胜任 |
| 批量处理（100+文件） | ✅ 免费，可并行 | ⚠️ 成本高 |

**推荐策略**：
- **开发调试阶段**：全用7B本地模型，快速迭代；
- **批量生产阶段**：简单任务用7B本地模型，复杂语义判断按需在模型管理页切换云端Provider；
- **HARNESS自动路由**（规划，**未实现**）：代码根据任务复杂度自动选择模型来源。当前实际为：前端所有调用使用用户在模型下拉/模型管理页中选定的同一个模型；`helpfile_analyzer` 在服务端固定使用本地 Ollama。

```typescript
// 规划中的自动择模逻辑（当前代码中不存在）
function selectModel(task: TestTask): "local" | "cloud" {
  if (task.complexity === "simple") return "local";  // 分类、格式检查
  if (task.complexity === "complex") return "cloud"; // 语义推理、质量评估
  return "local";  // 默认本地
}
```

### 11\.6 7B模型在HARNESS中的定位总结

```
┌──────────────────────────────────────────────────┐
│  HARNESS执行引擎（代码）                           │
│  ┌────────────────────────────────────────────┐  │
│  │  流程控制 · 数据解析 · 格式校验 · 文件操作    │  │
│  │  · 失败重试 · 规则诊断 · 状态管理            │  │
│  └────────────────────────────────────────────┘  │
│                      ↑↓ 调用（单轮、无工具调用）     │
│  ┌────────────────────────────────────────────┐  │
│  │  7B本地模型（语义传感器）                    │  │
│  │  · 简单对话 / 澄清提问                       │  │
│  │  · 结果总结与失败诊断                        │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**一句话总结**：7B模型是HARNESS的"眼睛"和"耳朵"，负责看和听（语义理解），聚焦简单对话与分析报告等轻量任务；但"手脚"和"大脑"（流程控制、决策、执行）全是代码。这样既发挥了AI的语义能力，又规避了小模型的不可靠性。

---

## 12\. 后端服务架构（新增，对应 `server/`）

### 12\.1 技术栈与启动

- FastAPI + uvicorn，默认监听 `0.0.0.0:8000`（`HARNESS_API_HOST` / `HARNESS_API_PORT`），配置从项目根目录（打包后为 exe 所在目录）的 `.env` 读取；
- 启动时初始化 SQLite、把 `BUILTIN_TOOLS` 注册进 `ToolRegistry`、创建执行队列；
- 同时托管前端构建产物（`server/static`）并提供 SPA 回退路由；
- 桌面分发：`build.py` 作为 PyInstaller 入口，启动 uvicorn 后用 pywebview 打开桌面窗口；`harness.cmd` / `slot_harness.spec` 负责打包为 exe。

### 12\.2 API 一览

| 路由 | 说明 |
|---|---|
| `GET /api/tools/list?scenario_id=` | 列出已注册 Plugin（可按场景过滤，依据 `SCENARIO_PLUGINS`），并附 function-calling schema |
| `POST /api/tools/execute` | 同步执行一个 Plugin（ExecutionEngine 使用） |
| `POST /api/tools/execute-async` | 后台执行一个 Plugin，进度经 SSE 推送（TestData Verification 使用） |
| `POST /api/tools/upload-testdata` | 上传 .testdata 文件并落盘到真实路径 |
| `POST /api/tools/upload-folder` | 上传帮助文件（文件夹或散文件），按 `子目录/index.html` 结构落盘 |
| `GET /api/tools/skills/list` | 列出 `skills/` 目录下的 Skill 文件元数据 |
| `POST /api/executions/new` | 创建 execution 记录 |
| `GET /api/executions/mine` / `GET /api/executions/{id}` | 执行历史列表 / 执行详情（含 tool_calls 与 records） |
| `GET /api/executions/stream/{id}` | SSE 事件流（`harness_event` / `done` / `ping`） |
| `POST /api/executions/{id}/cancel` | 请求取消正在运行的浏览器类 Plugin |
| `POST /api/executions/audit-llm` | 记录 LLM 调用审计（前端当前未调用） |
| `GET /api/executions/runs/{id}/{tool}/{file}` | 下载某次执行的工作目录产物 |
| `GET/POST /api/records/...` | 测试记录批量保存、`outcome.zip` 下载、`artifacts/{file}` 产物下载 |
| `GET /healthz`、`GET /api/status` | 健康检查 |

### 12\.3 Plugin 契约与执行

- `ToolPlugin.validate()`：校验必填参数、拒绝 inputSchema 之外的参数（`unknown_param`）、做轻量类型转换并填充默认值；
- `ToolPlugin.execute()`：统一计时、捕获异常并转换为 `ToolResult(success=False, error=...)`，Plugin 只需实现 `_run_impl`；
- `ToolResult`：`success / content / error / execution_ms / artifacts`；
- `HarnessContext`：`execution_id / user_id / user_role / session_token / work_dir`，每次调用的工作目录为 `server/data/runs/{execution_id}/{tool_name}/`；
- `SerialExecutionQueue`：按用户加 asyncio 锁**串行**执行，避免多个 Selenium Chrome 互相冲突（接口预留并行队列替换）；
- `cancellation`：浏览器类 Plugin（`testdata_verifier`、`testdata_verifier_harness`、`portugal_plugin_fetcher`）获取 WebDriver 后注册强制关闭回调，供取消接口调用。

### 12\.4 数据存储

SQLite（`server/data/harness.db`）四张表：

- `executions`：一次运行（意图、阶段、状态、LLM provider/model、token 计数、耗时、错误）；
- `tool_calls`：每次 Plugin 调用（参数、成功与否、结果摘要、产物、耗时、错误）；
- `test_records`：TestData 生成的测试记录（case、格式、module、batch/index、文件名、XML 片段）；
- `llm_audit`：LLM 调用审计（当前无写入方）。

产物目录：`server/data/runs/`（按 execution 隔离的工作目录；`config.py` 定义了 `HARNESS_RUN_TTL_HOURS`，但当前没有清理逻辑使用它）、`server/data/artifacts/`（可下载报告与 ZIP）；Portugal 符号映射持久化在仓库根目录 `symbol_profiles/`。

---

## 13\. 代码现状与已知差异（新增）

以下为本次校订中发现的、代码内部或代码与规划之间尚未对齐之处。文档已按代码现状描述；是否修改代码另行决定。

| # | 现状 | 影响 |
|---|---|---|
| 1 | `game-verify-pipeline` 已声明，但 TestData Verification 实际走 `verificationEngine.ts`，且该 Pipeline 的 verify 步骤只引用 `testdata_verifier`（已不在界面提供的旧方式） | Pipeline 声明与实际执行不一致 |
| 2 | `PipelineStepDef.dependsOn` 未被执行引擎校验；`skipped` / `paused` / `idle` 状态未使用 | 仅为声明性元数据 |
| 3 | `agents/ui_log_diagnoser_agent.md` 未被任何场景引用，其中提到的 `log_diagnosis` 场景与 `log-diagnose-pipeline` 已不存在 | 孤立文件 |
| 4 | `AgentPage.tsx` 的 Agent 数据为硬编码，其中 "Planner Agent" 仍描述为"驱动对话循环与工具编排"；`PluginPage.tsx` 的 Skill 展示数据也为硬编码 | 展示内容与实际职责/文件可能不同步 |
| 5 | 前端从未调用 `auditLlm`，`llm_audit` 表与 executions 的 token 字段无数据；界面无 Token / 耗时 / 缓存统计 | 4.1 中的监控面板为规划 |
| 6 | `helpfile_analyzer` 在服务端直连 Ollama，模型默认 `qwen3:latest`，不随前端模型切换 | 唯一绕过统一网关的调用 |
| 7 | 输入框模型下拉 `MODEL_OPTIONS` 为硬编码（含 `deepseek-chat`、`claude-3-haiku` 等标签），与 Provider Preset 列表不一一对应 | 选项可能与当前 Provider 不匹配 |
| 8 | TestData Generation 的 `gamePrefix`（P5P）与默认 `moduleId`（105359）在 App.tsx 中写死；Google Sheet URL 不会被抓取 | 不同游戏需依赖文本中的 Module ID |
| 9 | 测试计划预览的勾选项除 Portugal "Save Imported Mapping" 外不影响执行；TestDataPreview 的 "Regenerate" 只重置为 mock 记录 | 交互语义弱于界面暗示 |
| 10 | `plugins/README.md`、`workflows/README.md`、`skill-generator-plugin-contract.md` 中仍提到已不存在的 `game_verifier_tool.py` / "流水线硬编码在 plannerAgent.ts" | 辅助文档过期 |

---
---

# Slot Game Testing Harness Design Doc (English Version)

> This English section is a faithful translation of the Chinese design document above. Both versions describe the same system; where the two ever appear to diverge, the Chinese version above is authoritative, since it is the working document that gets edited first.

> **Revision note (2026-10-08, full code-aligned revision)**
>
> This revision re-checks every section against the current code (baseline: `main` branch, commit `6c03e2a`) on the principle that **"the code is the source of truth"**: wherever the document and the code disagreed, the document has been rewritten to match the code; vision content that has not landed yet is kept but explicitly marked "planned / not implemented". Main changes:
>
> - Scenarios and pipelines: corrected from "2–3 scenarios" to the **4 registered scenarios / 4 pipelines** (TestData Generation, TestData Verification, EasyHelp Checking, Portugal Plugin Verification); "log diagnosis" is no longer a standalone scenario and is now part of the verification report;
> - **The TestData Verification scenario does not go through ExecutionEngine** — `verificationEngine.ts` drives one of three verification methods directly (the Titan Harness method by default), see 10.2 / 10.7;
> - The Agent / Skill / Plugin inventories were corrected to the real files (5 Agent files, 8 Skill files, 14 registered Plugins); Agents/Skills are **inlined at build time**, not hot-reloaded at runtime;
> - The model gateway section was rewritten to the real Presets (OLLAMA / OPENAI / ANTHROPIC / CUSTOM), parameters (temperature 0.3, 512-token output cap) and actual AI call sites; KV caching, automatic model selection and token/cache statistics panels are marked not implemented;
> - UI layout and directory structure rewritten to match the code; new Chapter 12 "Backend Service Architecture" and Chapter 13 "Code Status & Known Discrepancies".

## 1. Project Overview & Core Positioning

### 1.1 Project Positioning

This project is a **vertical-domain AI Agent orchestration cockpit (AI Harness) built for SLOT game testing**.

The technical positioning combines what we consider the best patterns in the field:

- **Orchestration kernel**: Absorbs the Hermes-Agent standard Harness engineering philosophy — "strong code constraints, weak AI decision-making, controllable process, traceable execution" — as the core design principle, avoiding the randomness problems of small models.

- **UI form**: Follows the TraeWork minimalist engineering desktop UI design, discarding the redundant features of general-purpose AI platforms, and focusing on efficient execution of the testing pipeline. It is currently implemented as a React + Vite frontend + FastAPI backend, usable from a browser or packaged via PyInstaller + pywebview into a single desktop exe (see Chapter 12).

- **Business scenario**: A **vertical AI workbench** purpose-built for closed-loop SLOT testing — test-data generation, test-data verification against the real game environment, help-file (EasyHelp) comparison checks, and Portugal Plugin output verification — not a general-purpose AI chat tool, and not a traditional SaaS business system.

### 1.2 Core Design Goals

- Target a 7B-scale lightweight model (local Ollama by default, default model `qwen2.5-coder:7b`, with the option to switch to a cloud model of the same or larger scale), enabling a low-cost, offline-capable, highly stable AI testing pipeline;

- Clearly define the AI's scope of responsibility: it only handles the three lightweight semantic tasks a 7B model can reliably do — **simple conversational interaction, task classification/relay (dispatch), and analysis-report generation from execution results** — and does not take on complex multi-step planning, precise numeric computation, or anything else beyond a small model's capability (in the current code, "task classification/relay" is done by deterministic code, so the AI actually handles only dialogue and reporting — see 10.7);

- Use the Harness orchestration layer + Plugin code layer as a backstop, compensating for the small model's shortcomings in planning, memory, and format adherence;

- Establish a standardized Agent/Skill/Plugin layered system so that testing capability can be accumulated, reused, and iterated on;

- Use a minimalist engineering UI that foregrounds AI orchestration, tool execution, and process traceability, sharply distinguishing it from a traditional SaaS backend.

### 1.3 Core Differentiators (unified external messaging)

Distinct from traditional SaaS systems: no plain CRUD business operations, no hard dependency on the cloud, no fixed business data tables driving the system — the core is **AI-agent orchestration and automated workflow execution**.

Distinct from general-purpose AI tools: no general office/chit-chat/creative-writing bloat — 100% focused on the SLOT game testing vertical, with a highly customized, more efficient pipeline.

---

## 2. Overall Architecture (Hermes Harness Kernel Philosophy, Implemented)

### 2.1 Architecture Philosophy (adapted for a 7B local model)

Fully follows the Hermes Harness engineering core logic: **favor code over model; favor constraint over freedom; favor process over decision-making**.

To avoid the local 7B model's short context, weak reasoning, format drift, and tendency to go off track, capability is deliberately layered and converged:

- **Mechanical, deterministic logic** (data parsing, cleaning, format standardization, file generation, comparison, process ordering): entirely pushed down into the Harness orchestration code + Plugin tool layer;

- **Intelligent semantic logic** (intent clarification, summarizing execution results, attributing failure causes): the Agent + Skill layer supplies domain context, and the model produces single-turn semantic output;

- **Process/orchestration authority**: entirely owned by the Harness code (`pipelineRegistry.ts` declarations + `ExecutionEngine` execution); the AI is never allowed to autonomously reorder or dynamically alter pipeline steps.

### 2.2 Four-Layer Architecture (standard industrial-grade AI Harness structure)

#### Layer 1: Harness Orchestration Kernel (central layer)

The system's sole commander, entirely code-hardened logic, implemented in TypeScript under the frontend's `src/harness/`:

- **Intent routing** (`intentRouter.ts`): the `SCENARIOS` registry + keyword-scored routing, no AI dependency;

- **Pipeline declarations** (`pipelineRegistry.ts`): one fixed Pipeline per scenario, with parameter mapping between steps declared via `buildParams`;

- **Execution engine** (`executionEngine.ts`): calls backend Plugins serially stage by stage, owning state transitions, failure retries, and user abort;

- **Model dispatch management**: a unified **multi-gateway model adapter layer** (`plannerProvider.ts` + `utils/llmGateway.ts`) supporting local Ollama, OpenAI-compatible, Anthropic-compatible, and custom endpoints, with one-click model-source switching and centralized parameter control (see Chapter 5);

- **End-to-end tracing**: every run creates an execution record, every Plugin call is persisted as a tool_call, and the frontend execution console shows progress live (see Chapter 12);

- **Fixed context prefix**: each scenario's Agent + Skill text is concatenated in a fixed order into that scenario's domain context, which stays constant within the scenario (this helps prefix caching on the inference side, but the code does **not** implement an explicit caching strategy or cache-hit statistics).

#### Layer 2: Agent Role Layer (domain-context layer)

Agent files are **not autonomous executors** but **read-only domain reference context** for each scenario: every file opens with an "Execution Model: execution order is decided by the Pipeline + ExecutionEngine" notice, and the model only consults the domain knowledge in it when asking clarifying questions or writing reports. The repository-root `agents/` folder currently holds 5 files:

| Agent file | Bound scenario | Status |
|---|---|---|
| `testdata_generator_agent.md` | testdata_generation | Wired in |
| `testdata_verifier_agent.md` | game_verification | Wired in |
| `helpfile_conversion_agent.md` | easyhelp_checking | Wired in |
| `portugal_plugin_verifier_agent.md` | portugal_plugin | Wired in |
| `ui_log_diagnoser_agent.md` | (former log_diagnosis scenario, retired) | **Not wired in**, file kept only |

Agent content is **inlined into the frontend bundle at build time** via Vite `?raw` (the `AGENT_CONTENT` map in `intentRouter.ts`); edits require a frontend rebuild — runtime hot-reload is not supported.

#### Layer 3: Skill Rule Layer (capability layer)

Dedicated skill manuals that fix rules and constrain AI behavior. `skills/` holds 8 files, each referenced by at least one scenario:

| Skill file | Referenced by |
|---|---|
| `skill-sheet-data-clean.md` | testdata_generation |
| `skill-generator-plugin-contract.md` | testdata_generation |
| `skill-verification-protocol.md` | game_verification |
| `skill-helpfile-conversion.md` | easyhelp_checking |
| `skill-helpfile-plugin-contract.md` | easyhelp_checking |
| `skill-portugal-plugin-symbol-map.md` | portugal_plugin |
| `skill-portugal-plugin-parsing-rules.md` | portugal_plugin |
| `skill-portugal-plugin-contract.md` | portugal_plugin |

(The originally planned `skill-task-dispatch-rule.md` was never created.) Skills are likewise inlined at build time via `?raw`; separately, the backend's `GET /api/tools/skills/list` lists file metadata from `skills/` at runtime for display.

#### Layer 4: Plugin Local Tool Layer (execution layer)

Pure-code tools, implemented in Python as `server/tools/impl/*_tool.py`, all subclassing `ToolPlugin` (MCP-compatible name / description / inputSchema), registered in `BUILTIN_TOOLS` in `server/tools/impl/__init__.py`, and loaded into `ToolRegistry` at backend startup. There are currently 14:

| Scenario | Plugins |
|---|---|
| TestData Generation | `testdata_parser` (parses pasted sheet text), `testdata_generator` (writes .testdata XML), `zip_packager` (ZIP + manifest) |
| TestData Verification | `testdata_verifier_harness` (Titan Harness launcher login + Selenium, default), `testdata_verifier_api` (direct game HTTP APIs, no browser), `testdata_verifier` (real game URL + borrowed Chrome profile + Okta, legacy), `log_diagnoser` (rule-based failure attribution) |
| EasyHelp Checking | `html_to_text_converter`, `diff_comparator` (with keyword highlighting and Excel output), `helpfile_analyzer` (calls local Ollama server-side to produce an analysis report) |
| Portugal Plugin | `portugal_plugin_symbol_map`, `portugal_plugin_fetcher` (Selenium → Game History → PlayCheck to fetch the outcome), `portugal_plugin_parser`, `portugal_plugin_reporter` (TXT/JSON/HTML reports) |

> Note: the originally planned "Google Sheet Reader Plugin (spreadsheet API connection, raw-data fetching)" is **not implemented**. TestData generation currently takes its data from sheet rows the user **pastes** into the input box, or a local text/CSV file attached via "+" (read in the browser and folded into the input box); a Google Sheet URL in the input box is only used for scenario/URL-type validation and is never fetched.

---

## 3. Core Workflow Pipeline (fixed closed loop)

The entire flow is fixed-orchestrated by Harness code, with no AI autonomous decision steps. All scenarios that go through ExecutionEngine share the same run path:

**User picks a scenario (or keyword auto-routing) → enters the task / attaches files → clicks ▲ to see and confirm the test-plan preview → code checks required inputs (if one is missing, the AI asks one clarifying question) → an execution record is created → ExecutionEngine calls backend Plugins stage by stage per the Pipeline → artifacts written to disk, logs and tool calls persisted → results shown in the UI → the AI writes a short summary of the last step's result (async, does not hold up the completed state)**

The actual fixed flow per scenario:

| Scenario | Driven by | Fixed steps |
|---|---|---|
| TestData Generation | ExecutionEngine | `testdata_parser` → `testdata_generator` → `zip_packager` |
| EasyHelp Checking | ExecutionEngine | `html_to_text_converter` → `diff_comparator` → `helpfile_analyzer` |
| Portugal Plugin Verification | ExecutionEngine | `portugal_plugin_symbol_map` → `portugal_plugin_fetcher` (pass-through in paste mode) → `portugal_plugin_parser` → `portugal_plugin_reporter` |
| TestData Verification | `verificationEngine.ts` directly (**not** ExecutionEngine) | One selected verifier Plugin (async execution + live SSE progress) → AI diagnosis when there are failed cases (falls back to `log_diagnoser` on failure) |

Every process step, execution order, and exception fallback is code-hardened; the AI only takes on lightweight semantic work.

---

## 4. UI Design Spec (TraeWork minimalist engineering style)

Fully aligned with the TraeWork desktop Harness minimalist design, discarding WorkBuddy-style general-purpose bloat, tailored to the SLOT-specific testing scenario, visually distinct from traditional SaaS at every level.

### 4.1 Overall Layout (as implemented)

The Workbench is a "header + three columns + bottom status bar" layout:

- **Header**: workflow stage and state, mute toggle, model-management entry, reset workflow.

- **Left: resource navigation panel (Sidebar)** (a pure AI-resource system, no business menus)
    - **Plugin** / **Agents** / **History** entries, opening the plugins-and-skills page, the Agent detail page, and the execution history page;
    - **Scenarios** selector: lists every scenario in `SCENARIOS` for explicit selection;
    - **Task List**: the current scenario's fixed steps, with status updated live from ExecutionEngine callbacks;
    - No permission management, no user roles, no business-data menus.

- **Middle: conversational execution area**
    - **Execution console (ExecutionConsole)**: a chat-style timeline with two tabs — COT (event/dialogue stream) and RAW_TOOLS (raw tool calls and results) — with folding of earlier rounds;
    - **AI clarify panel**: appears when a required input is missing; one question, one answer;
    - **Test-plan preview panel**: shown after clicking ▲, listing the scenario's test items for confirmation (ticking currently only serves as confirmation; the one item that affects execution is the Portugal scenario's "Save Imported Mapping"); in TestData Verification, this is where files and the verification method are chosen and the required credentials entered;
    - **Input box (pinned at the bottom)**: automatically splits the first URL out of the text; Enter chats with the AI, Shift+Enter inserts a newline, ▲ submits the test task; a "+" attach menu (Add file(s) / Add folder, picker depends on the scenario); a model drop-down on the right.

- **Right: pipeline and artifacts**
    - **PipelineVisualization**: a generic 5-stage progress bar (Intent → Generate → Review → Verify → Complete) reflecting the workflow stage rather than the specific Pipeline steps;
    - **TestDataPreview**: shown only after TestData Generation completes, with XML preview and ZIP download.

- **Standalone pages**: model management (LlmConfigPage — multi-model config store and connectivity test), Plugin (backend tool list + skill list), Agents, History (past executions; verification reports can be reopened).

- **Bottom status bar**: HARNESS v2, current scenario name, workflow state.

> UI capabilities that are planned but **not yet implemented**: single-step debugging; a panel for model-inference token usage / latency / cache-hit statistics (the backend already has the `llm_audit` table and the `/api/executions/audit-llm` endpoint, but the frontend never calls it).

> **Login note**: Harness itself has **no login** — open it and use it. `require_user()` in `server/infra/security.py` always returns the fixed local user `LOCAL_USER`, with no password or session check; the earlier `auth_router.py` account system has been deleted. Harness login and the real game/admin environment's login are two unconnected systems, so the early assumption that "logging into Harness spares you from logging into the game environment" did not hold, and the login was removed.
>
> Logging into the game environment is now handled by the verification method itself (see the addendum under Module Three in 10.2): the default **Harness method** logs in through the QA-only Titan Harness launcher form (shared test password, no Okta/MFA), with testdata uploaded directly via an Axiom API Key; the **API method** needs the tester to paste an Okta access_token and an Axiom API Key; the earlier **Selenium method** (borrowing the tester's own logged-in Chrome profile + interactive Okta) is no longer offered in the UI, and its backend tool is kept only so history reports can be reopened.

### 4.2 Visual & Interaction Spec

- Minimalist engineering style: dark theme, large corner radii, soft shadows, low-saturation tech color palette, no redundant decoration;

- Foregrounds the four AI-Harness-exclusive modules: "workflow, AI reasoning, tool execution, trace logs";

- Removes all traditional SaaS-style dense forms, bulk operations, data filters, and plain CRUD components;

- Comes with AI-specific loading animations, node-transition animations, and a step-completion chime (mutable).

---

## 5. Model Adaptation Strategy (unified multi-gateway design, local 7B as the primary workhorse)

The essence of the model strategy is "a unified gateway with multiple sources": the local 7B model is the current primary and default option; cloud/other Providers are capability reserved for extension, and switching Provider does not change the AI's scope of responsibility.

### 5.1 Gateway Implementation & Provider Presets

The frontend's unified gateway is `src/utils/llmGateway.ts` (`streamUniversalLlmChat` for streaming calls + `testLlmConnection` for connectivity tests), wrapped by `plannerProvider.ts` as a `PlannerProvider`. Current Presets:

| Preset | Default URL | Default models | Compliance flag |
|---|---|---|---|
| `OLLAMA` | `http://localhost:11434` | `qwen2.5-coder:7b`, `deepseek-r1:8b`, `qwen3-vl:8b`, `qwen3:latest` | None (default · compliant) |
| `OPENAI` | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, etc. | ⚠️ external service |
| `ANTHROPIC` | `https://api.anthropic.com/v1` | `claude-3-5-sonnet` / `haiku` | ⚠️ external service |
| `CUSTOM` | `http://localhost:8000/v1` | custom (OpenAI-compatible protocol, e.g. vLLM) | ⚠️ external service |

- There is no dedicated DeepSeek Preset; DeepSeek and other OpenAI-compatible services connect through `OPENAI` / `CUSTOM` by setting the Base URL;
- Running a pipeline with a compliance-flagged Provider prints a compliance warning in the execution console; API Keys are stored only in browser localStorage;
- Model configuration (the multi-model list and the active model) lives in browser localStorage (`slot_harness_llm_config` / `slot_harness_llm_models`) and is maintained on the model-management page;
- Adding a new Provider type means adding an entry to `LlmProviderType` and `PROVIDER_PRESETS` and handling its protocol in `streamUniversalLlmChat` (current protocol branches: Ollama `/api/chat`, Anthropic `/v1/messages`, everything else as OpenAI `chat/completions`).

### 5.2 Unified Parameter Constraints

- Every gateway call shares `HARNESS_LLM_TEMPERATURE = 0.3` and `HARNESS_LLM_MAX_OUTPUT_TOKENS = 512`; Ollama calls also send `keep_alive: "30m"` to reduce cold starts;
- Every call is **single-turn with no tool calling (no function calling)**;
- The code does not enforce a JSON output format (no Ollama `format: json` or similar constraint); calls that need structured output (verification diagnosis) give a JSON template in the prompt, and the code parses the result tolerantly (see 11.4);
- For pure small-talk messages (`isCasualChatMessage`: greetings/thanks etc. of ≤20 characters), a few-sentence lite System Prompt (`getScenarioLiteSystemPrompt`) is used instead, so a small local model doesn't have to re-process several KB of Agent+Skill context just to answer "hello".

### 5.3 Actual AI Call Sites

| Call site | Location | Model source | Purpose |
|---|---|---|---|
| `PlannerAgent.clarify()` | Frontend | Active model (gateway) | One clarifying question when a required input is missing; Enter-key simple dialogue |
| `PlannerAgent.summarizeStepResult()` | Frontend | Active model (gateway) | 3–6 sentence summary of the last step's result after the pipeline completes |
| `runAIDiagnosis()` | Frontend `verificationEngine.ts` | Config saved in localStorage (gateway) | Root-cause diagnosis of failed verification cases (JSON) |
| `helpfile_analyzer` Plugin | Backend Python | **Direct Ollama call** (default `http://localhost:11434`, `qwen3:latest`, temperature 0.3), bypassing the frontend gateway | EasyHelp analysis report |

### 5.4 Why a Multi-Gateway Design Instead of Hardcoding Two Providers

- **Built for future extensibility, not a current necessity**: the current 4 fixed pipelines are covered by the local 7B model; the point of the multi-gateway design is so that changing the model source in the future, or plugging in a customer's own model API, requires no rework of the Harness;

- **Architectural decoupling**: a change in model source only affects the Provider adaptation layer, and has no effect on intent routing, pipeline definitions, the execution engine, or Agent/Skill content — consistent with the "complete decoupling between layers" extensibility principle in Chapter 9 (`helpfile_analyzer`'s direct server-side call is currently the one exception);

- **Not general-purpose bloat**: a multi-gateway design does not mean introducing general-purpose AI chat/office capability — after a Provider switch, the AI's scope of responsibility stays the same, so this does not violate the "not a general-purpose AI tool" positioning stated in section 1.3.

---

## 6. Directory Structure (actual code)

```Plain Text
slotgame-testing-harness/
├── agents/                    # Agent domain-reference context (inlined at build time via ?raw)
│   ├── testdata_generator_agent.md
│   ├── testdata_verifier_agent.md
│   ├── helpfile_conversion_agent.md
│   ├── portugal_plugin_verifier_agent.md
│   └── ui_log_diagnoser_agent.md          # not wired into any scenario
├── skills/                    # Skill rule manuals (8 files, see 2.2)
├── symbol_profiles/           # Stored Portugal Plugin symbol maps (e.g. ADPC.json)
├── plugins/README.md          # Reserved directory, docs only; real plugins live in server/tools/impl/
├── workflows/README.md        # Reserved directory, docs only; real pipelines live in src/harness/pipelineRegistry.ts
├── src/                       # Frontend: React + Vite + Tailwind
│   ├── harness/               # Harness orchestration kernel (TypeScript)
│   │   ├── intentRouter.ts        # scenario registry + keyword routing + scenario context assembly
│   │   ├── pipelineRegistry.ts    # declarative definitions of the 4 pipelines
│   │   ├── executionEngine.ts     # execution engine (serial stages, retry, abort)
│   │   ├── plannerAgent.ts        # narrowed semantic helper (clarify / summarizeStepResult)
│   │   ├── plannerProvider.ts     # LLM Provider adapter
│   │   ├── client.ts              # backend API client (incl. SSE)
│   │   └── sharedTypes.ts         # shared frontend/backend types
│   ├── utils/
│   │   ├── llmGateway.ts          # multi-Provider gateway
│   │   ├── verificationEngine.ts  # TestData Verification driver + AI diagnosis
│   │   ├── logVisionDiagnoser.ts  # rule-based per-case diagnosis in the verification report modal
│   │   ├── paytableSheetParser.ts # paytable parsing for frontend mock data
│   │   └── zipGenerator.ts        # frontend ZIP generation (TestDataPreview download)
│   ├── components/            # Header / Sidebar / ExecutionConsole / PipelineVisualization / TestDataPreview / VerificationReportModal / LlmConfigModal / XmlViewer
│   ├── pages/                 # LlmConfigPage / PluginPage / AgentPage / HistoryPage
│   └── App.tsx                # Workbench: scenario state, parameter assembly, run entry points
├── server/                    # Backend: FastAPI
│   ├── main.py                # app entry, SSE hub, static file hosting
│   ├── config.py              # port, CORS, data dir (server/data/)
│   ├── api/                   # tools_router / executions_router / records_router
│   ├── services/execution_queue.py  # serial execution queue
│   ├── infra/                 # storage (SQLite) / security / cancellation / process_runner / logger
│   └── tools/                 # base.py (ToolPlugin / ToolRegistry) + impl/ (14 Plugins)
├── build.py / slot_harness.spec / harness.cmd   # PyInstaller + pywebview desktop packaging
└── generate_testdata.py / verify_testdata.py    # standalone CLI scripts
```

> The original design-intent layout from project kick-off (`agents/agent-sheet-reader.md`, `plugins/google_sheet_reader.py`, `workflows/slot-test-pipeline.yaml`, `harness/scheduler.py`, etc.) did not land as drawn: the orchestration kernel is TypeScript in `src/harness/`, Plugins are Python in `server/tools/impl/`, and pipelines are declared in TypeScript in `pipelineRegistry.ts` (YAML pipeline configuration is a planned capability). The four-layer decoupling philosophy is unchanged.

---

## 7. Summary of Core Advantages (for reporting, review, and archival)

1. **Advanced architecture**: absorbs the Hermes standard Harness engineering kernel, using constrained orchestration to solve the small-model deployment problem, distinct from ordinary Agent frameworks;

2. **Vertical scenario focus**: purpose-built for SLOT game testing with no general-purpose bloat, giving far higher execution efficiency than a general-purpose AI platform;

3. **Authentic form factor**: adopts the TraeWork minimalist engineering desktop UI, a three-column AI-exclusive layout, entirely avoiding a traditional-SaaS look and feel;

4. **Multi-gateway compatibility**: the local 7B model for free debugging as the mainstay, with OpenAI-compatible / Anthropic-compatible / custom endpoints as a supplement — one architecture for the whole R&D lifecycle, with room reserved for future expansion;

5. **Engineering that accumulates**: Agent/Skill/Plugin layered decoupling means testing capability can be reused, iterated, and standardized.

---

## 8. Final Project Positioning (official standard messaging)

This system is a **vertical-domain AI agent orchestration cockpit that absorbs the Hermes Harness orchestration-kernel philosophy, adopts the TraeWork minimalist engineering desktop UI, and is purpose-built for SLOT game testing**. Built on layered Agents, standardized Skill rules, local Plugin tools, and a constraint-based Harness orchestration engine, it uses a 7B-scale model (local Ollama as the mainstay, multi-gateway cloud Providers as an extension) to reliably handle lightweight semantic tasks such as simple dialogue and analysis-report generation, while pre-designed fixed workflows (Agent+Skill+Plugin combinations) drive closed testing loops — test-data generation, test-data verification in the real environment, help-file comparison, and Portugal Plugin output verification. It is a lightweight, highly focused, engineering-grade vertical AI testing workbench, distinct from general-purpose AI office tools and traditional SaaS business systems.

---

## 9. Future Extensibility Design (system iteration roadmap)

This Slot Game Testing Harness architecture **supports horizontal extension, pluggable capabilities, and scenario iteration** — it is not limited to "TestData generation and verification". Having already grown from the original generation/verification flows to 4 scenarios including EasyHelp checking and Portugal Plugin verification is practical proof of that.

This chapter explains: **how to add plugins, Agent skills, test pipelines, and business modules**.

### 9.1 Core Extensibility Principle: The Four-Layer Architecture Supports Pluggable Iteration

- **Harness orchestration layer**: a new scenario = one new Scenario + one new Pipeline declaration; the execution engine code needs no change;

- **Agent role layer**: add a scenario-specific domain-reference file without affecting other scenarios;

- **Skill layer**: skill files stack and can be reused by multiple scenarios;

- **Plugin tool layer**: a new tool registered in `ToolRegistry` can be called by any pipeline.

👉 **Extension is mostly "incremental stacking", and existing stable functionality is unaffected**; however, several hardcoded lists still need manual syncing today (see the steps in 9.2 / 9.3 and Chapter 13).

### 9.2 Plugin Expansion (the core expansion method)

14 Plugins have landed so far (see 2.2). SLOT-specific plugin directions for the future:

- **SLOT numeric-validation plugin**: multiplier validation, probability validation, compliance checks on random-value distributions;
- **Level/storyline test plugin**: batch generation and validity verification of multi-scenario storyline data;
- **Exception test-case generation plugin**: automatic construction of boundary values, illegal parameters, and exceptional scenarios;
- **Automated report export plugin**: test coverage, data-compliance reports, batch-execution reports;
- **Version-comparison plugin**: diffing test data between old and new versions, identifying change risk.

**Actual steps**:

1. Create `xxx_tool.py` in `server/tools/impl/`, subclass `ToolPlugin`, declare `info` (name / description / inputSchema) and implement `_run_impl`;
2. Register it in `BUILTIN_TOOLS` in `server/tools/impl/__init__.py` (it is loaded into `ToolRegistry` at backend startup and listed by `/api/tools/list`);
3. If it belongs to a scenario, add it to `SCENARIO_PLUGINS` in `server/api/tools_router.py` and to that scenario's `requiredPlugins` in `intentRouter.ts`;
4. Reference it as a step in `pipelineRegistry.ts`, declaring its input mapping with `buildParams`;
5. If it runs long and should be interruptible by the Stop button, call `server/infra/cancellation.register()` with a teardown callback after acquiring the resource (e.g. a WebDriver).

> Note: the frontend execution engine only appends the `__execution_id` metadata key; `ToolPlugin.validate()` rejects any parameter outside the inputSchema as `unknown_param`.

### 9.3 Agent Role Expansion

Possible domain-context directions: validation review, scenario decomposition, risk inspection, report summarization, etc. All Agents keep the "read-only domain context, never drives execution" model.

**Actual steps**: add a `.md` file to `agents/` → import it in `intentRouter.ts` with `?raw` and add it to `AGENT_CONTENT` (keyed by scenario id) → rebuild the frontend. The Agent detail page (`AgentPage.tsx`) shows hardcoded data that must be maintained by hand. ("Add an .md and Harness auto-loads it and the frontend auto-displays it" is a planned goal, not implemented today.)

### 9.4 Continued Accumulation of the Skill Library (capability as an asset)

Directions to keep accumulating: SLOT probability-compliance judgment, multiplier-overflow validation, special-feature data validation, boundary-scenario identification, etc.

**Actual steps**: add an `.md` to `skills/` → import it in `intentRouter.ts` with `?raw` and add it to `SKILL_CONTENT` (keyed by filename) → reference it in the scenario's `skills` array → sync the `HARDCODED_SKILLS` display data in `PluginPage.tsx`.

### 9.5 Workflow/Pipeline Expansion (multiple scenario pipelines)

There are already 4 independent pipelines (see Chapter 3). Further possibilities:

- Quick smoke-test pipeline (lightweight, very fast validation)
- Full batch regression-test pipeline (large-scale production)
- Exception-scenario special-test pipeline
- Version-iteration comparison-test pipeline

**Actual steps**: add a PipelineDef in `pipelineRegistry.ts` → add a TestScenario (with keywords) in `intentRouter.ts` → in `App.tsx`, add the scenario's `STAGE1_TASKS` (task list), `SCENARIO_TEST_ITEMS` (test-plan preview items), `checkMissingField` (required-input check, optional), and its `extraParams` assembly in `runPipeline` → `SCENARIO_PLUGINS` in `tools_router.py`.

The frontend already supports switching between pipelines (the Sidebar scenario selector); each run's logs are grouped by round in the execution console, and the backend isolates working directories by execution_id.

### 9.6 UI Expansion Capability

- The left scenario selector automatically lists new scenarios added to `SCENARIOS`; the Agent/Skill display pages currently need manual syncing;
- The middle conversation area and the "+" attach menu switch behavior per scenario, and can gain branches for new scenarios;
- The right column can gain dedicated panels (validation statistics, coverage statistics, risk statistics, etc. — planned).

The UI needs no rework, only incremental modules — it always stays minimal and efficient and never turns into bloated SaaS.

### 9.7 Model Capability Expansion

- Seamless future upgrades to 14B/32B local models (just switch on the model-management page);
- Connecting multiple cloud models; automatic best-fit selection by task complexity is a planned capability (see 11.5);
- Model fine-tuning integration to keep optimizing SLOT-specific capability (planned).

### 9.8 Final Expansion Conclusion (for external reporting)

This Slot Game Testing Harness is **not a one-off fixed tool, but a continuously growing AI testing engineering system**.

Four closed loops — test-data generation, real-environment verification, help-file comparison, and Portugal Plugin verification — are already complete. Building on the Hermes-style layered, constrained architecture and plugin-based design, it can be extended **at low cost, incrementally** into a full SLOT game AI test-automation platform covering "data generation, intelligent validation, exception testing, regression testing, risk inspection, and automated reporting".

---

## 10. HARNESS Framework Extension Design (multi-scenario pipeline architecture)

### 10.1 Architecture Evolution

The early HARNESS used a **single, hardcoded pipeline** (`user input → PlannerAgent(stage1) → testdata_parser → testdata_generator → zip_packager`, with PlannerAgent driving tool calls); adding a scenario required changing code, prompts, and the frontend stage enum.

That model **has been upgraded**: the current multi-scenario architecture consists of the intent router + pipeline registry + execution engine, and PlannerAgent has been narrowed to a semantic helper that plays no part in flow control. The sections below describe the current code.

### 10.2 The Three Core HARNESS Modules

#### Module One: Intent Router (`intentRouter.ts`)

**Responsibility**: maintain the scenario registry; keyword-match the user's natural language; assemble each scenario's Agent + Skill domain context.

```typescript
interface TestScenario {
  id: string;                    // Unique scenario identifier
  label: string;                 // Display name in the frontend
  description: string;           // Scenario description (also used in the lite System Prompt)
  keywords: string[];            // Keyword-matching rules
  agentFile: string;             // Corresponding Agent .md file
  skills: string[];              // List of required Skill files
  pipelineId: string;            // Pipeline ID
  requiredPlugins: string[];     // List of Plugin dependencies
  icon: "zap" | "shield" | "bug" | "file-text" | "globe";
}
```

The 4 registered scenarios:

| id | label | pipelineId | requiredPlugins |
|---|---|---|---|
| `testdata_generation` | TestData Generation | `testdata-gen-pipeline` | testdata_parser, testdata_generator, zip_packager |
| `game_verification` | TestData Verification | `game-verify-pipeline` | testdata_verifier, testdata_verifier_api, testdata_verifier_harness, log_diagnoser |
| `easyhelp_checking` | EasyHelp Checking | `helpfile-conversion-pipeline` | html_to_text_converter, diff_comparator, helpfile_analyzer |
| `portugal_plugin` | Portugal Plugin Verification | `portugal-plugin-verify-pipeline` | portugal_plugin_symbol_map, portugal_plugin_fetcher, portugal_plugin_parser, portugal_plugin_reporter |

**Routing strategy** (no AI dependency):

- The user's explicit selection in the Sidebar is primary;
- On clicking ▲, `routeIntent()` keyword-scores the input: each matched keyword scores `length × 10`, multi-word keywords (containing a space/underscore) are doubled, and a keyword at the start of the input (position ≤ 3) gets +20;
- The scenario is switched automatically only when the top-scoring scenario differs from the current selection **and scores > 100**; the matched keywords and score are logged to the console, so a misjudgment can't silently override the user's choice.

**Context assembly**: `getScenarioSystemPrompt()` concatenates "Agent role & domain rules (reference only, not tool-calling instructions) → Skill rules (must follow strictly)"; this context is used only by PlannerAgent's `clarify` / `summarizeStepResult` and is not a tool-calling System Prompt.

#### Module Two: Pipeline Orchestrator (Pipeline Registry, `pipelineRegistry.ts`)

**Responsibility**: declaratively define each scenario's steps, retry policy, and **parameter mapping between steps**.

```typescript
interface PipelineParamContext {
  extraParams: Record<string, unknown>;   // Kickoff params (assembled by App.tsx from UI state)
  stepResults: Record<string, unknown>;   // result.content of each earlier successful step, keyed by stepId
}

interface PipelineStepDef {
  id: string;
  plugin: string;              // Name of the Plugin to call
  label: string;               // Display name in the frontend
  description?: string;
  dependsOn: string[];         // Prerequisite steps (declarative, see note below)
  retryOnFail: boolean;        // Whether to retry on failure
  maxRetries: number;
  buildParams?: (ctx: PipelineParamContext) => Record<string, unknown>;  // input mapping
}

interface PipelineDef {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStepDef[][];  // 2D array: outer = stages (serial), inner = steps within a stage
}
```

The 4 current pipelines (the `PIPELINES` array):

| Pipeline | Steps (plugin, retries) |
|---|---|
| `testdata-gen-pipeline` | parse (testdata_parser, 2 retries) → generate (testdata_generator, 2 retries) → package (zip_packager, no retry) |
| `game-verify-pipeline` | verify (testdata_verifier, no retry) → diagnose (log_diagnoser, no retry) — **declared but not currently invoked**, see the addendum under Module Three |
| `helpfile-conversion-pipeline` | convert (html_to_text_converter, 1 retry) → compare (diff_comparator) → analyze (helpfile_analyzer) |
| `portugal-plugin-verify-pipeline` | resolve_symbol_map → fetch_portugal_plugin → parse_portugal_plugin → report_portugal_plugin (no retries) |

`buildParams` is the key to "the AI does not decide parameters": e.g. the generate step takes `stepResults.parse.records`, and the Portugal parse step uses the `symbol_map` resolved in stage 0 directly. A step without `buildParams` falls back to passing `extraParams` through unchanged.

> Note: outer stages run strictly serially; **steps within a stage also run serially in declared order** — intra-stage parallelism is reserved (every stage currently holds a single step). `dependsOn` is currently declarative metadata only; the execution engine **does not check dependencies** — ordering is guaranteed by stage sequence.

#### Module Three: Execution Engine + State Machine (`executionEngine.ts`)

**Responsibility**: execute step by step per the pipeline definition, manage state transitions, and handle failures and aborts.

```
Execution engine (code-controlled, no AI involvement):
  initialize context: every step = pending, pipeline = running
  for each stage in pipeline.stages:
    for each step in stage:                    # serial
      for attempt in 1..(retryOnFail ? maxRetries+1 : 1):
        status = running / retrying
        params = step.buildParams(extraParams, stepResults) + { __execution_id }
        result = POST /api/tools/execute { tool_name: step.plugin, params }
        success → status = success, stepResults[step.id] = result.content, next step
        failure → retry if attempts remain, otherwise status = failed
    any failed step in the stage → pipeline = failed, stop
  all done → pipeline = completed
  AbortSignal fired → pipeline = aborted
```

- Step states: `pending / running / retrying / success / failed` (the type also has `skipped`, currently unused); pipeline states: `running / completed / failed / aborted` (the type also has `idle / paused`, currently unused);
- `EngineCallbacks` (onStepChange / onStepComplete / onStepFail / onStatusChange / onLog) mirror progress into the task list and the execution console;
- **Stop**: the frontend AbortController stops further steps; for a browser-driven Plugin still running on the backend (`portugal_plugin_fetcher`, etc.), the frontend also calls `POST /api/executions/{id}/cancel`, and the backend cancellation registry force-closes the WebDriver.

**Where the AI sits in a pipeline run** (orchestrated by App.tsx, always outside the engine):

- Before the run: code checks required inputs (`checkMissingField`); if one is missing, `PlannerAgent.clarify()` produces **one** clarifying question, the user's answer is written by code directly into the matching field (not reinterpreted by the AI), then the pipeline runs;
- After the run: the pipeline's completed state takes effect immediately, then `summarizeStepResult()` is called **asynchronously and non-blocking** to summarize the last step's result; if the LLM is unavailable, only a warning is logged.

**Addendum: the TestData Verification execution path**

This scenario **does not go through ExecutionEngine**; `game-verify-pipeline` is declared but never invoked. The actual path (`App.tsx` → `runRealGameVerification` in `utils/verificationEngine.ts`):

1. The user uploads .testdata files or a folder via "+" (persisted by the backend's `/api/tools/upload-testdata`), then picks files and a verification method and enters credentials in the test-plan preview panel;
2. **One** Plugin is chosen by method: `harness` (default) → `testdata_verifier_harness`, needing the Titan Harness launcher URL, an Axiom API Key, Product Id and Client Id (Brand optional), with Username / Module Id derived from the testdata file's `<Key>`; `api` → `testdata_verifier_api`, needing an Okta access_token and an Axiom API Key, no screenshots; `selenium` → `testdata_verifier`, no longer offered in the UI;
3. `POST /api/tools/execute-async` runs it in the background; the frontend receives per-case progress live over SSE (`/api/executions/stream/{id}`), then reads the execution detail and builds the verification report;
4. If any case failed, `runAIDiagnosis()` is called: the LLM outputs a diagnosis following the JSON template in the prompt; if the call throws, it falls back to calling the `log_diagnoser` Plugin for rule-based diagnosis;
5. The report is shown in VerificationReportModal (which also has the frontend rule-based per-case diagnosis `logVisionDiagnoser.ts`) and can be reopened from the History page.

### 10.3 Full Example of Adding a New Test Scenario: Translation File Verification (an architectural-extensibility example, not a currently implemented scenario)

> Note: "translation file verification" here is a **hypothetical example** illustrating the upper bound of the architecture's extensibility. The code contains no such scenario, no corresponding Agent/Skill, and no `file_scanner` / `translation_checker` / `report_generator` Plugins.

**User requirement**: "Verify whether the game name Phoenix5 is translated correctly across 33 translation files"

```
┌─ HARNESS Intent Router ─────────────────────────────
│  Matches keyword "translation" → scenario: translation_verification  │
│  Loads Agent: translation_verifier_agent.md          │
│  Loads Skill: skill-translation-check.md             │
│  Loads Pipeline: translation-verify-pipeline         │
│  Checks Plugins: file_scanner, translation_checker     │
──────────────────────────────────────────────────┘
         ↓
┌─ Pipeline Execution ─────────────────────────────────────
│  Stage 1: file_scanner                            │
│    → Scan the 33 translation files in the target directory                      │
│    → Extract the translated text corresponding to "Phoenix5" in each file          │
│    → Output: [{file: "zh-CN.json", value: "凤凰5"},  │
│             {file: "ja-JP.json", value: "フェニックス5"}, ...] │
│                                                    │
│  Stage 2: translation_checker                      │
│    → AI judges whether each translation is reasonable (semantic validation)               │
│    → Checks terminology consistency and format compliance                       │
│    → Output: pass/fail + reason                        │
│                                                    │
│  Stage 3: report_generator                         │
│    → Aggregates results, generates a diff report                           │
│    → Output: JSON report + frontend visualization                     │
└──────────────────────────────────────────────────┘
```

Following the actual steps in 9.5, landing this scenario would require: 3 new Plugins, 1 Agent file, 1 Skill file, 1 PipelineDef, 1 TestScenario, plus the scenario's task list, test-plan items and parameter assembly in App.tsx.

### 10.4 Frontend Adaptation (as implemented)

The left navigation panel has been upgraded to include a **scenario selector**:

```
Sidebar:
├── Plugin        → plugins & skills page
├── Agents        → Agent detail page
├── History       → execution history page
├── Scenarios
│   ├── TestData Generation
│   ├── TestData Verification
│   ├── EasyHelp Checking
│   └── Portugal Plugin Verification
└── Task List     → current scenario's fixed steps and live status
```

The user picks a scenario first, then enters a task description / attaches files. HARNESS uses the scenario to decide the input-box hint text, the "+" attach behavior, the test-plan items, parameter assembly, and which Pipeline runs.

### 10.5 HARNESS Directory Structure

```
src/harness/
├── intentRouter.ts        # Scenario registry + intent routing + scenario context assembly
├── pipelineRegistry.ts    # Pipeline definitions (declarative, with buildParams)
├── executionEngine.ts     # Execution engine (state machine + step scheduling + retry + abort)
├── plannerAgent.ts        # AI semantic helper (clarify / summarizeStepResult, no flow control)
├── plannerProvider.ts     # LLM call adapter
├── client.ts              # Backend API client (REST + SSE)
└── sharedTypes.ts         # Type definitions
```

### 10.6 Key Design Principles

| Principle | Description | Current status |
|------|------|------|
| **Scenario-driven, not process-driven** | User picks a scenario → HARNESS assembles Agent+Skill+Pipeline+Plugin automatically | In place |
| **Declarative pipeline definitions** | A new test type = one definition in `pipelineRegistry.ts` + its Plugin, no engine changes | Engine needs no change; App.tsx still needs scenario-specific parameter assembly and UI lists |
| **AI does semantics only; code does the process** | `ExecutionEngine` hard-controls the flow; the AI never decides "which tool to call next" | In place; every LLM call is single-turn with no tool calling |
| **Plug-and-play Plugins** | Each new test capability = one Plugin file, registered in `ToolRegistry`, callable by any pipeline | In place |
| **Configuration-driven Agents/Skills** | A new scenario only needs new `.md` files, no code changes | Partially: must be imported in `intentRouter.ts` and the frontend rebuilt |

### 10.7 Clarification of the Current Workflow Scope (fixed-workflow-driven, not AI-autonomous orchestration)

**Actual current scope**: the project covers **4 fixed test scenarios** — TestData Generation, TestData Verification, EasyHelp Checking, and Portugal Plugin Verification. Each scenario maps to a **pre-designed fixed flow**, decided before the run, not improvised by the AI. The former "log diagnosis" is no longer a standalone scenario; failure diagnosis runs automatically as part of the verification report.

**Key clarifications about the execution model**:

- Orchestration authority lives in code: three scenarios are executed by ExecutionEngine per their Pipeline declarations; TestData Verification is executed in a fixed order by `verificationEngine.ts`. The AI **does not take part in deciding "which tool to call next"**, nor does it decide Plugin inputs;

- How the AI's (7B model's) three responsibilities are realized in code:
  1. **Simple conversational interaction** — implemented: single-turn chat via the Enter key in the input box; one clarifying question when a required input is missing (`PlannerAgent.clarify`);
  2. **Task classification and relay** — handled by deterministic code: scenario routing is keyword scoring, and data classification/grouping is done by rules inside each Plugin (e.g. testdata_parser groups files by rule); no model is called for this today;
  3. **Analysis-report generation** — implemented: the post-pipeline step-result summary (`summarizeStepResult`), AI diagnosis of failed verification cases (`runAIDiagnosis`), and the EasyHelp analysis report (`helpfile_analyzer` calling Ollama server-side);

- The additional pipelines in section 9.5 and the "translation file verification" in section 10.3 are **architectural-extensibility examples for the future**, not implemented features.

---

## 11. Local/Cloud AI Model (7B-scale) Functional Positioning & Usage Spec

### 11.1 7B Model Capability Boundaries

| Does well | Does poorly |
|--------|--------|
| Understanding the meaning of a passage of natural language | Remembering long context (easily loses track beyond ~4K tokens) |
| Judging whether text A and text B are semantically consistent | Complex multi-step logical reasoning |
| Producing JSON from a fixed template | Keeping format when allowed to free-form |
| Extracting structured information from text | Math, precise numeric comparison |
| Spotting obvious translation errors | Subtle cultural-context differences |

**Core positioning**: the 7B model is HARNESS's "semantic sensor" — responsible for looking and listening (semantic understanding), while the "hands, feet, and brain" (process control, decision-making, execution) are entirely code. For this project's real scenarios, the 7B model's role converges further to three concrete tasks (consistent with sections 1.2 and 10.7):

1. **Simple conversational interaction**: understanding the user's natural-language intent and clarifying missing parameters, with no complex multi-turn reasoning;
2. **Task classification & relay**: deciding which category a piece of data/result belongs to (currently handled by code rules; kept as a responsibility the model could take on);
3. **Analysis-report generation**: turning a Plugin's structured execution results into concise analysis/diagnostic text.

Any work beyond these three categories (e.g. precise numeric computation, autonomous multi-step planning) is pushed down to the code layer and never left to the model's judgment.

### 11.2 The AI's Specific Responsibility at Each Step

#### Scenario 1: TestData Generation (implemented)

```
┌─ Code layer (ExecutionEngine + Plugins) ────────────────┐
│  0. Input: sheet rows pasted by the user / text or CSV attached via "+"  │
│     (Google Sheet URLs are not fetched)                    │
│  1. testdata_parser:                                 │
│     - Regex-extract Module ID: /Module\s*ID\s*#?:?\s*(\d+)/i │
│       (falls back to 105359 when absent)              │
│     - Clean batch,index pairs, recognize case names and Bet Lines ID │
│     - Group files by rule (file prefix defaults to P5P) │
│  2. testdata_generator: generate .testdata XML        │
│  3. zip_packager: package ZIP + manifest.json         │
└────────────────────────────────────────────────────┘
         ↑ All of this is code; the AI is not involved

┌─ AI layer (7B model) ──────────────────────────────────┐
│  Before the run (only when the input has no "number,number" rows): │
│    clarify → one-sentence clarifying question asking for sheet rows │
│  After the run (async, non-blocking):                  │
│    summarizeStepResult → 3–6 sentence summary of the package step's result │
└────────────────────────────────────────────────────┘
```

**AI share: well under 10%**. Data parsing, classification and generation are all done by code; the early ideas of "the AI decides which category a row belongs to" and "the AI checks whether a batch is abnormally large" were not implemented — classification is done by testdata_parser's rules.

#### Scenario 2: Translation File Verification (architectural example, not implemented — see 10.3 / 10.7)

```
┌─ Code layer (HARNESS execution engine) ─────────────────────────┐
│  1. Scan all .json/.xml translation files in the directory                  │
│  2. Regex-extract the translated value for "Phoenix5" in each file           │
│  3. Build a lookup table: {file: "zh-CN.json", value: "凤凰5"}  │
│  4. Check format compliance (encoding, special characters, length limits)            │
│  5. Compute pass rate, generate the report skeleton                            │
└────────────────────────────────────────────────────┘

┌─ AI layer (7B model) ──────────────────────────────────┐
│                                                      │
│  Task A: Semantic-consistency judgment                                │
│  Input: [{lang: "zh-CN", value: "凤凰5"},             │
│         {lang: "ja-JP", value: "フェニックス5"},     │
│         {lang: "ko-KR", value: "피닉스5"}]           │
│  Prompt: "Do all of the following translations refer to the same game name 'Phoenix5'?    │
│         Output JSON: {consistent: bool, issues: []}"    │
│  Output: {"consistent": true, "issues": []}             │
│                                                      │
│  Task B: Translation-quality assessment                                  │
│  Input: {lang: "de-DE", value: "Phönix Fünf"}         │
│  Prompt: "Does this German translation accurately convey the meaning of 'Phoenix5'? │
│         Score 1–5, give a reason"                             │
│  Output: {"score": 4, "reason": "Fünf is German for 5,       │
│          but game names usually keep the original or a transliteration"}                    │
│                                                      │
│  Task C: Terminology-consistency check                                │
│  Input: the list of all translated values across the 33 files                      │
│  Prompt: "Check whether the following list of translations uses any inconsistent terminology"      │
│  Output: {"inconsistencies": [                          │
│    {file: "fr-FR.json", issue: "uses 'Phoenix Cinq'  │
│     instead of 'Phoenix 5'; the digit should stay Arabic"}            │
│  ]}                                                    │
────────────────────────────────────────────────────┘
```

**AI share (envisioned): about 30%**. Code does file scanning and format checks; the AI does semantic judgment and quality assessment.

#### AI responsibilities in the other implemented scenarios (summary)

| Scenario | Code layer | AI layer |
|---|---|---|
| TestData Verification | Runs the selected verifier Plugin, SSE progress, report aggregation, rule-based diagnosis fallback | Root-cause diagnosis of failed cases (JSON: summary / diagnoses / recommendations) |
| EasyHelp Checking | HTML→TXT conversion, baseline diff, keyword counting and highlighting, Excel output | `helpfile_analyzer` generates the analysis report (server-side Ollama); post-pipeline step summary |
| Portugal Plugin | Symbol-map import/validation/self-test, PlayCheck fetch, parsing, totals and consistency checks, TXT/JSON/HTML reports | Clarifying question when input is missing; post-pipeline step summary |

### 11.3 Key Points of 7B-Model Prompt Design

Because the model is small, prompts must be **extremely narrow**:

```typescript
// ❌ Wrong: let the model free-form
const badPrompt = `
  You are a translation expert, please check the quality of these translation files...
  (the model may output in any format, or even start chit-chatting)
`;

// ✅ Right: force structured output
const goodPrompt = `
  You are a translation-consistency checker.

  Input: the list of "Phoenix5" translation values across 33 translation files

  Task: determine whether any translation is inconsistent

  Output format (strict JSON, output nothing else):
  {
    "consistent": true/false,
    "issues": [
      {"file": "filename", "value": "translated value", "reason": "reason"}
    ]
  }

  Begin checking:
  [data list]
`;
```

**Key techniques**:
1. **Role scoping**: not "translation expert" but "translation-consistency checker" (shrinks the behavior space) — in the code: `clarify` is scoped as a "lightweight clarification assistant" and `summarizeStepResult` as a "report-summary assistant";
2. **Lock the output format**: give a JSON Schema, don't let the model organize language freely — the verification-diagnosis prompt does exactly this with a JSON template;
3. **Single task**: one prompt makes only one judgment, no stacking multiple tasks — in the code every call does one thing and explicitly says "do not call tools, do not plan next steps";
4. **Length constraints**: cap the number of sentences (clarify 1–3, summary 3–6), and truncate input results to 4000 characters;
5. **Few-shot examples**: give 1–2 input/output examples, since 7B models imitate well (not used in the code today; can be introduced as needed).

### 11.4 Code-Level Fallback Strategy

**Fallbacks implemented today**:

| Call | On failure/exception |
|---|---|
| `clarify` (clarifying question) | LLM unavailable → uses a fixed question built into the code ("Looks like I'm missing …") and logs a warning |
| `clarify` (Enter chat) | Logs an "AI chat unavailable" warning; no effect on any flow |
| `summarizeStepResult` | Runs asynchronously; failure only logs a warning — the pipeline is already completed and is neither rolled back nor blocked |
| `runAIDiagnosis` | Extracts the JSON object from the response with a regex and parses it; parse failure → raw text becomes the summary; call throws → falls back to `log_diagnoser` rule-based diagnosis; if `log_diagnoser` also fails → returns a minimal diagnosis |
| `helpfile_analyzer` | The plugin has its own fallback result (prompting to check Ollama model availability) |

**Illustrative code (envisioned, using the translation scenario; not implemented)**:

```typescript
async function runTranslationCheck(files: TranslationFile[]) {
  // 1. Code does the deterministic work
  const extracted = files.map(f => ({
    file: f.name,
    value: f.content.match(/"Phoenix5":\s*"([^"]+)"/)?.[1] ?? "",
  }));

  // 2. AI makes the semantic judgment
  let aiResult = await callLocalLLM({
    prompt: buildConsistencyCheckPrompt(extracted),
    temperature: 0.2,  // Low temperature, less randomness
    maxTokens: 500,    // Limit output length
  });

  // 3. Code validates the AI's output format
  let parsed: CheckResult;
  try {
    parsed = JSON.parse(aiResult);
    if (!('consistent' in parsed)) throw new Error("Format error");
  } catch {
    // AI output format error → retry once
    aiResult = await callLocalLLM({ ...retryPrompt });
    parsed = JSON.parse(aiResult);  // If it fails again, report the exception
  }

  // 4. Code makes the final decision
  return {
    totalFiles: files.length,
    aiJudgment: parsed,
    autoFixable: parsed.issues.filter(i => isAutoFixable(i)),
    manualReview: parsed.issues.filter(i => !isAutoFixable(i)),
  };
}
```

**General fallback principles** (planned; only partly in place today):
- AI output format error → automatically retry once (retry is not implemented today; tolerant parsing + fallback is used instead);
- AI contradicts itself (e.g. says consistent=true but issues is non-empty) → code flags it as "needs manual review";
- AI timeout/failure → degrade to pure rule-based checking (verification diagnosis already works this way).

### 11.5 Division of Labor: 7B Local Model vs. Cloud Multi-Provider Models

| Task type | 7B local model | Cloud model (OpenAI/Anthropic-compatible, etc.) |
|----------|------------|--------------------------|
| Simple classification | ✅ Capable | ✅ Capable (wasteful) |
| Formatted structured output | ✅ Capable (needs a strict prompt) | ✅ Capable |
| Complex semantic reasoning (e.g. cultural context) | ⚠️ Marginal, needs manual review | ✅ Capable |
| Long-text summarization (>2K tokens) | ❌ Easily loses information | ✅ Capable |
| Batch processing (100+ files) | ✅ Free, can run in parallel | ⚠️ Costly |

**Recommended strategy**:
- **Development/debugging phase**: use the 7B local model exclusively, for rapid iteration;
- **Batch production phase**: use the 7B local model for simple tasks, and switch to a cloud Provider on the model-management page as needed for complex semantic judgment;
- **HARNESS auto-routing** (planned, **not implemented**): code would choose the model source by task complexity. Today, every frontend call uses the single model the user selected in the model drop-down / model-management page, and `helpfile_analyzer` always uses local Ollama server-side.

```typescript
// Planned auto model-selection logic (does not exist in the code today)
function selectModel(task: TestTask): "local" | "cloud" {
  if (task.complexity === "simple") return "local";  // Classification, format checks
  if (task.complexity === "complex") return "cloud"; // Semantic reasoning, quality assessment
  return "local";  // Defaults to local
}
```

### 11.6 Summary: The 7B Model's Place in HARNESS

```
┌──────────────────────────────────────────────────┐
│  HARNESS Execution Engine (code)                           │
│  ┌────────────────────────────────────────────┐  │
│  │  Process control · data parsing · format validation · file ops    │  │
│  │  · failure retries · rule-based diagnosis · state management            │  │
│  └────────────────────────────────────────────┘  │
│                      ↑↓ calls (single-turn, no tool calling)                       │
│  ┌────────────────────────────────────────────┐  │
│  │  7B local model (semantic sensor)                    │  │
│  │  · Simple dialogue / clarifying questions                              │  │
│  │  · Result summaries & failure diagnosis                            │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**One-line summary**: the 7B model is HARNESS's "eyes" and "ears" — responsible for looking and listening (semantic understanding), focused on lightweight tasks such as simple dialogue and analysis reporting; but the "hands, feet, and brain" (process control, decision-making, execution) are entirely code. This makes use of the AI's semantic capability while avoiding the unreliability of a small model.

---

## 12. Backend Service Architecture (new; corresponds to `server/`)

### 12.1 Stack & Startup

- FastAPI + uvicorn, listening on `0.0.0.0:8000` by default (`HARNESS_API_HOST` / `HARNESS_API_PORT`), with config read from `.env` in the project root (or next to the exe once packaged);
- At startup it initializes SQLite, registers `BUILTIN_TOOLS` into `ToolRegistry`, and creates the execution queue;
- It also serves the frontend build output (`server/static`) with an SPA fallback route;
- Desktop distribution: `build.py` is the PyInstaller entry point, starting uvicorn and then opening a desktop window with pywebview; `harness.cmd` / `slot_harness.spec` package it into an exe.

### 12.2 API Overview

| Route | Description |
|---|---|
| `GET /api/tools/list?scenario_id=` | Lists registered Plugins (optionally filtered by scenario via `SCENARIO_PLUGINS`), plus the function-calling schema |
| `POST /api/tools/execute` | Runs one Plugin synchronously (used by ExecutionEngine) |
| `POST /api/tools/execute-async` | Runs one Plugin in the background, with progress pushed over SSE (used by TestData Verification) |
| `POST /api/tools/upload-testdata` | Uploads .testdata files and writes them to a real path |
| `POST /api/tools/upload-folder` | Uploads help files (a folder or loose files), laid out as `subdir/index.html` |
| `GET /api/tools/skills/list` | Lists Skill-file metadata from the `skills/` directory |
| `POST /api/executions/new` | Creates an execution record |
| `GET /api/executions/mine` / `GET /api/executions/{id}` | Execution history list / execution detail (with tool_calls and records) |
| `GET /api/executions/stream/{id}` | SSE event stream (`harness_event` / `done` / `ping`) |
| `POST /api/executions/{id}/cancel` | Requests cancellation of a running browser-driven Plugin |
| `POST /api/executions/audit-llm` | Records an LLM-call audit entry (not currently called by the frontend) |
| `GET /api/executions/runs/{id}/{tool}/{file}` | Downloads an artifact from an execution's working directory |
| `GET/POST /api/records/...` | Batch-save test records, download `outcome.zip`, download `artifacts/{file}` |
| `GET /healthz`, `GET /api/status` | Health checks |

### 12.3 Plugin Contract & Execution

- `ToolPlugin.validate()`: checks required params, rejects any param outside the inputSchema (`unknown_param`), does light type coercion, and fills in defaults;
- `ToolPlugin.execute()`: handles timing and catches exceptions, turning them into `ToolResult(success=False, error=...)`; a Plugin only implements `_run_impl`;
- `ToolResult`: `success / content / error / execution_ms / artifacts`;
- `HarnessContext`: `execution_id / user_id / user_role / session_token / work_dir`; each call's working directory is `server/data/runs/{execution_id}/{tool_name}/`;
- `SerialExecutionQueue`: runs **serially** under a per-user asyncio lock so multiple Selenium Chromes don't collide (the interface leaves room to swap in a parallel queue);
- `cancellation`: browser-driven Plugins (`testdata_verifier`, `testdata_verifier_harness`, `portugal_plugin_fetcher`) register a force-close callback after acquiring the WebDriver, which the cancel endpoint invokes.

### 12.4 Data Storage

SQLite (`server/data/harness.db`) with four tables:

- `executions`: one run (intent, stage, status, LLM provider/model, token counts, duration, error);
- `tool_calls`: each Plugin call (params, success, result snippet, artifacts, duration, error);
- `test_records`: test records from TestData generation (case, format, module, batch/index, file name, XML snippet);
- `llm_audit`: LLM-call audit (nothing writes to it today).

Artifact directories: `server/data/runs/` (per-execution working directories; `config.py` defines `HARNESS_RUN_TTL_HOURS`, but no cleanup logic uses it yet) and `server/data/artifacts/` (downloadable reports and ZIPs); Portugal symbol maps persist in the repository-root `symbol_profiles/`.

---

## 13. Code Status & Known Discrepancies (new)

The following inconsistencies — within the code, or between the code and the plan — were found during this revision. The document now describes the code as it is; whether to change the code is a separate decision.

| # | Current state | Impact |
|---|---|---|
| 1 | `game-verify-pipeline` is declared, but TestData Verification actually runs through `verificationEngine.ts`, and that Pipeline's verify step references only `testdata_verifier` (the legacy method no longer offered in the UI) | Pipeline declaration and actual execution disagree |
| 2 | `PipelineStepDef.dependsOn` is not checked by the execution engine; the `skipped` / `paused` / `idle` states are unused | Declarative metadata only |
| 3 | `agents/ui_log_diagnoser_agent.md` is referenced by no scenario; the `log_diagnosis` scenario and `log-diagnose-pipeline` it mentions no longer exist | Orphaned file |
| 4 | Agent data in `AgentPage.tsx` is hardcoded, and its "Planner Agent" still claims to "drive the conversation loop and tool orchestration"; the Skill display data in `PluginPage.tsx` is hardcoded too | Display may drift from actual responsibilities/files |
| 5 | The frontend never calls `auditLlm`, so the `llm_audit` table and the executions token fields stay empty; the UI shows no token / latency / cache statistics | The monitoring panel in 4.1 is planned only |
| 6 | `helpfile_analyzer` calls Ollama directly server-side with default model `qwen3:latest`, ignoring the frontend model switch | The only call that bypasses the unified gateway |
| 7 | The input-box model drop-down `MODEL_OPTIONS` is hardcoded (with labels like `deepseek-chat`, `claude-3-haiku`) and doesn't map one-to-one onto the Provider Presets | Options may not match the current Provider |
| 8 | TestData Generation's `gamePrefix` (P5P) and default `moduleId` (105359) are hardcoded in App.tsx; Google Sheet URLs are never fetched | Other games rely on the Module ID in the pasted text |
| 9 | Test-plan preview checkboxes don't affect execution, except Portugal's "Save Imported Mapping"; TestDataPreview's "Regenerate" just resets to mock records | Interactions are weaker than the UI implies |
| 10 | `plugins/README.md`, `workflows/README.md` and `skill-generator-plugin-contract.md` still mention the nonexistent `game_verifier_tool.py` / "pipeline hardcoded in plannerAgent.ts" | Supporting docs are out of date |
