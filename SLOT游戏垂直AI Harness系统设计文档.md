# SLOT游戏垂直AI Harness系统设计文档

## 1\. 项目总览与核心定位

### 1\.1 项目定位

本项目为**面向SLOT游戏测试的垂直领域AI Agent调度座舱（AI Harness）**。

技术定位采用行业最优组合范式：

- **调度内核**：吸收 Hermes\-Agent 标准 Harness 工程理念，以「代码强约束、AI弱决策、流程可管控、执行可追溯」为核心设计原则，规避小模型随机性问题。

- **界面形态**：沿用 TraeWork 极简工程化桌面UI设计，摒弃通用AI平台冗余功能，聚焦测试流水线高效执行。

- **业务场景**：专为 SLOT 游戏测试数据生成、表格数据智能清洗、自动化测试任务派发、批量测试闭环打造的**垂直专用AI工作台**，非通用AI对话工具、非传统SaaS业务系统。

### 1\.2 设计核心目标

- 适配本地 Ollama 7B 轻量模型，实现低成本、离线可用、高稳定的AI测试流水线；

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

- **机械固定逻辑**（数据清洗、去重、判空、格式标准化、流程顺序）：全部下沉 Harness 调度代码 \+ Plugin 工具层；

- **智能语义逻辑**（无效数据语义判别、结构化规整、任务语义适配）：交由 Agent \+ Skill 规则层；

- **流程调度权**：完全由 Harness 代码接管，禁止AI自主动态调度、禁止AI随意变更流水线步骤。

### 2\.2 四层分层架构（标准工业级AI Harness结构）

#### 第一层：Harness 调度内核（中枢层）

系统唯一总指挥，对应 Hermes 核心缰绳管控能力，完全代码固化逻辑：

- 固定流水线编排：读取表格 → 数据清洗 → 任务封装 → 测试数据生成；

- 模型调度管理：本地Ollama7B / 云端DeepSeek模型一键切换、参数管控、缓存策略调度；

- 全流程状态管控、步骤卡点、异常重试、链路追踪；

- 固定Prompt前缀拼接，保障云端KV缓存命中率，降低批量运行成本。

#### 第二层：Agent 智能角色层（决策层）

双Agent极简分工，无冗余角色，适配SLOT单一场景：

- **数据清洗Agent**：负责GoogleSheet原始测试数据的语义校验、脏数据判别、结构化标准化输出；

- **测试任务适配Agent**：将清洗后的标准数据，封装为SLOT测试专用任务结构体，适配生成插件入参规范。

所有Agent能力由本地 `agent-xxx.md` 角色文件定义，纯配置化、可热更新、无需改代码。

#### 第三层：Skill 技能规则层（能力层）

配套专属技能手册，固定规则、约束AI行为，适配小模型稳定性：

- skill\-sheet\-data\-clean：SLOT测试表格专属清洗、过滤、标准化规则；

- skill\-task\-dispatch\-rule：SLOT测试任务封装、派发、格式约束规则；

- skill\-generator\-plugin\-contract：测试生成插件接口契约规范。

Skill文件永久固定为缓存前缀，本地调试、云端生产完全复用。

#### 第四层：Plugin 本地工具层（执行层）

纯代码落地工具，承接所有机械重复性工作，兜底小模型短板：

- GoogleSheet读取Plugin：负责表格API连接、原始数据拉取、网络异常处理；

- 测试数据生成Plugin：接收AI结构化任务，批量生成SLOT场景标准化测试数据；

- 本地文件、日志、产物管理工具集。

---

## 3\. 核心工作流水线（固定闭环）

全程由 Harness 代码固定调度，无AI自主决策步骤，稳定适配本地7B模型：

**用户触发任务 → Harness调用Sheet插件拉取原始数据 → Harness拼接固定Agent\+Skill前缀 → 本地7B模型AI语义清洗 → 输出标准结构化JSON → Harness封装测试任务 → 调用生成插件产出SLOT测试数据 → 全流程日志归档、产物预览**

所有流程步骤、执行顺序、异常兜底均代码固化，AI仅承担轻量化智能判别工作。

---

## 4\. UI界面设计规范（TraeWork 极简工程风）

完全对标 TraeWork 桌面Harness极简设计，舍弃WorkBuddy通用臃肿样式，适配SLOT专项测试场景，从视觉层面彻底区分传统SaaS。

### 4\.1 全局布局：标准AI Harness三栏式布局

- **左侧：资源导航栏**（纯AI资源体系，无业务菜单）
        

    - Agent角色仓库（清洗Agent、任务适配Agent）；

    - Skill技能规则库（可预览、启用、查看详情）；

    - Plugin工具集、流水线配置；

    - 无权限管理、无用户角色、无业务数据菜单。

- **中间：核心执行画布**

    - 流水线节点可视化展示；

    - 任务一键运行、单步调试、重置能力；

    - 测试数据产物实时预览（JSON结构化视图，非SaaS表格）。

- **右侧：日志与监控面板**

    - 模型推理日志、Token消耗、推理耗时；

    - Plugin工具调用记录、入参出参日志；

    - 缓存命中统计、流程执行轨迹、异常告警。

### 4\.2 视觉与交互规范

- 极简工程化风格，大圆角、弱阴影、低饱和科技色调，无冗余装饰；

- 核心突出「工作流、AI推理、工具执行、轨迹日志」四大AI Harness专属模块；

- 去除所有传统SaaS密集表单、批量操作、数据筛选、增删改查组件；

- 配套AI专属加载动效、节点流转动效、工具调用脉冲动效。

---

## 5\. 模型适配策略（本地7B \+ 云端双兼容）

### 5\.1 本地Ollama 7B模式（开发调试）

- 能力下沉：90%机械规则、流程调度、格式约束下沉代码层；

- 模型参数收敛：低温参数（0\.2\-0\.3），禁止自由发挥，强制标准JSON输出；

- 流程极简固定，无复杂多轮对话，规避小模型上下文丢失问题。

### 5\.2 云端DeepSeek模式（批量生产）

- Agent\+Skill固定前缀完全复用，无需修改提示词；

- 天然支持KV缓存，批量测试数据生成大幅降低Token成本；

- 保留原有架构、流程、UI，一键无缝切换。

---

## 6\. 目录结构规范（工业级标准化）

适配缓存策略、分层解耦、可长期迭代：

```Plain Text
slot-ai-harness/
├── agents/                # 智能角色定义（固定缓存前缀）
│   ├── agent-sheet-reader.md
│   └── agent-task-dispatch.md
├── skills/                # 技能规则手册（固定缓存前缀）
│   ├── skill-sheet-data-clean.md
│   ├── skill-task-dispatch-rule.md
│   └── skill-generator-plugin-contract.md
├── plugins/               # 本地工具插件（纯代码执行层）
│   ├── google_sheet_reader.py
│   └── testdata_generator.py
├── workflows/             # 固定流水线配置
│   └── slot-test-pipeline.yaml
├── harness/               # 核心调度引擎
│   ├── scheduler.py
│   ├── model_adapter.py
│   └── trace_logger.py
└── frontend/              # TraeWork极简桌面UI

```

---

## 7\. 核心优势总结（可用于汇报、评审、落地归档）

1. **架构先进**：吸收Hermes标准Harness工程内核，以约束化调度解决小模型落地难题，区别于普通Agent框架；

2. **场景垂直**：专为SLOT游戏测试定制，无通用冗余能力，执行效率远高于通用AI平台；

3. **形态纯正**：采用TraeWork极简工程桌面UI，三栏式AI专属布局，完全规避传统SaaS观感；

4. **双模兼容**：本地7B免费调试、云端低成本量产，一套架构适配研发全流程；

5. **工程可沉淀**：Agent/Skill/Plugin分层解耦，测试能力可复用、可迭代、可标准化沉淀。

---

## 8\. 最终项目定位定稿（官方标准话术）

本系统是**吸收Hermes Harness调度内核思想、采用TraeWork极简工程化桌面UI、专为SLOT游戏测试场景打造的垂直领域AI智能体调度座舱**。依托分层化Agent、标准化Skill规则、本地化Plugin工具与约束式Harness调度引擎，完美适配本地7B轻量模型稳定运行，实现测试数据智能清洗、自动化任务派发、批量测试数据生成全闭环，是轻量化、高专注度、工程化的垂直AI测试工作台，区别于通用AI办公工具与传统SaaS业务系统。

---

## 9\. 未来能力扩展性设计（系统可迭代规划）

本套SLOT AI Harness架构**天生支持横向扩展、能力插拔、场景迭代**，并非只能做单一「TestData生成与验证」。整套分层设计完全遵循**插件化、解耦、可插拔、可拓展**的工业级Harness规范，后续可以低成本叠加全套SLOT游戏自动化测试能力，无需重构底层架构、无需推翻现有UI与调度逻辑。

本章详细说明：**如何新增插件、新增Agent技能、新增测试流水线、新增业务模块**。

### 9\.1 核心扩展原理：四层架构完全支持插拔式迭代

当前四层架构最大优势：**层与层完全解耦，新增能力只增量叠加，不改动旧代码**

- **Harness调度层**：支持新增流水线节点、新增执行链路、新增调度模式，原生支持多工作流共存；

- **Agent角色层**：支持新增专项智能角色，多Agent协同工作，无需改动原有清洗、生成Agent逻辑；

- **Skill技能层**：技能文件无限叠加，规则可分组、可复用、可场景专属；

- **Plugin工具层**：完全插拔式设计，新增工具直接注册即可被Harness调度调用，无侵入。

👉 **所有扩展都是「增量叠加」，存量稳定业务完全不受影响**。

### 9\.2 Plugin插件扩展（最核心、最自由的扩展方式）

当前仅落地：表格读取插件、测试数据生成插件。
后续可无限新增SLOT游戏测试全链路插件，全部**即插即用**：

#### 可拓展插件清单（SLOT专项）

- **SLOT数值校验插件**：倍率校验、概率校验、随机值分布合规性校验；

- **关卡/剧情测试插件**：多场景剧情数据批量生成与合法性验证；

- **异常用例生成插件**：边界值、非法参数、异常场景自动构造；

- **自动化报告导出插件**：测试覆盖率、数据合规报告、批量执行报表；

- **本地日志分析插件**：游戏运行日志解析、异常定位、报错聚类；

- **版本比对插件**：新旧版本测试数据差异对比、变更风险识别。

**扩展规则**：新增插件只需放入 `plugins/` 目录、注册Harness调度入口，即可在前端画布展示、运行、纳入流水线。

### 9\.3 Agent智能角色扩展（多智能体协同迭代）

当前双Agent架构可平滑拓展为**多Agent协作测试集群**：

- **校验评审Agent**：专门负责测试数据合法性评审、缺陷标记、自动修正建议；

- **场景拆解Agent**：根据SLOT游戏玩法自动拆解测试场景、自动分配测试用例；

- **风险巡检Agent**：批量扫描测试数据中的潜在风险、概率异常、逻辑漏洞；

- **报告总结Agent**：根据执行轨迹自动生成测试小结、问题汇总、迭代建议。

所有新增Agent仅需新增 `agents/*.md`，Harness自动加载、前端自动展示资源。

### 9\.4 Skill技能库持续沉淀（能力资产化）

随着业务迭代，可以持续沉淀SLOT专属测试技能库：

- SLOT概率合规性判定技能

- SLOT倍率溢出校验技能

- 游戏特殊玩法数据校验技能

- 边界场景智能识别技能

技能永久沉淀、可复用、可组合，形成项目专属AI测试知识库。

### 9\.5 工作流流水线扩展（从单一流程 → 多场景流水线）

当前只有「数据清洗\-生成」基础流水线，后续可拓展多条独立闭环流水线：

- 快速冒烟测试流水线（轻量、极速校验）

- 全量批量回归测试流水线（大规模量产）

- 异常场景专项测试流水线

- 版本迭代对比测试流水线

前端画布可实现：**多流水线切换、独立运行、各自日志隔离**。

### 9\.6 UI界面扩展能力（TraeWork极简架构支持无限模块叠加）

当前三栏布局为**标准可拓展画布**：

- 左侧资源栏自动适配新增Agent/Skill/Plugin；

- 中间画布支持新增节点、新增流程模板；

- 右侧日志面板支持新增专项监控（校验统计、覆盖率统计、风险统计）。

UI无需重构，仅增量新增功能模块，始终保持极简高效，不会变成臃肿SaaS。

### 9\.7 模型能力拓展

- 支持后续无缝升级 14B/32B 本地大模型，获得更强语义推理；

- 支持接入多家云端模型，自动择优调度；

- 支持模型微调对接，针对SLOT场景持续优化专项能力。

### 9\.8 最终扩展结论（可对外汇报）

本SLOT AI Harness**不是一次性固定工具，而是一套可持续生长的AI测试工程体系**。

当前仅完成「基础数据生成与验证」最小闭环，依托Hermes式分层约束架构与插件化设计，未来可**零重构、低成本、增量式**拓展为覆盖「数据生成、智能校验、异常测试、回归测试、风险巡检、自动报告」的全站SLOT游戏AI自动化测试平台，具备极强的长期工程扩展性与业务迭代能力。

---

## 10\. HARNESS框架扩展设计（多场景流水线架构）

### 10\.1 当前架构局限性分析

现有HARNESS采用**单一流水线硬编码**模式：

```
固定流程：用户输入 → PlannerAgent(stage1) → testdata_parser → testdata_generator → zip_packager
```

**问题**：新增测试场景（如翻译文件验证、数值校验）需修改代码、Prompt、前端stage枚举，无法实现真正的插拔式扩展。

### 10\.2 HARNESS三层核心模块升级

将HARNESS从"单一流水线调度员"升级为"多场景交通指挥中心"：

#### 模块一：意图路由器（Intent Router）

**职责**：解析用户自然语言，匹配测试场景，自动加载对应的Agent+Skill+Pipeline+Plugin组合。

```typescript
interface TestScenario {
  id: string;                    // 场景唯一标识
  label: string;                 // 前端显示名称
  keywords: string[];            // 关键词匹配规则
  agentFile: string;             // 对应的Agent .md文件
  skills: string[];              // 需要的Skill文件列表
  pipeline: string;              // 流水线ID
  requiredPlugins: string[];     // 依赖的Plugin列表
}

const SCENARIOS: TestScenario[] = [
  {
    id: "testdata_generation",
    label: "TestData生成",
    keywords: ["testdata", "生成", "paytable", "sheet"],
    agentFile: "testdata_generator_agent.md",
    skills: ["skill-sheet-data-clean.md"],
    pipeline: "testdata-gen-pipeline",
    requiredPlugins: ["testdata_parser", "testdata_generator", "zip_packager"],
  },
  {
    id: "translation_verification",
    label: "翻译文件验证",
    keywords: ["翻译", "translation", "多语言", "本地化"],
    agentFile: "translation_verifier_agent.md",
    skills: ["skill-translation-check.md"],
    pipeline: "translation-verify-pipeline",
    requiredPlugins: ["file_scanner", "translation_checker"],
  },
  {
    id: "game_verification",
    label: "游戏环境验证",
    keywords: ["验证", "verify", "game", "spin"],
    agentFile: "testdata_verifier_agent.md",
    skills: [],
    pipeline: "game-verify-pipeline",
    requiredPlugins: ["game_verifier", "log_diagnoser"],
  },
];
```

**路由策略**：关键词规则匹配 + 用户显式选择双保险，不依赖AI做路由判断（规避小模型不可靠性）。

#### 模块二：流水线编排器（Pipeline Orchestrator）

**职责**：声明式定义每个场景的执行步骤、依赖关系、异常处理策略。

```typescript
interface PipelineStep {
  id: string;
  plugin: string;              // 调用的Plugin名称
  label: string;               // 前端显示名
  dependsOn: string[];         // 依赖的前置步骤
  retryOnFail: boolean;        // 失败是否重试
  maxRetries: number;
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStep[][];    // 二维数组：外层=阶段(串行)，内层=并行步骤
}

const PIPELINES: Record<string, Pipeline> = {
  "testdata-gen-pipeline": {
    id: "testdata-gen-pipeline",
    name: "TestData生成流水线",
    stages: [
      [{ id: "parse", plugin: "testdata_parser", label: "解析表格数据", dependsOn: [], retryOnFail: true, maxRetries: 2 }],
      [{ id: "generate", plugin: "testdata_generator", label: "生成测试数据", dependsOn: ["parse"], retryOnFail: true, maxRetries: 2 }],
      [{ id: "package", plugin: "zip_packager", label: "打包产物", dependsOn: ["generate"], retryOnFail: false, maxRetries: 1 }],
    ],
  },
  "translation-verify-pipeline": {
    id: "translation-verify-pipeline",
    name: "翻译验证流水线",
    stages: [
      [{ id: "scan", plugin: "file_scanner", label: "扫描翻译文件", dependsOn: [], retryOnFail: true, maxRetries: 1 }],
      [{ id: "check", plugin: "translation_checker", label: "逐文件校验翻译", dependsOn: ["scan"], retryOnFail: false, maxRetries: 1 }],
      [{ id: "report", plugin: "report_generator", label: "生成差异报告", dependsOn: ["check"], retryOnFail: false, maxRetries: 1 }],
    ],
  },
};
```

#### 模块三：执行引擎 + 状态机（Execution Engine）

**职责**：按流水线定义逐步执行，管理状态流转，处理异常。

```
执行引擎（代码控制，AI不参与）：
  for each stage in pipeline.stages:
    for each step in stage:
      1. 检查依赖步骤是否全部完成
      2. 调用对应Plugin
      3. 记录执行结果到状态机
      4. 失败 → 重试 or 上报

AI Agent（仅做语义判断）：
  - 解析用户输入 → 结构化参数
  - 判断Plugin返回结果是否合理
  - 生成诊断报告
```

### 10\.3 新增测试场景完整示例：翻译文件验证

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

### 10\.4 前端适配方案

左侧导航栏升级为**场景选择器**：

```
Sidebar:
├──  测试场景（新增）
│   ├── TestData生成
│   ├── 翻译文件验证
│   ├── 游戏环境验证
│   ── ...（未来新增）
├──  Plugin
├── 🤖 Agents
└── 📋 Task List
```

用户先选场景，再输入具体任务描述。HARNESS根据场景自动加载对应的Agent/Skill/Pipeline/Plugin组合。

### 10\.5 HARNESS目录结构升级

```
src/harness/
├── intentRouter.ts        # 意图路由（场景匹配）
├── pipelineRegistry.ts    # 流水线定义（声明式）
├── executionEngine.ts     # 执行引擎（状态机 + 步骤调度）
├── plannerAgent.ts        # AI Agent（仅做语义推理，不再控制流程）
├── plannerProvider.ts     # LLM调用适配
├── client.ts              # 后端API客户端
└── sharedTypes.ts         # 类型定义
```

### 10\.6 关键设计原则

| 原则 | 说明 |
|------|------|
| **场景驱动，非流程驱动** | 用户选场景 → HARNESS自动组装Agent+Skill+Pipeline+Plugin，而非让用户理解流程步骤 |
| **流水线声明式定义** | 新增测试类型只需在`pipelineRegistry.ts`加一条定义 + 写对应Plugin，不改执行引擎代码 |
| **AI只做语义，代码做流程** | Agent不再决定"下一步调什么工具"，而是"这个翻译结果是否合理"。流程由`executionEngine`代码硬控 |
| **Plugin即插即用** | 每个新测试能力 = 一个Plugin文件，注册到`ToolRegistry`即可被任何流水线调用 |
| **Agent/Skill配置化** | 新增场景只需加`.md`文件，不改代码 |

---

## 11\. 本地AI模型（4B）功能定位与使用规范

### 11\.1 4B模型能力边界

| 能做好 | 做不好 |
|--------|--------|
| 理解一段自然语言的意思 | 记住很长的上下文（>4K tokens容易丢） |
| 判断文本A和文本B是否语义一致 | 复杂的多步逻辑推理 |
| 按固定模板输出JSON | 自由发挥时格式容易乱 |
| 从文本中提取结构化信息 | 数学计算、精确数值比较 |
| 识别明显的翻译错误 | 细微的文化语境差异 |

**核心定位**：4B模型是HARNESS的"语义传感器"，负责看和听（语义理解），但"手脚"和"大脑"（流程控制、决策、执行）全是代码。

### 11\.2 AI在各环节的具体职责

#### 场景1：TestData生成（现有）

```
┌─ 代码层（HARNESS执行引擎）─────────────────────────┐
│  1. 读取Google Sheet原始文本                        │
│  2. 正则提取Module ID: /Module\s*ID\s*(\d+)/        │
│  3. 清洗Batch/Index: /^\d+,\d+$/                    │
│  4. 按规则分组文件（Regular Wins / Big Wins / ...）    │
│  5. 生成XML结构（代码模板拼接）                       │
│  6. 打包ZIP                                          │
└────────────────────────────────────────────────────
         ↑ 这些全是代码，AI不参与
         
┌─ AI层（4B模型）──────────────────────────────────┐
│  输入: 用户自然语言 + Sheet原始文本片段               │
│  任务: 判断某行数据属于哪个分类                         │
│  Prompt: "以下数据属于哪个分类？[Regular/BigWin/Bonus] │
│         数据: {row_content}"                          │
│  输出: {"category": "Regular Wins"}                   │
│                                                      │
│  输入: 清洗后的结构化数据                              │
│  任务: 检查数据合理性（如batch是否异常大）             │
│  输出: {"valid": true, "note": ""}                    │
└────────────────────────────────────────────────────┘
```

**AI占比：约10%**。90%的机械工作由代码完成，AI只做分类判断和异常检测。

#### 场景2：翻译文件验证（新增）

```
┌─ 代码层（HARNESS执行引擎）─────────────────────────┐
│  1. 扫描目录下所有.json/.xml翻译文件                  │
│  2. 正则提取每个文件中"Phoenix5"对应的翻译值           │
│  3. 构建对照表: {file: "zh-CN.json", value: "凤凰5"}  │
│  4. 检查格式规范性（编码、特殊字符、长度限制）            │
│  5. 统计通过率、生成报告框架                            │
└────────────────────────────────────────────────────┘

┌─ AI层（4B模型）──────────────────────────────────┐
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

**AI占比：约30%**。代码做文件扫描和格式检查，AI做语义判断和质量评估。

### 11\.3 4B模型Prompt设计要点

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
1. **角色限定**：不是"翻译专家"，而是"翻译一致性检查器"（缩小行为空间）
2. **输出格式锁定**：给JSON Schema，不让模型自由组织语言
3. **任务单一**：一次Prompt只做一个判断，不堆叠多个任务
4. **Few-shot示例**：给1-2个输入输出示例，4B模型模仿能力强

### 11\.4 代码兜底策略

```typescript
// harness/executionEngine.ts
async function runTranslationCheck(files: TranslationFile[]) {
  // 1. 代码做确定性工作
  const extracted = files.map(f => ({
    file: f.name,
    value: f.content.match(/"Phoenix5":\s*"([^"]+)"/)?.[1] ?? "",
  }));
  
  // 2. AI做语义判断
  const aiResult = await callLocalLLM({
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
  const report = {
    totalFiles: files.length,
    aiJudgment: parsed,
    autoFixable: parsed.issues.filter(i => isAutoFixable(i)),  // 代码判断能否自动修复
    manualReview: parsed.issues.filter(i => !isAutoFixable(i)),
  };
  
  return report;
}
```

**兜底策略**：
- AI输出格式错误 → 自动重试1次
- AI判断矛盾（如说consistent=true但issues非空）→ 代码标记为"需人工复核"
- AI超时/失败 → 降级为纯规则检查（代码正则匹配）

### 11\.5 4B模型 vs 云端大模型分工

| 任务类型 | 4B本地模型 | 云端大模型（如DeepSeek） |
|----------|------------|--------------------------|
| 简单分类判断 | ✅ 胜任 | ✅ 胜任（浪费） |
| 格式结构化输出 | ✅ 胜任（需严格Prompt） | ✅ 胜任 |
| 复杂语义推理（如文化语境） | ⚠️ 勉强，需人工复核 | ✅ 胜任 |
| 长文本摘要（>2K tokens） | ❌ 容易丢失信息 | ✅ 胜任 |
| 批量处理（100+文件） | ✅ 免费，可并行 | ⚠️ 成本高 |

**推荐策略**：
- **开发调试阶段**：全用4B本地模型，快速迭代
- **批量生产阶段**：简单任务用4B，复杂语义判断（如翻译质量评分）用云端大模型
- **HARNESS自动路由**：代码根据任务复杂度自动选择模型

```typescript
// 代码自动判断用哪个模型
function selectModel(task: TestTask): "local" | "cloud" {
  if (task.complexity === "simple") return "local";  // 分类、格式检查
  if (task.complexity === "complex") return "cloud"; // 语义推理、质量评估
  return "local";  // 默认本地
}
```

### 11\.6 4B模型在HARNESS中的定位总结

```
┌──────────────────────────────────────────────────┐
│  HARNESS执行引擎（代码）                           │
│  ┌────────────────────────────────────────────┐  │
│  │  流程控制 · 数据清洗 · 格式校验 · 文件操作    │  │
│  │  · 异常重试 · 报告生成 · 状态管理            │  │
│  └────────────────────────────────────────────┘  │
│                      ↑↓ 调用                       │
│  ┌────────────────────────────────────────────┐  │
│  │  4B本地模型（语义传感器）                    │  │
│  │  · 文本分类判断                              │  │
│  │  · 语义一致性检查                            │  │
│  │  · 简单质量评分                              │  │
│  │  · 结构化信息提取                            │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**一句话总结**：4B模型是HARNESS的"眼睛"和"耳朵"，负责看和听（语义理解），但"手脚"和"大脑"（流程控制、决策、执行）全是代码。这样既发挥了AI的语义能力，又规避了小模型的不可靠性。

> （注：部分内容可能由 AI 生成）
