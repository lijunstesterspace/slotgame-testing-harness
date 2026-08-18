
# AI HARNESS 架构升级设计 Spec (P0–P2)

> 日期：2026-08-18
> 适用项目：`testdata-tool-main`（老虎机测试数据生成 + 验证工具集）
> 目标：把现有「专用工具 + 模拟 Agent UI」升级为「可扩展、可多人使用、符合保密要求」的公司内部 AI HARNESS 平台内核。

---

## 1. 设计原则与约束

### 1.1 非功能性约束（必须满足）

| 约束 | 来源 | 实现方式 |
|---|---|---|
| 🔒 保密合规：默认只能使用本地 Ollama 小模型 | 公司保密协议 | LLM Provider 默认锁定 Local Ollama；其他 Provider UI 灰显，需人工勾选合规确认 |
| 🧩 可扩展性证明：必须在 UI/代码中展示多 Provider 接入能力 | 本项目立项要求 | `LlmConfigModal` 完整实现 Ollama/OpenAI/Anthropic/Custom 四套 Provider + 健康检测 + SSE 流式 |
| 🖥️ 多人通过服务器链接使用 | 用户部署要求 | 后端 FastAPI + 前端静态托管，Nginx 一台搞定 |
| 🪟 Windows 双击启动（本地开发时） | 用户交付偏好 | `start-dev.cmd` 启动 Vite + FastAPI 双进程 |
| A 级轻量起步，接口可平滑升级到 B 级 | 用户要求 | 串行执行队列抽象为 `ExecutionQueue`，实现先 `SerialExecutionQueue`；未来替换 `RedisParallelExecutionQueue` 不换接口 |

### 1.2 架构分层原则

每层只依赖下层，严禁反向依赖：
```
L5  Presentation (React UI)       → 只通过 HarnessClient 与后端交互
L4  API Gateway (FastAPI Routes)  → HTTP 语义 / 参数校验 / 权限守卫 / SSE 包装
L3  Application Services          → Agent Runtime / ToolRegistry / ExecutionQueue / SessionMgr
L2  Tool Plugin 层                → ToolPlugin 接口 + 具体实现（MCP 兼容）
L1  Infrastructure                → Storage / ProcessRunner / Security / Logger / Config
```

---

## 2. 目录结构

```
testdata-tool-main/
├── server/                              ← 🆕 FastAPI 后端
│   ├── main.py                          ← 🆕 FastAPI 入口 (uvicorn 启动)
│   ├── requirements.txt                 ← 🆕 fastapi / uvicorn / pydantic / aiofiles / bcrypt / python-multipart
│   ├── config.py                        ← 🆕 Settings (.env + 环境变量)
│   ├── start-server.cmd                 ← 🆕 Windows 双击启动后端
│   ├── api/
│   │   ├── __init__.py
│   │   ├── auth_router.py               ← 🆕 /api/auth/* (login + me)
│   │   ├── tools_router.py              ← 🆕 /api/tools/list, /api/tools/execute, /api/tools/execute-async
│   │   ├── executions_router.py         ← 🆕 /api/executions/stream/{id}, /mine, /{id}, /audit-llm
│   │   └── records_router.py            ← 🆕 /api/records/{id}/outcome.zip, /mine
│   ├── services/
│   │   ├── __init__.py
│   │   ├── execution_queue.py           ← 🆕 ExecutionQueue 抽象 + 串行实现
│   │   └── session_manager.py           ← 🆕 Session CRUD
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── base.py                      ← 🆕 ToolPlugin 接口 + ToolRegistry + MCP 兼容结构
│   │   └── impl/
│   │       ├── __init__.py
│   │       ├── testdata_generator_tool.py    ← 🆕 封装 generate_testdata.py (process_runner)
│   │       ├── game_verifier_tool.py         ← 🆕 封装 verify_testdata.py (process_runner + Selenium)
│   │       ├── zip_packager_tool.py          ← 🆕 多文件 ZIP 打包（后端版）
│   │       ├── paytable_parser_tool.py       ← 🆕 解析 CSV / Google Sheet 导出文本
│   │       └── log_diagnoser_tool.py         ← 🆕 规则引擎诊断（诊断类型枚举匹配）
│   ├── infra/
│   │   ├── __init__.py
│   │   ├── storage.py                   ← 🆕 SQLite 封装（预留 SQLAlchemy 接口切 PG）
│   │   ├── process_runner.py            ← 🆕 asyncio subprocess runner (stdout/stderr 流式)
│   │   ├── security.py                  ← 🆕 口令 hash (bcrypt) + 简单 RBAC 装饰器
│   │   └── logger.py                    ← 🆕 structlog 结构化日志
│   └── data/                            ← 🆕 (运行时生成，不入库)
│       └── harness.db
│
├── src/                                 ← React 前端（现有代码重构）
│   ├── harness/                         ← 🆕 前端 HARNESS SDK
│   │   ├── client.ts                    ← 🆕 HarnessClient (REST + SSE)
│   │   ├── sharedTypes.ts               ← 🆕 前后端共享 DTO（ToolInfo / ExecutionEvent 等）
│   │   ├── plannerAgent.ts              ← 🆕 Planner Provider + ReAct 循环 (LLM 全在前端)
│   │   └── plannerProvider.ts           ← 🆕 Planner 抽象：LocalOllama / OpenAI / Anthropic / Custom
│   ├── components/
│   │   ├── AgentCore.tsx                ← 修改：接入 plannerAgent，不再用 setInterval 模拟
│   │   ├── IntentPanel.tsx               ← 修改：触发 plannerAgent.run()
│   │   ├── VerificationPanel.tsx        ← 修改：调用后端 async execute
│   │   ├── LlmConfigModal.tsx           ← 修改：四 Provider UI + 合规确认勾选 + 本地存储
│   │   └── Header.tsx                   ← 修改：加入登录状态显示
│   ├── pages/                           ← 🆕 登录页
│   │   └── LoginPage.tsx
│   ├── utils/
│   │   ├── llmGateway.ts                ← 保留并增强：四 Provider 完整 SSE 流式（PlannerProvider 直接用）
│   │   ├── zipGenerator.ts              ← 保留：纯前端 ZIP（后端也有一份，互补）
│   │   ├── ollamaClient.ts              ← 🗑️ 删除：功能合并到 llmGateway
│   │   ├── paytableSheetParser.ts       ← 保留但 deprecated：后端已实现，前端仅做预览解析
│   │   ├── logVisionDiagnoser.ts        ← 保留：前端规则匹配
│   │   ├── verificationEngine.ts        ← 修改：现在仅调后端 REST/SSE，不直接 fetch 游戏 URL
│   │   └── urlParser.ts                 ← 保留
│   ├── mock/testData.ts                 ← 修改：改为从后端拉取或保留默认 demo
│   ├── types/index.ts                   ← 修改：去重，领域类型保留，HarnessClient 的移到 harness/sharedTypes
│   ├── App.tsx                          ← 重构：接入 auth guard + plannerAgent + HarnessClient
│   └── main.tsx                         ← 小幅修改：加 React Context 包装
│
├── generate_testdata.py                 ← 保留（脚本被后端 process_runner 调用）
├── verify_testdata.py                   ← 保留（同上）
├── start-dev.cmd                        ← 修改：同时启动 Vite (3000) + FastAPI (8000)
├── start-dev-debug.cmd                  ← 修改：同上 + 开日志
├── healthcheck.cmd                      ← 修改：同时检查 Vite 3000 + FastAPI 8000
├── .env.example                         ← 🆕 后端配置示例 (口令/管理员/会话时长)
└── .gitignore                           ← 修改：加 harness.db, .env, server/__pycache__
```

---

## 3. P0 核心：Tool Plugin 层（MCP 兼容接口）

### 3.1 接口定义（server/tools/base.py）

```python
from pydantic import BaseModel, Field
from typing import Any, Optional
from abc import ABC, abstractmethod

# --- Tool Meta (MCP tools/list 响应兼容) --------------------
class ToolParameter(BaseModel):
    name: str
    type: str = "string"           # string / number / boolean / object / array
    description: str = ""
    required: bool = False
    default: Any = None
    enum: Optional[list[Any]] = None

class ToolInputSchema(BaseModel):
    properties: list[ToolParameter]

class ToolInfo(BaseModel):
    name: str
    description: str
    inputSchema: ToolInputSchema
    permissions: list[str] = []    # ["filesystem:write", "selenium", "network:outbound"]
    timeout_seconds: int = 60
    version: str = "1.0.0"

# --- Tool Result (MCP content 兼容) -------------------------
class ToolResult(BaseModel):
    success: bool
    content: Any = None            # 结构化返回（推荐 dict）
    error: Optional[str] = None
    execution_ms: int = 0
    artifacts: list[str] = []      # 相对 storage 的路径（可下载）

# --- 执行上下文（每个调用唯一） ------------------------------
class HarnessContext(BaseModel):
    execution_id: str
    user_id: str
    user_role: str                 # tester / admin
    session_token: str
    work_dir: str                  # 沙箱临时目录（用完清理）

# --- ToolPlugin 接口 ----------------------------------------
class ToolPlugin(ABC):
    @property
    @abstractmethod
    def info(self) -> ToolInfo: ...

    @abstractmethod
    async def execute(self, params: dict[str, Any], context: HarnessContext) -> ToolResult: ...

# --- ToolRegistry（单例） -----------------------------------
class ToolRegistry:
    def __init__(self): self._plugins: dict[str, ToolPlugin] = {}
    def register(self, plugin: ToolPlugin) -> None: ...
    def list_info(self) -> list[ToolInfo]: ...
    def get(self, name: str) -> ToolPlugin: ...
    def as_function_calling_schema(self) -> list[dict]: ...   # 给 LLM Function Call 的格式
```

### 3.2 P0 首批内置 5 个工具

| Tool Name | 功能 | 对应现有实现 |
|---|---|---|
| `paytable_parser` | 解析 CSV / 粘贴文本 → 结构化 records + fileMap | `src/utils/paytableSheetParser.ts` 逻辑改写 Python |
| `testdata_generator` | 给定 records 列表 → 写 .testdata XML 文件到沙箱目录 | 封装 `generate_testdata.py` 核心逻辑 |
| `zip_packager` | 把 .testdata + manifest.json → ZIP 产物 | 对应 `src/utils/zipGenerator.ts` 后端版 |
| `game_verifier` | 给定 .testdata 文件 + 游戏 URL → Selenium 跑验证 + HTML 报告 + 截图 | 封装 `verify_testdata.py` |
| `log_diagnoser` | 给定验证结果列表 → 诊断枚举（SHEET_DATA_ERROR / INDEX_OOB / RENDER_BUG / SERVER_ERR） | 对应 `src/utils/logVisionDiagnoser.ts` 规则 |

---

## 4. P0 核心：Planner Agent（前端 ReAct 循环，LLM 全在前端）

### 4.1 保密合规的 Planner Provider

所有 LLM 调用都从前端浏览器发出（Ollama 走 `localhost:11434`；外部 Provider 也从浏览器直连官网 API，Key 仅存 localStorage）。

```typescript
// src/harness/plannerProvider.ts
export interface PlannerProvider {
  readonly type: 'ollama' | 'openai' | 'anthropic' | 'custom';
  readonly name: string;

  healthCheck(): Promise<{ online: boolean; models: string[]; latencyMs: number }>;

  streamChat(
    messages: ChatMessage[],
    onChunk: (tokenText: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

// 四种实现：
export class LocalOllamaPlanner  implements PlannerProvider { ... }  // /ollama or http://localhost:11434
export class OpenAIPlanner        implements PlannerProvider { ... }  // https://api.openai.com/v1
export class AnthropicPlanner     implements PlannerProvider { ... }  // https://api.anthropic.com/v1
export class CustomPlanner        implements PlannerProvider { ... }  // 自定义 baseUrl
```

### 4.2 Planner Agent ReAct 循环

```typescript
// src/harness/plannerAgent.ts
export interface PlannerAgentCallbacks {
  onThought: (content: string) => void;
  onToolCall: (toolName: string, params: Record<string, any>) => void;
  onToolResult: (toolName: string, resultSnippet: string, ok: boolean) => void;
  onSelfHeal: (content: string) => void;
  onHarnessEvent: (content: string) => void;
}

export class PlannerAgent {
  constructor(
    private readonly provider: PlannerProvider,
    private readonly harness: HarnessClient,   // 调后端 /api/tools/execute
    private readonly callbacks: PlannerAgentCallbacks,
  ) {}

  /**
   * 跑一个完整意图的 ReAct 循环：
   *   LLM 思考 → 选工具+参数 → POST /api/tools/execute → 观察结果 → 再思考
   *   直到 LLM 输出 <task_complete /> 或超过 maxCycles
   */
  async run(userIntent: {
    prompt: string;
    sheetUrl?: string;
    loginName: string;
    workflowStage: 1 | 2;
  }, maxCycles = 10): Promise<{ success: boolean; executionId: string | null }> {
    // 1. 从后端拉工具列表（MCP 格式 schema）
    const tools = await this.harness.tools.list();

    // 2. 组装 system prompt：
    //    - 你的角色（Generator Agent / Verifier Agent 按阶段选）
    //    - 工具 schema (JSON)
    //    - 调用格式：<tool_call><name>xxx</name><params>{json}</params></tool_call>
    //    - 完成格式：<task_complete />
    //    - 保密提示（默认 Ollama）

    // 3. 循环 maxCycles：
    //    a. provider.streamChat(messages, onChunk=写 THOUGHT)
    //    b. 解析 LLM 最终输出：匹配 <tool_call> 或 <task_complete />
    //    c. 调 tool → this.harness.tools.execute(name, params)
    //    d. 把 ToolResult 拼回 messages 作为 observation
  }
}
```

### 4.3 小模型 Function Calling 降级策略
1. 先尝试解析 `<tool_call><name>…</name><params>{json}</params></tool_call>` XML 标签；
2. 失败则尝试从文本中用正则提取 `TOOL: xxx {json}`；
3. 再失败则 self-heal：抛 `SELF_HEAL` 日志 + 让 LLM 重新输出格式化的调用。

---

## 5. L4 API 协议（REST + SSE 混合）

### 5.1 登录与会话

**POST /api/auth/login**
```json
Request:  { "username": "qa-zhang", "password": "plaintext-bcrypt-on-server" }
Response: { "session_token": "tok_abc", "user": { "id": "u_1", "username": "qa-zhang", "role": "tester" } }
```
- 后续请求 Header: `Authorization: Bearer <session_token>`

**GET /api/auth/me** → 返回当前用户或 401。

### 5.2 工具
**GET /api/tools/list** → `[ToolInfo, ...]`

**POST /api/tools/execute**  (同步，<30s 短任务)
```json
Request:  { "tool_name": "testdata_generator", "params": { ... } }
Response: ToolResult
```

**POST /api/tools/execute-async**  (长任务如 Selenium 验证)
```json
Request:  { "tool_name": "game_verifier", "params": { ... }, "execution_id": "exe_xxx" }
Response: { "ok": true, "execution_id": "exe_xxx" }
```

### 5.3 执行历史与流式

**GET /api/executions/stream/{execution_id}**  —  **SSE 事件流**
```
event: harness_event
data: { "type": "THOUGHT",     "timestamp": "..", "content": "...", "status": "running" }

event: harness_event
data: { "type": "TOOL_CALL",   "toolName": "testdata_generator", "content": "{...}", "status": "running" }

event: harness_event
data: { "type": "TOOL_RES",    "toolName": "...", "content": "...", "status": "success" }

event: harness_event
data: { "type": "SELF_HEAL",   "content": "...", "status": "warning" }

event: harness_event
data: { "type": "HARNESS_EVENT", "content": "..." }

event: done
data: { "success": true, "execution_id": "exe_xxx", "total_ms": 8432 }
```

**GET /api/executions/mine?page=1&size=20**
**GET /api/executions/{id}**  → 详情 + 产物列表（可下载的 URL）
**GET /api/records/{id}/outcome.zip**  → 下载 ZIP
**POST /api/executions/audit-llm** → `{ provider, model, tokens_in, tokens_out, duration_ms, success }` (纯元数据，不包含 prompt/内容)

---

## 6. L1 存储：SQLite 表结构（server/infra/storage.py）

```sql
-- 用户 & 会话
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'tester',
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_ip TEXT
);

-- 执行
CREATE TABLE executions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, intent TEXT NOT NULL,
  workflow_stage INTEGER NOT NULL, status TEXT NOT NULL,
  llm_provider TEXT, llm_model TEXT,
  llm_tokens_in INTEGER DEFAULT 0, llm_tokens_out INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  total_ms INTEGER DEFAULT 0, error_message TEXT
);
CREATE INDEX idx_executions_user ON executions(user_id, started_at DESC);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL, params_json TEXT NOT NULL,
  success INTEGER NOT NULL, result_snippet TEXT, artifacts_json TEXT,
  started_at INTEGER NOT NULL, execution_ms INTEGER DEFAULT 0, error_message TEXT
);

-- TestData 记录
CREATE TABLE test_records (
  id TEXT PRIMARY KEY, execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id), case_name TEXT NOT NULL,
  format_type TEXT NOT NULL, module_id TEXT NOT NULL,
  base_batch INTEGER NOT NULL, base_index INTEGER NOT NULL,
  bonus_batch INTEGER, bonus_index INTEGER, file_name TEXT,
  xml_snippet TEXT NOT NULL, created_at INTEGER NOT NULL
);

-- LLM 调用审计（无内容）
CREATE TABLE llm_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, success INTEGER NOT NULL
);
```

**平滑升级提示**：所有 SQL 封装在 `Storage` 类方法里，未来改 PostgreSQL 只需换实现，Service 层不感知。

---

## 7. P1：Tool Plugin → Python 脚本桥接（process_runner.py）

对于 Selenium 验证、generate_testdata.py 这种「已有成熟 Python 脚本」的工具：

```python
# server/infra/process_runner.py
class ProcessRunner:
    async def run(
        self,
        cmd: list[str],            # e.g. ['python', 'generate_testdata.py', '-m', '105359', '-f', 'input.txt']
        work_dir: Path,
        timeout_sec: int = 120,
        on_stdout: Callable[[str], None] | None = None,  # 实时写 SSE
    ) -> CompletedProcess:
        # asyncio.create_subprocess_exec，stdout=PIPE 按行推 SSE
        # stderr 合并到日志
        # 超时 → SIGTERM → 2s 后 SIGKILL
```

沙箱策略：每次 execution → `server/data/runs/{execution_id}/` 作为工作目录；产物归档后 24 小时清理。

---

## 8. P2：工作流从硬编码升级为 DAG（雏形）

P0 阶段 workflow_stage 1 / 2 是固定的，但 Service 层接口按 DAG 定义：

```python
# 概念接口，P0 先硬编码实现；P2 放开
class WorkflowStep(BaseModel):
    id: str
    tool_name: str
    params_template: dict    # 支持 {{ previous_step.output.xxx }} 变量插值
    condition: str | None    # "step_a.result.success == true"

class Workflow(BaseModel):
    name: str                # e.g. "stage1_generate", "stage2_verify"
    steps: list[WorkflowStep]
```

P0 时 `WorkflowService` 直接按步骤调用 tools；P2 时允许 UI 拖拽或 JSON 自定义 Workflow。

---

## 9. UI 改造重点（React）

### 9.1 新增登录页
- `LoginPage.tsx`：用户名 + 密码 → POST `/api/auth/login` → token 存 `sessionStorage` → 跳转主界面
- 无 token 的任何页面访问都重定向到登录

### 9.2 LlmConfigModal（证明可扩展性的核心 UI）
四个 Provider Tab：
  - **Local Ollama（默认）**：baseUrl 默认为 `http://localhost:11434`，显示健康检测灯 + 模型下拉
  - **OpenAI**：灰显 + 需勾选 `⚠️ 我已确认使用外部模型符合公司保密协议` → 激活 baseUrl 和 apiKey 输入
  - **Anthropic**：同上
  - **Custom**：同上

保存位置：`localStorage['harness_llm_config_v1']`（标注「仅本机可见，不上传后端」）

### 9.3 AgentCore.tsx 改造
- 删掉 `setInterval` 的模拟日志推进；
- 改为订阅 `plannerAgent.run()` 的 callbacks 实时追加日志；
- `tasks` 任务进度由 planner agent 按实际 tool 调用推进，不是固定 4 步。

### 9.4 App.tsx 改造
- 接入 AuthContext；
- 用 HarnessClient 做所有后端调用；
- 新增 React Context：`AuthContext` + `PlannerContext`。

---

## 10. 启动脚本（Windows 双击）

**start-dev.cmd 改造后逻辑：**
```
1. 检查 node.exe → 无则提示 winget 安装（和现有一致）
2. 检查 python.exe → 无则提示 winget 安装 Python 3.11+
3. npm ci（仅 node_modules 缺失时）
4. pip install -r server/requirements.txt（仅首次或变更时）
5. 后台启动：uvicorn server.main:app --port 8000
6. 前台启动：npm run dev (Vite 3000)
7. 自动打开 http://localhost:3000
```

**生产部署形态（一台服务器）：**
```
Nginx (443 / 公司域名)
 ├── /                 →  serve -s dist (React build)
 └── /api              →  proxy_pass http://127.0.0.1:8000
uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 2
```

---

## 11. 本次升级范围（P0–P2）验收清单

| # | 验收项 | 所属 |
|---|---|---|
| P0-1 | `ToolPlugin` 接口 + `ToolRegistry`，首批 5 个工具可注册/列出/调用 | P0 |
| P0-2 | `PlannerAgent` + 4 Provider（Ollama/OpenAI/Anthropic/Custom）完整实现，健康检测可用，SSE 流式正常 | P0 |
| P0-3 | Planner Agent 真实 ReAct 循环：Ollama 输出 tool_call → 后端执行 → ToolResult 回填 → 下一轮思考 → task_complete | P0 |
| P0-4 | LlmConfigModal UI：四 Provider Tab + 外部模型需「合规确认」复选框 + 本地存储 + 健康灯 | P0 |
| P1-1 | FastAPI 5 个路由模块全部可用（auth/tools/executions/records） | P1 |
| P1-2 | `process_runner` 桥接 `generate_testdata.py` + `verify_testdata.py`，可从 UI 跑完整 Stage 1 + Stage 2 | P1 |
| P1-3 | 简单口令登录 + Session，后端 SQLite 落库，@require_role 守卫 | P1 |
| P1-4 | 前端 LoginPage + Auth Guard，未登录重定向 | P1 |
| P2-1 | 执行历史可回溯：/api/executions/mine + 前端历史列表 + 重跑按钮 | P2 |
| P2-2 | `WorkflowStage` 从硬编码升级为 `Workflow` 描述对象（先内置两套：stage1 / stage2） | P2 |
| P2-3 | 前后端共享 DTO (sharedTypes.ts + pydantic) 对齐，工具接口、日志事件、表结构无漂移 | P2 |
| P2-4 | LLM 审计落库（provider/model/tokens/时长）不含任何 prompt/response 内容 | P2 |
| P2-5 | `start-dev.cmd` 可在 Windows 纯双击启动 Vite + FastAPI + 自动打开浏览器 | P2 |
