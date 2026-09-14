# SLOT游戏垂直AI Harness系统设计文档

## 1\. 项目总览与核心定位

### 1\.1 项目定位

本项目为**面向SLOT游戏测试的垂直领域AI Agent调度座舱（AI Harness）**。

技术定位采用行业最优组合范式：

- **调度内核**：吸收 Hermes\-Agent 标准 Harness 工程理念，以「代码强约束、AI弱决策、流程可管控、执行可追溯」为核心设计原则，规避小模型随机性问题。

- **界面形态**：沿用 TraeWork 极简工程化桌面UI设计，摒弃通用AI平台冗余功能，聚焦测试流水线高效执行。

- **业务场景**：专为 SLOT 游戏测试数据生成、表格数据智能清洗、自动化测试任务派发、批量测试闭环打造的**垂直专用AI工作台**，非通用AI对话工具、非传统SaaS业务系统。

### 1\.2 设计核心目标

- 适配 7B 规模轻量模型（本地 Ollama 优先，亦可切换云端同规模/更大规模模型），实现低成本、可离线、高稳定的AI测试流水线；

- 明确 AI 的职责边界：仅承担 7B 模型可胜任的**简单对话交互、任务分类与推流调度、执行结果的分析报告生成**三类轻量语义任务，不承担复杂多步规划、精确数值计算等超出小模型能力范围的工作；

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

- 模型调度管理：内置统一的**多网关模型适配层**（本地 Ollama，以及 DeepSeek / OpenAI / Anthropic 等云端兼容 Provider），支持模型来源一键切换、参数管控、缓存策略调度——多网关是有意为之的可扩展性设计，便于后续接入更多模型源而不改动调度层代码（详见第5章）；

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

> **勘误说明（Harness 登录 与 游戏环境登录 的关系）**：早期实现在 Harness 前端加入了登录页与后端账号/角色系统（`server/api/auth_router.py`、`session_manager.py` 等），初衷是希望"登录一次 Harness，测试全程无需再登录真实游戏/后台环境"。经代码核查确认：**这个假设不成立**——Harness 自身的登录态与真实游戏/后台环境的登录态是两套完全独立、互不相通的系统：
>
> - Harness 登录（bcrypt 密码 + session token + 角色）只控制"谁能打开这个内部工具网页"；
> - 真正让 Selenium 自动化浏览器免于重新登录游戏/后台环境的机制，是直接借用测试人员**本机常用 Chrome 浏览器**已登录的用户配置文件（见 `server/tools/impl/testdata_verifier_tool.py` 的 Chrome profile 复用逻辑），与 Harness 账号完全无关，且只在"同一台本机、已手动登录过游戏后台"的前提下生效；借用失败时代码会直接报错，提示"请先在你平时用的 Chrome 里登录后台"——即游戏环境的登录本来就是**测试人员手动完成的**，从未被自动化。
>
> 既然 Harness 自身的登录/权限层**不能**带来"免登录游戏环境"的效果，就没有必要为此保留一套用户账号与角色体系——这与本节"无权限管理、无用户角色、无业务数据菜单"的原始定位是一致的。因此确定：**移除 Harness 自身的登录门槛**，打开即用；真实游戏/后台环境的登录仍由测试人员在自己的浏览器里按需手动完成，与 Harness 无关，Harness 不做、也不承诺做这件事。
>
> （注：本节描述的是目标状态。当前代码仍保留登录页面与后端认证机制 `server/api/auth_router.py` / `server/infra/security.py`，将在后续版本中移除以匹配此处的定位。）

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

## 5\. 模型适配策略（统一多网关设计，本地7B为主力）

> **勘误说明**：本文档早期版本将模型策略描述为"仅支持本地Ollama7B + 云端DeepSeek"两种固定模式。经与实现方案确认，代码层的多 Provider 网关（同时支持 Ollama、DeepSeek、OpenAI 兼容、Anthropic 兼容及自定义端点）**是有意为之的可扩展性设计，而非对原设计的偏离**。此处予以更正：模型策略的本质不是"双模式"，而是"统一网关、多源接入"，本地7B模型是当前主力与默认选项，云端/其他Provider是面向未来扩展预留的能力，不代表当前场景需要用到全部能力。

### 5\.1 本地Ollama 7B模式（默认 / 开发调试）

- 能力下沉：90%机械规则、流程调度、格式约束下沉代码层；

- 模型参数收敛：低温参数（0\.2\-0\.3），禁止自由发挥，强制标准JSON输出；

- 流程极简固定，无复杂多轮对话，规避小模型上下文丢失问题；

- AI 只承担第1.2节明确的三类轻量任务（简单对话、任务分类推流、分析报告生成），不做复杂推理。

### 5\.2 云端多Provider网关模式（可选 / 按需切换）

- 统一的 Provider 适配层（`plannerProvider.ts` \+ `llmGateway.ts`）屏蔽了具体云端厂商差异，支持 DeepSeek、OpenAI 兼容、Anthropic 兼容及自定义 Base URL 端点；

- Agent\+Skill固定前缀完全复用，无需因切换 Provider 修改提示词；

- 天然支持KV缓存，批量测试数据生成大幅降低Token成本；

- 保留原有架构、流程、UI，一键无缝切换，且新增一个云端 Provider 只需增加一条 Preset 配置，不改动 Harness 调度层代码。

### 5\.3 为何采用多网关而非硬编码两个Provider

- **面向扩展，而非当前必需**：当前测试场景仅需2-3个固定工作流（见第10.7节），本地7B模型已能覆盖；多网关的意义在于未来更换模型来源、接入客户自有模型API时无需重构 Harness；

- **架构解耦**：模型来源变化只影响 Provider 适配层，不影响意图路由、流水线定义、执行引擎、Agent/Skill 内容，符合第9章"层与层完全解耦"的扩展原则；

- **非通用能力冗余**：多网关不等于引入通用AI对话/办公能力，Provider 切换后 AI 的职责边界（简单对话、任务推流、分析报告）保持不变，不违背第1.3节"非通用AI工具"的定位。

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

4. **多网关兼容**：本地7B模型免费调试为主，云端多家Provider（DeepSeek/OpenAI/Anthropic兼容等）低成本量产为辅，一套架构适配研发全流程，且预留未来扩展空间；

5. **工程可沉淀**：Agent/Skill/Plugin分层解耦，测试能力可复用、可迭代、可标准化沉淀。

---

## 8\. 最终项目定位定稿（官方标准话术）

本系统是**吸收Hermes Harness调度内核思想、采用TraeWork极简工程化桌面UI、专为SLOT游戏测试场景打造的垂直领域AI智能体调度座舱**。依托分层化Agent、标准化Skill规则、本地化Plugin工具与约束式Harness调度引擎，以7B规模模型（本地Ollama为主，多网关云端Provider为扩展补充）稳定承担简单对话、任务分类推流、分析报告生成等轻量语义任务，由预先设计好的固定工作流（Agent+Skill+Plugin组合）驱动完成测试数据智能清洗、自动化任务派发、批量测试数据生成全闭环，是轻量化、高专注度、工程化的垂直AI测试工作台，区别于通用AI办公工具与传统SaaS业务系统。

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

### 10\.3 新增测试场景完整示例：翻译文件验证（架构扩展能力示例，非当前已实现场景）

> 注：本节"翻译文件验证"是用于说明架构可扩展性上限的**假设性示例**，当前项目实际只需覆盖 TestData生成、游戏环境验证、日志诊断/EasyHelp检查这2-3个固定场景（见第10.7节），并未实现本示例场景。

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

### 10\.7 当前工作流范围说明（澄清：固定工作流驱动，非AI自主编排）

**当前实际需求**：项目现阶段仅需覆盖 **2-3 个固定测试场景**（TestData生成、游戏环境验证、日志诊断/EasyHelp文件检查），并非要支持无限开放的场景组合。每个场景对应一条**预先设计好的固定 Pipeline**（Agent + Skill + Plugin 的组合），这条组合在 `pipelineRegistry.ts` / `intentRouter.ts` 中声明式定义，运行前已经确定，不由 AI 临场决定。

**执行模型的关键澄清**：

- Harness 的 **执行引擎（ExecutionEngine）** 按 Pipeline 声明的 stage 顺序逐步调用 Plugin，AI **不参与"下一步该调用哪个工具"这个决策** —— 这一点由代码（Pipeline 定义 + 执行引擎）100%固化；

- AI（7B模型）只在流水线内部的语义判断节点上发挥作用，具体只做三件事（呼应第1.2节的职责边界）：
  1. **简单对话交互**：与用户澄清意图、追问缺失参数；
  2. **任务推流**：对解析后的结构化数据做分类/路由判断，将其按场景要求推送到下一步骤（如"这行数据属于哪个测试分类"）；
  3. **分析报告生成**：对 Plugin 执行结果做归纳整理，生成可读的诊断/总结文本（如验证失败原因归因、结果小结）；

- 第9.5节所述的"多流水线扩展"、第10.3节的"翻译文件验证"等均为**面向未来的架构扩展能力示例**，用于说明架构的可扩展性上限，不代表当前阶段必须实现或已经实现；当前只需稳定跑通2-3条固定流水线。

- 换言之：**流程调度权始终在代码（Pipeline定义 + ExecutionEngine）手里，AI 不做工具调用顺序的自主决策**，这是对第2.1节"流程调度权完全由Harness代码接管"原则在多场景架构下的具体落实，而非架构目标的变化。

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

**核心定位**：7B模型是HARNESS的"语义传感器"，负责看和听（语义理解），但"手脚"和"大脑"（流程控制、决策、执行）全是代码。结合本项目实际场景，7B模型的职责进一步收敛为三类具体任务（与第1.2节、第10.7节保持一致）：

1. **简单对话交互**：理解用户自然语言意图、澄清缺失参数，不做多轮复杂推理；
2. **任务分类与推流**：判断一条数据/结果应归入哪个类别、路由到流水线的下一步骤；
3. **分析报告生成**：把 Plugin 的结构化执行结果整理成简明的分析/诊断文本。

超出以上三类的工作（如精确数值计算、多步骤自主规划）一律下沉到代码层完成，不交给模型判断。

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
         
┌─ AI层（7B模型）──────────────────────────────────┐
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

**AI占比：约30%**。代码做文件扫描和格式检查，AI做语义判断和质量评估。

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
1. **角色限定**：不是"翻译专家"，而是"翻译一致性检查器"（缩小行为空间）
2. **输出格式锁定**：给JSON Schema，不让模型自由组织语言
3. **任务单一**：一次Prompt只做一个判断，不堆叠多个任务
4. **Few-shot示例**：给1-2个输入输出示例，7B模型模仿能力强

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

### 11\.5 7B本地模型 vs 云端多Provider模型分工

| 任务类型 | 7B本地模型 | 云端模型（DeepSeek/OpenAI/Anthropic兼容等） |
|----------|------------|--------------------------|
| 简单分类判断 | ✅ 胜任 | ✅ 胜任（浪费） |
| 格式结构化输出 | ✅ 胜任（需严格Prompt） | ✅ 胜任 |
| 复杂语义推理（如文化语境） | ⚠️ 勉强，需人工复核 | ✅ 胜任 |
| 长文本摘要（>2K tokens） | ❌ 容易丢失信息 | ✅ 胜任 |
| 批量处理（100+文件） | ✅ 免费，可并行 | ⚠️ 成本高 |

**推荐策略**：
- **开发调试阶段**：全用7B本地模型，快速迭代
- **批量生产阶段**：简单任务用7B本地模型，复杂语义判断（如翻译质量评分）按需切换云端Provider
- **HARNESS自动路由**：代码根据任务复杂度自动选择模型来源（本地7B为默认，云端为按需切换的可选网关，而非固定必选路径）

```typescript
// 代码自动判断用哪个模型
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
│  │  流程控制 · 数据清洗 · 格式校验 · 文件操作    │  │
│  │  · 异常重试 · 报告生成 · 状态管理            │  │
│  └────────────────────────────────────────────┘  │
│                      ↑↓ 调用                       │
│  ┌────────────────────────────────────────────┐  │
│  │  7B本地模型（语义传感器）                    │  │
│  │  · 简单对话交互                              │  │
│  │  · 任务分类与推流                            │  │
│  │  · 分析报告生成                              │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**一句话总结**：7B模型是HARNESS的"眼睛"和"耳朵"，负责看和听（语义理解），聚焦简单对话、任务推流、分析报告三类轻量任务；但"手脚"和"大脑"（流程控制、决策、执行）全是代码。这样既发挥了AI的语义能力，又规避了小模型的不可靠性。

> （注：部分内容可能由 AI 生成）

---
---

# SLOT Game Vertical AI Harness — System Design Document (English Version)

> This English section is a faithful translation of the Chinese design document above. Both versions describe the same system; where the two ever appear to diverge, the Chinese version above is authoritative, since it is the working document that gets edited first.

## 1. Project Overview & Core Positioning

### 1.1 Project Positioning

This project is a **vertical-domain AI Agent orchestration cockpit (AI Harness) built for SLOT game testing**.

The technical positioning combines what we consider the best patterns in the field:

- **Orchestration kernel**: Absorbs the Hermes-Agent standard Harness engineering philosophy — "strong code constraints, weak AI decision-making, controllable process, traceable execution" — as the core design principle, avoiding the randomness problems of small models.

- **UI form**: Follows the TraeWork minimalist engineering desktop UI design, discarding the redundant features of general-purpose AI platforms, and focusing on efficient execution of the testing pipeline.

- **Business scenario**: A **vertical AI workbench** purpose-built for SLOT game test-data generation, intelligent spreadsheet-data cleaning, automated test-task dispatch, and closed-loop batch testing — not a general-purpose AI chat tool, and not a traditional SaaS business system.

### 1.2 Core Design Goals

- Target a 7B-scale lightweight model (local Ollama by default, with the option to switch to a cloud model of the same or larger scale), enabling a low-cost, offline-capable, highly stable AI testing pipeline;

- Clearly define the AI's scope of responsibility: it only handles the three lightweight semantic tasks a 7B model can reliably do — **simple conversational interaction, task classification/relay (dispatch), and analysis-report generation from execution results** — and does not take on complex multi-step planning, precise numeric computation, or anything else beyond a small model's capability;

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

- **Mechanical, deterministic logic** (data cleaning, deduplication, null checks, format standardization, process ordering): entirely pushed down into the Harness orchestration code + Plugin tool layer;

- **Intelligent semantic logic** (semantic judgment of invalid data, structuring, task-semantic adaptation): handled by the Agent + Skill rule layer;

- **Process/orchestration authority**: entirely owned by the Harness code; the AI is never allowed to autonomously reorder or dynamically alter pipeline steps.

### 2.2 Four-Layer Architecture (standard industrial-grade AI Harness structure)

#### Layer 1: Harness Orchestration Kernel (central layer)

The system's sole commander, analogous to Hermes's core "reins" control capability, entirely code-hardened logic:

- Fixed pipeline orchestration: read spreadsheet → clean data → package task → generate test data;

- Model dispatch management: a built-in unified **multi-gateway model adapter layer** (local Ollama, plus DeepSeek / OpenAI-compatible / Anthropic-compatible cloud Providers), supporting one-click switching of the model source, parameter governance, and cache-strategy scheduling — the multi-gateway design is a deliberate extensibility choice, so that adding more model sources later requires no change to the orchestration layer's code (see Chapter 5 for details);

- End-to-end status control, step checkpoints, exception retries, and trace logging;

- Fixed prompt-prefix concatenation, to preserve cloud KV-cache hit rates and lower the cost of batch runs.

#### Layer 2: Agent Role Layer (decision layer)

A minimal two-Agent split, no redundant roles, adapted to the single SLOT scenario:

- **Data-Cleaning Agent**: responsible for semantic validation of raw Google Sheet test data, dirty-data judgment, and structured/standardized output;

- **Test-Task Adaptation Agent**: packages the cleaned, standardized data into SLOT-test-specific task structures that conform to the generator plugin's input spec.

All Agent capability is defined by local `agent-xxx.md` role files — purely configuration-driven, hot-reloadable, no code changes needed.

#### Layer 3: Skill Rule Layer (capability layer)

Dedicated skill manuals that fix rules and constrain AI behavior, tuned for small-model stability:

- skill-sheet-data-clean: SLOT-test-spreadsheet-specific cleaning, filtering, and standardization rules;

- skill-task-dispatch-rule: SLOT test-task packaging, dispatch, and format-constraint rules;

- skill-generator-plugin-contract: interface contract spec for the test-generation plugin.

Skill files are permanently fixed as the cache prefix, fully reused across local debugging and cloud production.

#### Layer 4: Plugin Local Tool Layer (execution layer)

Pure-code tools that carry all the mechanical, repetitive work and backstop the small model's shortcomings:

- Google Sheet Reader Plugin: handles the spreadsheet API connection, raw-data fetching, and network-exception handling;

- Test-Data Generator Plugin: takes the AI's structured task and batch-generates standardized SLOT-scenario test data;

- Local file, log, and artifact management tool set.

---

## 3. Core Workflow Pipeline (fixed closed loop)

The entire flow is fixed-orchestrated by Harness code, with no AI autonomous decision steps, stably adapted to the local 7B model:

**User triggers task → Harness invokes the Sheet plugin to pull raw data → Harness concatenates the fixed Agent+Skill prefix → local 7B model performs AI semantic cleaning → outputs standardized structured JSON → Harness packages the test task → invokes the generator plugin to produce SLOT test data → the full process is logged/archived, artifacts previewed**

Every process step, execution order, and exception fallback is code-hardened; the AI only takes on lightweight intelligent-judgment work.

---

## 4. UI Design Spec (TraeWork minimalist engineering style)

Fully aligned with the TraeWork desktop Harness minimalist design, discarding WorkBuddy-style general-purpose bloat, tailored to the SLOT-specific testing scenario, visually distinct from traditional SaaS at every level.

### 4.1 Overall Layout: Standard AI-Harness Three-Column Layout

- **Left: resource navigation panel** (a pure AI-resource system, no business menus)

    - Agent role repository (cleaning Agent, task-adaptation Agent);

    - Skill rule library (previewable, enable/disable, view details);

    - Plugin tool set, pipeline configuration;

    - No permission management, no user roles, no business-data menus.

> **Errata (the relationship between Harness login and game-environment login)**: an earlier implementation added a login page and a backend account/role system to the Harness frontend (`server/api/auth_router.py`, `session_manager.py`, etc.), on the assumption that "logging into Harness once would mean never having to log into the real game/admin environment again during testing." Having checked the code, this assumption **does not hold** — Harness's own login state and the real game/admin environment's login state are two completely separate, unconnected systems:
>
> - Harness login (bcrypt password + session token + role) only controls "who can open this internal tool's web page";
> - What actually spares the Selenium-automated browser from having to log into the game/admin environment again is borrowing the tester's **own regular Chrome browser's** already-logged-in user profile directly (see the Chrome-profile-reuse logic in `server/tools/impl/testdata_verifier_tool.py`) — this has nothing to do with the Harness account, and only works when the same local machine has already been manually logged into the game admin panel. When that borrowing fails, the code errors out directly, telling the user to "please log into the admin panel in your regular Chrome browser first" — in other words, logging into the game environment was always a **manual step performed by the tester**; it was never automated.
>
> Since Harness's own login/permission layer **cannot** deliver "no need to log into the game environment again," there is no reason to keep a user-account-and-role system for that purpose — this is consistent with this section's original positioning of "no permission management, no user roles, no business-data menus." The decision is therefore: **remove Harness's own login gate** — open it and use it directly; logging into the real game/admin environment remains something the tester does manually in their own browser as needed, unrelated to Harness — Harness does not do this, and does not claim to.
>
> (Note: this section describes the target state. The current code still retains the login page and backend auth mechanism — `server/api/auth_router.py` / `server/infra/security.py` — which will be removed in a later version to match the positioning described here.)

- **Middle: core execution canvas**

    - Visual display of pipeline nodes;

    - One-click run, single-step debugging, reset capability;

    - Real-time preview of test-data artifacts (a structured JSON view, not a SaaS-style table).

- **Right: log & monitoring panel**

    - Model inference logs, token consumption, inference latency;

    - Plugin tool-call records, input/output parameter logs;

    - Cache-hit statistics, execution-trace timeline, exception alerts.

### 4.2 Visual & Interaction Spec

- Minimalist engineering style: large corner radii, soft shadows, low-saturation tech color palette, no redundant decoration;

- Foregrounds the four AI-Harness-exclusive modules: "workflow, AI reasoning, tool execution, trace logs";

- Removes all traditional SaaS-style dense forms, bulk operations, data filters, and plain CRUD components;

- Comes with AI-specific loading animations, node-transition animations, and tool-call "pulse" effects.

---

## 5. Model Adaptation Strategy (unified multi-gateway design, local 7B as the primary workhorse)

> **Errata**: An earlier version of this document described the model strategy as "only local Ollama 7B + cloud DeepSeek", i.e. two fixed modes. Having confirmed this against the implementation, the multi-Provider gateway at the code layer (supporting Ollama, DeepSeek, OpenAI-compatible, Anthropic-compatible, and custom endpoints all at once) **is a deliberate extensibility design, not a deviation from the original design**. This is hereby corrected: the essence of the model strategy is not "two modes" but "a unified gateway with multiple sources." The local 7B model is the current primary and default option; cloud/other Providers are capability reserved for future expansion, and do not mean the current scenarios require all of them.

### 5.1 Local Ollama 7B Mode (default / development & debugging)

- Capability pushed down: 90% of mechanical rules, process orchestration, and format constraints live in the code layer;

- Model parameters converged: low temperature (0.2–0.3), no free-form generation allowed, standard JSON output enforced;

- The process is kept minimal and fixed, with no complex multi-turn dialogue, to avoid the small model losing context.

- The AI only performs the three lightweight tasks defined in section 1.2 (simple dialogue, task classification/relay, analysis-report generation); it does not perform complex reasoning.

### 5.2 Cloud Multi-Provider Gateway Mode (optional / switched on demand)

- A unified Provider adaptation layer (`plannerProvider.ts` + `llmGateway.ts`) abstracts away the differences between specific cloud vendors, supporting DeepSeek, OpenAI-compatible, Anthropic-compatible, and custom Base-URL endpoints;

- The fixed Agent+Skill prefix is fully reused; switching Provider requires no prompt changes;

- Naturally supports KV caching, substantially lowering token cost for batch test-data generation;

- The existing architecture, process, and UI are preserved, with one-click seamless switching; adding a new cloud Provider only requires one new Preset config entry, with no change to the Harness orchestration-layer code.

### 5.3 Why a Multi-Gateway Design Instead of Hardcoding Two Providers

- **Built for future extensibility, not a current necessity**: the current testing scenarios only require 2–3 fixed workflows (see section 10.7), which the local 7B model already covers on its own; the point of the multi-gateway design is so that changing the model source in the future, or plugging in a customer's own model API, requires no rework of the Harness;

- **Architectural decoupling**: a change in model source only affects the Provider adaptation layer, and has no effect on intent routing, pipeline definitions, the execution engine, or Agent/Skill content — consistent with the "complete decoupling between layers" extensibility principle in Chapter 9;

- **Not general-purpose bloat**: a multi-gateway design does not mean introducing general-purpose AI chat/office capability — after a Provider switch, the AI's scope of responsibility (simple dialogue, task relay, analysis reports) remains unchanged, so this does not violate the "not a general-purpose AI tool" positioning stated in section 1.3.

---

## 6. Directory Structure Spec (industrial-grade standardization)

Designed to support caching strategy, layer decoupling, and long-term iteration:

```Plain Text
slot-ai-harness/
├── agents/                # Agent role definitions (fixed cache prefix)
│   ├── agent-sheet-reader.md
│   └── agent-task-dispatch.md
├── skills/                # Skill rule manuals (fixed cache prefix)
│   ├── skill-sheet-data-clean.md
│   ├── skill-task-dispatch-rule.md
│   └── skill-generator-plugin-contract.md
├── plugins/               # Local tool plugins (pure-code execution layer)
│   ├── google_sheet_reader.py
│   └── testdata_generator.py
├── workflows/             # Fixed pipeline configuration
│   └── slot-test-pipeline.yaml
├── harness/               # Core orchestration engine
│   ├── scheduler.py
│   ├── model_adapter.py
│   └── trace_logger.py
└── frontend/              # TraeWork minimalist desktop UI

```

---

## 7. Summary of Core Advantages (for reporting, review, and archival)

1. **Advanced architecture**: absorbs the Hermes standard Harness engineering kernel, using constrained orchestration to solve the small-model deployment problem, distinct from ordinary Agent frameworks;

2. **Vertical scenario focus**: purpose-built for SLOT game testing with no general-purpose bloat, giving far higher execution efficiency than a general-purpose AI platform;

3. **Authentic form factor**: adopts the TraeWork minimalist engineering desktop UI, a three-column AI-exclusive layout, entirely avoiding a traditional-SaaS look and feel;

4. **Multi-gateway compatible**: primarily free, local 7B-model debugging, supplemented by low-cost batch production via multiple cloud Providers (DeepSeek/OpenAI/Anthropic-compatible, etc.) — one architecture serves the whole R&D lifecycle, with room reserved for future expansion;

5. **Engineering assets accumulate**: the Agent/Skill/Plugin layered decoupling means testing capability can be reused, iterated on, and standardized over time.

---

## 8. Final Project Positioning (official standard messaging)

This system is a **vertical-domain AI-agent orchestration cockpit that absorbs the Hermes Harness orchestration-kernel philosophy, adopts the TraeWork minimalist engineering desktop UI, and is purpose-built for the SLOT game testing scenario**. Relying on a layered Agent, standardized Skill rules, localized Plugin tools, and a constraint-based Harness orchestration engine, it uses a 7B-scale model (local Ollama as the primary, multi-gateway cloud Providers as an extension) to stably handle lightweight semantic tasks — simple dialogue, task classification/relay, and analysis-report generation — while pre-designed fixed workflows (Agent+Skill+Plugin combinations) drive the full closed loop of intelligent test-data cleaning, automated task dispatch, and batch test-data generation. It is a lightweight, highly-focused, engineering-grade vertical AI testing workbench, distinct from general-purpose AI office tools and traditional SaaS business systems.

---

## 9. Future Extensibility Design (system iteration roadmap)

This SLOT AI Harness architecture is **inherently built for horizontal expansion, pluggable capability, and scenario iteration** — it is not limited to a single "TestData generation and verification" capability. The entire layered design fully follows the industrial-grade Harness standard of **pluggability, decoupling, and extensibility**, so that a full suite of SLOT game automated-testing capability can be layered on at low cost later, with no need to rearchitect the underlying system or tear down the existing UI and orchestration logic.

This chapter details: **how to add a new plugin, a new Agent skill, a new test pipeline, or a new business module**.

### 9.1 Core Extensibility Principle: The Four-Layer Architecture Fully Supports Pluggable Iteration

The biggest advantage of the current four-layer architecture: **layers are fully decoupled from each other; new capability is purely additive, and never requires touching existing code**

- **Harness orchestration layer**: supports new pipeline nodes, new execution chains, new orchestration modes, and natively supports multiple workflows coexisting;

- **Agent role layer**: supports adding specialized intelligent roles and multi-Agent collaboration, with no changes needed to the existing cleaning/generation Agent logic;

- **Skill layer**: skill files can be stacked without limit, with rules groupable, reusable, and scenario-specific;

- **Plugin layer**: fully pluggable design — a new tool just registers itself and can be invoked by the Harness orchestration, with zero intrusion into existing code.

👉 **All expansion is purely additive; existing stable functionality is never affected**.

### 9.2 Plugin Expansion (the most core, most flexible expansion method)

Currently only implemented: the spreadsheet-reader plugin and the test-data-generator plugin.
Going forward, an unlimited number of SLOT game testing plugins can be added, all **plug-and-play**:

#### Expandable Plugin List (SLOT-specific)

- **SLOT numeric-validation plugin**: multiplier validation, probability validation, random-value distribution compliance validation;

- **Level/story testing plugin**: batch generation and validity verification of multi-scenario story data;

- **Exception test-case generation plugin**: automatic construction of boundary values, invalid parameters, and exception scenarios;

- **Automated report-export plugin**: test coverage, data-compliance reports, batch execution reports;

- **Local log-analysis plugin**: parsing game runtime logs, exception localization, error clustering;

- **Version-comparison plugin**: diffing test data across old/new versions, change-risk identification.

**Expansion rule**: adding a new plugin only requires dropping it into the `plugins/` directory and registering it with the Harness orchestration entry point, after which it appears, runs, and can be included in a pipeline on the frontend canvas.

### 9.3 Agent Role Expansion (multi-agent collaborative iteration)

The current dual-Agent architecture can smoothly expand into a **multi-Agent collaborative testing cluster**:

- **Review/Validation Agent**: dedicated to reviewing test-data validity, flagging defects, and suggesting auto-corrections;

- **Scenario-Decomposition Agent**: automatically decomposes test scenarios based on SLOT gameplay and auto-assigns test cases;

- **Risk-Inspection Agent**: batch-scans test data for latent risk, probability anomalies, and logical flaws;

- **Report-Summary Agent**: automatically generates a test summary, issue roundup, and iteration recommendations based on the execution trace.

Any new Agent only requires adding a new `agents/*.md` file; the Harness auto-loads it and the frontend auto-displays the resource.

### 9.4 Continued Accumulation of the Skill Library (capability as an asset)

As the business iterates, a SLOT-specific test-skill library can continue to accumulate:

- SLOT probability-compliance judgment skill

- SLOT multiplier-overflow validation skill

- Game-specific special-feature data-validation skill

- Boundary-scenario intelligent-recognition skill

Skills accumulate permanently, are reusable and composable, and form a project-specific AI test knowledge base.

### 9.5 Workflow/Pipeline Expansion (from a single flow → multiple scenario pipelines)

Currently there is only a single "data cleaning → generation" base pipeline; going forward, multiple independent closed-loop pipelines can be added:

- Fast smoke-test pipeline (lightweight, rapid validation)

- Full-batch regression-test pipeline (large-scale production)

- Exception-scenario dedicated test pipeline

- Version-iteration comparison test pipeline

The frontend canvas can support: **switching between multiple pipelines, running them independently, and isolating logs per pipeline**.

### 9.6 UI Expansion Capability (the TraeWork minimalist architecture supports unlimited module stacking)

The current three-column layout is a **standard, extensible canvas**:

- The left resource panel automatically adapts to newly added Agents/Skills/Plugins;

- The middle canvas supports new nodes and new process templates;

- The right log panel supports adding specialized monitoring (validation statistics, coverage statistics, risk statistics).

The UI needs no rearchitecting — only incremental new feature modules — and always stays minimalist and efficient, never becoming bloated SaaS.

### 9.7 Model Capability Expansion

- Supports seamlessly upgrading to a 14B/32B local large model later, for stronger semantic reasoning;

- Supports connecting to multiple cloud model vendors, with automatic best-choice scheduling;

- Supports fine-tuned model integration, to continuously optimize domain-specific capability for the SLOT scenario.

### 9.8 Final Expansion Conclusion (for external reporting)

This SLOT AI Harness **is not a one-off fixed tool, but a sustainably growing AI-testing engineering system**.

It currently only completes the minimal closed loop of "basic data generation and verification." Relying on the Hermes-style layered constraint architecture and pluggable design, it can, in the future, be expanded — **with zero rearchitecting, at low cost, and incrementally** — into a full-site SLOT game AI automated-testing platform covering "data generation, intelligent validation, exception testing, regression testing, risk inspection, and automated reporting," with very strong long-term engineering extensibility and business-iteration capability.

---

## 10. HARNESS Framework Extension Design (multi-scenario pipeline architecture)

### 10.1 Analysis of the Current Architecture's Limitations

The existing HARNESS uses a **single hardcoded pipeline** pattern:

```
Fixed flow: user input → PlannerAgent(stage1) → testdata_parser → testdata_generator → zip_packager
```

**Problem**: adding a new test scenario (e.g. translation-file verification, numeric validation) requires modifying code, the prompt, and the frontend's stage enum — true pluggable expansion is not possible.

### 10.2 Upgrading the Three Core HARNESS Modules

Upgrading HARNESS from a "single-pipeline dispatcher" into a "multi-scenario traffic-control center":

#### Module One: Intent Router

**Responsibility**: parse the user's natural-language input, match it to a test scenario, and automatically load the corresponding Agent+Skill+Pipeline+Plugin combination.

```typescript
interface TestScenario {
  id: string;                    // Unique scenario identifier
  label: string;                 // Frontend display name
  keywords: string[];            // Keyword-matching rules
  agentFile: string;             // Corresponding Agent .md file
  skills: string[];              // List of required Skill files
  pipeline: string;              // Pipeline ID
  requiredPlugins: string[];     // List of dependent Plugins
}

const SCENARIOS: TestScenario[] = [
  {
    id: "testdata_generation",
    label: "TestData Generation",
    keywords: ["testdata", "generate", "paytable", "sheet"],
    agentFile: "testdata_generator_agent.md",
    skills: ["skill-sheet-data-clean.md"],
    pipeline: "testdata-gen-pipeline",
    requiredPlugins: ["testdata_parser", "testdata_generator", "zip_packager"],
  },
  {
    id: "translation_verification",
    label: "Translation File Verification",
    keywords: ["translation", "translation", "multilingual", "localization"],
    agentFile: "translation_verifier_agent.md",
    skills: ["skill-translation-check.md"],
    pipeline: "translation-verify-pipeline",
    requiredPlugins: ["file_scanner", "translation_checker"],
  },
  {
    id: "game_verification",
    label: "Game Environment Verification",
    keywords: ["verify", "verify", "game", "spin"],
    agentFile: "testdata_verifier_agent.md",
    skills: [],
    pipeline: "game-verify-pipeline",
    requiredPlugins: ["game_verifier", "log_diagnoser"],
  },
];
```

**Routing strategy**: keyword rule-matching + explicit user selection as a double safeguard — routing does not rely on the AI to make the decision (avoiding small-model unreliability).

#### Module Two: Pipeline Orchestrator

**Responsibility**: declaratively define each scenario's execution steps, dependency relationships, and exception-handling strategy.

```typescript
interface PipelineStep {
  id: string;
  plugin: string;              // Name of the Plugin to invoke
  label: string;               // Frontend display name
  dependsOn: string[];         // Preceding steps this depends on
  retryOnFail: boolean;        // Whether to retry on failure
  maxRetries: number;
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStep[][];    // 2D array: outer = stages (sequential), inner = parallel steps
}

const PIPELINES: Record<string, Pipeline> = {
  "testdata-gen-pipeline": {
    id: "testdata-gen-pipeline",
    name: "TestData Generation Pipeline",
    stages: [
      [{ id: "parse", plugin: "testdata_parser", label: "Parse spreadsheet data", dependsOn: [], retryOnFail: true, maxRetries: 2 }],
      [{ id: "generate", plugin: "testdata_generator", label: "Generate test data", dependsOn: ["parse"], retryOnFail: true, maxRetries: 2 }],
      [{ id: "package", plugin: "zip_packager", label: "Package artifact", dependsOn: ["generate"], retryOnFail: false, maxRetries: 1 }],
    ],
  },
  "translation-verify-pipeline": {
    id: "translation-verify-pipeline",
    name: "Translation Verification Pipeline",
    stages: [
      [{ id: "scan", plugin: "file_scanner", label: "Scan translation files", dependsOn: [], retryOnFail: true, maxRetries: 1 }],
      [{ id: "check", plugin: "translation_checker", label: "Verify translations file by file", dependsOn: ["scan"], retryOnFail: false, maxRetries: 1 }],
      [{ id: "report", plugin: "report_generator", label: "Generate diff report", dependsOn: ["check"], retryOnFail: false, maxRetries: 1 }],
    ],
  },
};
```

#### Module Three: Execution Engine + State Machine

**Responsibility**: execute step by step according to the pipeline definition, manage state transitions, and handle exceptions.

```
Execution engine (code-controlled, AI not involved):
  for each stage in pipeline.stages:
    for each step in stage:
      1. Check whether all preceding dependency steps have completed
      2. Invoke the corresponding Plugin
      3. Record the execution result into the state machine
      4. On failure → retry or escalate

AI Agent (only performs semantic judgment):
  - Parse user input → structured parameters
  - Judge whether the Plugin's returned result is reasonable
  - Generate a diagnostic report
```

### 10.3 Full Example of Adding a New Test Scenario: Translation File Verification (an architectural-extensibility example, not a currently implemented scenario)

> Note: the "translation file verification" scenario in this section is a **hypothetical example** used to illustrate the upper bound of the architecture's extensibility. The project currently only needs to cover the 2–3 fixed scenarios of TestData generation, game-environment verification, and log diagnosis/EasyHelp checking (see section 10.7) — this example scenario has not been implemented.

**User request**: "Verify that the game name Phoenix5 is translated correctly across 33 translation files"

```
┌─ HARNESS Intent Router ─────────────────────────
│  Matched keyword "translation" → scenario: translation_verification │
│  Loaded Agent: translation_verifier_agent.md          │
│  Loaded Skill: skill-translation-check.md             │
│  Loaded Pipeline: translation-verify-pipeline         │
│  Checked Plugins: file_scanner, translation_checker     │
──────────────────────────────────────────────────┘
         ↓
┌─ Pipeline Execution ─────────────────────────────
│  Stage 1: file_scanner                            │
│    → Scan all 33 translation files in the specified directory │
│    → Extract the translated text corresponding to "Phoenix5" in each file │
│    → Output: [{file: "zh-CN.json", value: "凤凰5"},  │
│             {file: "ja-JP.json", value: "フェニックス5"}, ...] │
│                                                    │
│  Stage 2: translation_checker                      │
│    → AI judges whether each translation is reasonable (semantic check) │
│    → Checks terminology consistency and format compliance │
│    → Output: pass/fail + reason                        │
│                                                    │
│  Stage 3: report_generator                         │
│    → Aggregates the results, generates a diff report                           │
│    → Output: JSON report + frontend visualization                     │
└──────────────────────────────────────────────────┘
```

### 10.4 Frontend Adaptation Plan

The left navigation panel upgrades to a **scenario selector**:

```
Sidebar:
├── Test Scenarios (new)
│   ├── TestData Generation
│   ├── Translation File Verification
│   ├── Game Environment Verification
│   └── ... (added in the future)
├── Plugin
├── 🤖 Agents
└── 📋 Task List
```

The user first picks a scenario, then enters a specific task description. HARNESS automatically loads the corresponding Agent/Skill/Pipeline/Plugin combination based on the scenario.

### 10.5 HARNESS Directory Structure Upgrade

```
src/harness/
├── intentRouter.ts        # Intent routing (scenario matching)
├── pipelineRegistry.ts    # Pipeline definitions (declarative)
├── executionEngine.ts     # Execution engine (state machine + step scheduling)
├── plannerAgent.ts        # AI Agent (semantic reasoning only, no longer controls process)
├── plannerProvider.ts     # LLM call adapter
├── client.ts              # Backend API client
└── sharedTypes.ts         # Type definitions
```

### 10.6 Key Design Principles

| Principle | Explanation |
|------|------|
| **Scenario-driven, not process-driven** | The user picks a scenario → HARNESS auto-assembles Agent+Skill+Pipeline+Plugin, rather than requiring the user to understand the process steps |
| **Declarative pipeline definitions** | Adding a new test type only requires adding one entry in `pipelineRegistry.ts` + writing the corresponding Plugin, with no change to the execution-engine code |
| **AI does only semantics, code does the process** | The Agent no longer decides "which tool to call next" — it only judges "is this translation result reasonable." The process is hard-controlled by the `executionEngine` code |
| **Plug-and-play Plugins** | Each new test capability = one Plugin file, registered with the `ToolRegistry` and immediately callable by any pipeline |
| **Configuration-driven Agent/Skill** | Adding a new scenario only requires adding a `.md` file, no code changes |

### 10.7 Clarification of the Current Workflow Scope (fixed-workflow-driven, not AI-autonomous orchestration)

**Current actual requirement**: at this stage, the project only needs to cover **2–3 fixed test scenarios** (TestData Generation, Game Environment Verification, Log Diagnosis/EasyHelp File Checking) — it does not need to support an unlimited, open-ended combination of scenarios. Each scenario corresponds to one **pre-designed, fixed Pipeline** (an Agent + Skill + Plugin combination), declared in `pipelineRegistry.ts` / `intentRouter.ts` — this combination is fixed before runtime, and is never decided by the AI on the fly.

**Key clarification of the execution model**:

- The Harness's **Execution Engine** invokes Plugins step by step, in the stage order declared by the Pipeline; the AI **does not participate in the decision of "which tool to call next"** — this is 100% hardcoded by code (the Pipeline definition + the execution engine);

- The AI (a 7B model) only plays a role at the semantic-judgment nodes inside the pipeline, and specifically does exactly three things (echoing the scope of responsibility in section 1.2):
  1. **Simple conversational interaction**: clarifying intent with the user, asking follow-up questions about missing parameters;
  2. **Task relay/dispatch**: classifying/routing parsed structured data, pushing it to the next step as the scenario requires (e.g. "which test category does this row of data belong to");
  3. **Analysis-report generation**: summarizing a Plugin's execution results into readable diagnostic/summary text (e.g. root-cause attribution for a verification failure, a results summary);

- The "multi-pipeline expansion" described in section 9.5 and the "translation file verification" example in section 10.3 are both **architectural-extensibility examples aimed at the future**, used to illustrate the upper bound of the architecture's extensibility — they do not represent something that must be, or has been, implemented at the current stage. Currently, only 2–3 fixed pipelines need to run stably.

- In other words: **process-orchestration authority always stays with the code (the Pipeline definitions + the ExecutionEngine); the AI never autonomously decides the order of tool invocations**. This is the concrete implementation, under the multi-scenario architecture, of the principle in section 2.1 that "process-orchestration authority is entirely owned by the Harness code" — not a change to the architecture's goals.

---

## 11. Local/Cloud AI Model (7B-scale) Functional Positioning & Usage Spec

### 11.1 7B Model Capability Boundaries

| Good at | Not good at |
|--------|--------|
| Understanding the meaning of a piece of natural language | Remembering a very long context (easily lost beyond ~4K tokens) |
| Judging whether text A and text B are semantically consistent | Complex multi-step logical reasoning |
| Outputting JSON per a fixed template | Format tends to drift when given free rein |
| Extracting structured information from text | Math computation, precise numeric comparison |
| Recognizing obvious translation errors | Subtle cultural/contextual nuance |

**Core positioning**: the 7B model is HARNESS's "semantic sensor" — responsible for looking and listening (semantic understanding) — while the "hands, feet, and brain" (process control, decision-making, execution) are entirely code. Given this project's actual scenarios, the 7B model's responsibility is further narrowed to three concrete tasks (consistent with sections 1.2 and 10.7):

1. **Simple conversational interaction**: understanding the user's natural-language intent, clarifying missing parameters, without complex multi-turn reasoning;
2. **Task classification & relay**: judging which category a piece of data/a result belongs to, and routing it to the next pipeline step;
3. **Analysis-report generation**: turning a Plugin's structured execution result into concise analysis/diagnostic text.

Anything beyond these three categories (e.g. precise numeric computation, autonomous multi-step planning) is always pushed down to the code layer — never left to the model's judgment.

### 11.2 The AI's Specific Responsibility at Each Step

#### Scenario 1: TestData Generation (existing)

```
┌─ Code layer (HARNESS execution engine) ─────────────────────────┐
│  1. Read the raw Google Sheet text                        │
│  2. Extract the Module ID via regex: /Module\s*ID\s*(\d+)/        │
│  3. Clean Batch/Index via regex: /^\d+,\d+$/                    │
│  4. Group into files per rule (Regular Wins / Big Wins / ...)    │
│  5. Generate the XML structure (code-template concatenation)                       │
│  6. Package the ZIP                                          │
└────────────────────────────────────────────────────
         ↑ All of this is code; the AI is not involved
         
┌─ AI layer (7B model) ──────────────────────────────────┐
│  Input: user's natural language + a raw Sheet text snippet               │
│  Task: judge which category a given row of data belongs to                         │
│  Prompt: "Which category does the following data belong to? [Regular/BigWin/Bonus] │
│         Data: {row_content}"                          │
│  Output: {"category": "Regular Wins"}                   │
│                                                      │
│  Input: cleaned, structured data                              │
│  Task: check the data's reasonableness (e.g. is the batch abnormally large)             │
│  Output: {"valid": true, "note": ""}                    │
└────────────────────────────────────────────────────┘
```

**AI share: ~10%.** 90% of the mechanical work is done by code; the AI only performs classification judgment and anomaly detection.

#### Scenario 2: Translation File Verification (added — architectural example, see 10.3/10.7)

```
┌─ Code layer (HARNESS execution engine) ─────────────────────────┐
│  1. Scan all .json/.xml translation files in the directory                  │
│  2. Regex-extract the translated value for "Phoenix5" in each file           │
│  3. Build a comparison table: {file: "zh-CN.json", value: "凤凰5"}  │
│  4. Check format compliance (encoding, special characters, length limits)            │
│  5. Compute the pass rate, generate a report skeleton                            │
└────────────────────────────────────────────────────┘

┌─ AI layer (7B model) ──────────────────────────────────┐
│                                                      │
│  Task A: semantic-consistency judgment                                │
│  Input: [{lang: "zh-CN", value: "凤凰5"},             │
│         {lang: "ja-JP", value: "フェニックス5"},     │
│         {lang: "ko-KR", value: "피닉스5"}]           │
│  Prompt: "Do all of the following translations refer to the same game name 'Phoenix5'?    │
│         Output JSON: {consistent: bool, issues: []}"    │
│  Output: {"consistent": true, "issues": []}             │
│                                                      │
│  Task B: translation-quality assessment                                  │
│  Input: {lang: "de-DE", value: "Phönix Fünf"}         │
│  Prompt: "Does this German translation accurately convey the meaning of 'Phoenix5'? │
│         Score 1–5, and give a reason"                             │
│  Output: {"score": 4, "reason": "Fünf is German for 5,       │
│          but game names typically keep the original text or a transliteration"}                    │
│                                                      │
│  Task C: terminology-consistency check                                │
│  Input: the list of all translated values across the 33 files                      │
│  Prompt: "Check whether there is inconsistent terminology usage in the following translation list"      │
│  Output: {"inconsistencies": [                          │
│    {file: "fr-FR.json", issue: "Used 'Phoenix Cinq'  │
│     instead of 'Phoenix 5' — the number should stay as an Arabic numeral"}            │
│  ]}                                                    │
────────────────────────────────────────────────────┘
```

**AI share: ~30%.** Code does the file scanning and format checking; the AI does the semantic judgment and quality assessment.

### 11.3 Key Points of 7B-Model Prompt Design

Because the model is small, the prompt must be **extremely converged/constrained**:

```typescript
// ❌ Wrong: letting the model improvise freely
const badPrompt = `
  You are a translation expert. Please check the quality of these translation files...
  (The model may output an arbitrary format, or even start chatting)
`;

// ✅ Correct: enforce structured output
const goodPrompt = `
  You are a translation-consistency checker.
  
  Input: the list of translated values for "Phoenix5" across 33 translation files
  
  Task: determine whether there is any inconsistent translation
  
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
1. **Role constraint**: not "a translation expert," but "a translation-consistency checker" (narrows the behavior space)
2. **Locked output format**: give it a JSON schema; don't let the model freely compose prose
3. **Single task per prompt**: one prompt makes exactly one judgment; don't stack multiple tasks together
4. **Few-shot examples**: give 1–2 input/output examples; a 7B model imitates well

### 11.4 Code-Level Fallback Strategy

```typescript
// harness/executionEngine.ts
async function runTranslationCheck(files: TranslationFile[]) {
  // 1. Code does the deterministic work
  const extracted = files.map(f => ({
    file: f.name,
    value: f.content.match(/"Phoenix5":\s*"([^"]+)"/)?.[1] ?? "",
  }));
  
  // 2. AI does the semantic judgment
  const aiResult = await callLocalLLM({
    prompt: buildConsistencyCheckPrompt(extracted),
    temperature: 0.2,  // Low temperature, reduces randomness
    maxTokens: 500,    // Caps output length
  });
  
  // 3. Code validates the AI's output format
  let parsed: CheckResult;
  try {
    parsed = JSON.parse(aiResult);
    if (!('consistent' in parsed)) throw new Error("format error");
  } catch {
    // AI output format error → retry once
    aiResult = await callLocalLLM({ ...retryPrompt });
    parsed = JSON.parse(aiResult);  // If it fails again, escalate the exception
  }
  
  // 4. Code makes the final decision
  const report = {
    totalFiles: files.length,
    aiJudgment: parsed,
    autoFixable: parsed.issues.filter(i => isAutoFixable(i)),  // Code judges whether it can be auto-fixed
    manualReview: parsed.issues.filter(i => !isAutoFixable(i)),
  };
  
  return report;
}
```

**Fallback strategy**:
- AI output format error → automatically retry once
- AI judgment is self-contradictory (e.g. says consistent=true but issues is non-empty) → code flags it as "needs manual review"
- AI times out/fails → degrade to a pure rule-based check (code regex matching)

### 11.5 Division of Labor: 7B Local Model vs. Cloud Multi-Provider Models

| Task type | 7B local model | Cloud model (DeepSeek/OpenAI/Anthropic-compatible, etc.) |
|----------|------------|--------------------------|
| Simple classification judgment | ✅ Capable | ✅ Capable (but wasteful) |
| Structured format output | ✅ Capable (needs a strict prompt) | ✅ Capable |
| Complex semantic reasoning (e.g. cultural context) | ⚠️ Marginal, needs manual review | ✅ Capable |
| Long-text summarization (>2K tokens) | ❌ Easily loses information | ✅ Capable |
| Batch processing (100+ files) | ✅ Free, can run in parallel | ⚠️ Costly |

**Recommended strategy**:
- **Development/debugging phase**: use the 7B local model exclusively, for rapid iteration
- **Batch production phase**: use the 7B local model for simple tasks, switch to a cloud Provider as needed for complex semantic judgment (e.g. translation-quality scoring)
- **HARNESS auto-routing**: code automatically selects the model source based on task complexity (local 7B is the default; cloud is an optional gateway switched to on demand, not a fixed, mandatory path)

```typescript
// Code automatically decides which model to use
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
│  │  Process control · data cleaning · format validation · file ops    │  │
│  │  · exception retries · report generation · state management            │  │
│  └────────────────────────────────────────────┘  │
│                      ↑↓ calls                       │
│  ┌────────────────────────────────────────────┐  │
│  │  7B local model (semantic sensor)                    │  │
│  │  · Simple conversational interaction                              │  │
│  │  · Task classification & relay                            │  │
│  │  · Analysis-report generation                              │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**One-line summary**: the 7B model is HARNESS's "eyes" and "ears" — responsible for looking and listening (semantic understanding), focused on the three lightweight tasks of simple dialogue, task relay, and analysis reporting; but the "hands, feet, and brain" (process control, decision-making, execution) are entirely code. This approach makes use of the AI's semantic capability while avoiding the unreliability of a small model.

> (Note: some content may have been generated by AI.)
