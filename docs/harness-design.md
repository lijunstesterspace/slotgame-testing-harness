
# AI HARNESS Architecture Upgrade Design Spec (P0–P2)

> Date: 2026-08-18
> Project: `testdata-tool-main` (slot machine test data generation + verification toolkit)
> Goal: Upgrade the existing "special-purpose tools + simulated Agent UI" into the core of an internal company AI HARNESS platform that is "extensible, multi-user, and compliant with confidentiality requirements".

---

## 1. Design Principles and Constraints

### 1.1 Non-Functional Constraints (Mandatory)

| Constraint | Source | Implementation |
|---|---|---|
| 🔒 Confidentiality compliance: only local Ollama small models may be used by default | Company confidentiality agreement | LLM Provider is locked to Local Ollama by default; other Providers are grayed out in the UI and require a manual compliance-confirmation checkbox |
| 🧩 Proof of extensibility: the UI/code must demonstrate multi-Provider integration | Project charter requirement | `LlmConfigModal` fully implements four Providers (Ollama/OpenAI/Anthropic/Custom) + health checks + SSE streaming |
| 🖥️ Multiple users access it via a server link | User deployment requirement | FastAPI back end + statically hosted front end, all on a single Nginx server |
| 🪟 Double-click launch on Windows (for local development) | User delivery preference | `start-dev.cmd` launches two processes: Vite + FastAPI |
| Start lightweight at Level A, with interfaces that upgrade smoothly to Level B | User requirement | The serial execution queue is abstracted as `ExecutionQueue`, implemented first as `SerialExecutionQueue`; replacing it later with `RedisParallelExecutionQueue` does not change the interface |

### 1.2 Architecture Layering Principles

Each layer depends only on the layer below it; reverse dependencies are strictly forbidden:
```
L5  Presentation (React UI)       → Interacts with the back end only through HarnessClient
L4  API Gateway (FastAPI Routes)  → HTTP semantics / parameter validation / permission guards / SSE wrapping
L3  Application Services          → Agent Runtime / ToolRegistry / ExecutionQueue / SessionMgr
L2  Tool Plugin layer             → ToolPlugin interface + concrete implementations (MCP-compatible)
L1  Infrastructure                → Storage / ProcessRunner / Security / Logger / Config
```

---

## 2. Directory Structure

```
testdata-tool-main/
├── server/                              ← 🆕 FastAPI back end
│   ├── main.py                          ← 🆕 FastAPI entry point (launched by uvicorn)
│   ├── requirements.txt                 ← 🆕 fastapi / uvicorn / pydantic / aiofiles / bcrypt / python-multipart
│   ├── config.py                        ← 🆕 Settings (.env + environment variables)
│   ├── start-server.cmd                 ← 🆕 Double-click to launch the back end on Windows
│   ├── api/
│   │   ├── __init__.py
│   │   ├── auth_router.py               ← 🆕 /api/auth/* (login + me)
│   │   ├── tools_router.py              ← 🆕 /api/tools/list, /api/tools/execute, /api/tools/execute-async
│   │   ├── executions_router.py         ← 🆕 /api/executions/stream/{id}, /mine, /{id}, /audit-llm
│   │   └── records_router.py            ← 🆕 /api/records/{id}/outcome.zip, /mine
│   ├── services/
│   │   ├── __init__.py
│   │   ├── execution_queue.py           ← 🆕 ExecutionQueue abstraction + serial implementation
│   │   └── session_manager.py           ← 🆕 Session CRUD
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── base.py                      ← 🆕 ToolPlugin interface + ToolRegistry + MCP-compatible structures
│   │   └── impl/
│   │       ├── __init__.py
│   │       ├── testdata_generator_tool.py    ← 🆕 Wraps generate_testdata.py (process_runner)
│   │       ├── game_verifier_tool.py         ← 🆕 Wraps verify_testdata.py (process_runner + Selenium)
│   │       ├── zip_packager_tool.py          ← 🆕 Multi-file ZIP packaging (back-end version)
│   │       ├── testdata_parser_tool.py       ← 🆕 Parses CSV / Google Sheet exported text
│   │       └── log_diagnoser_tool.py         ← 🆕 Rule-engine diagnosis (diagnosis-type enum matching)
│   ├── infra/
│   │   ├── __init__.py
│   │   ├── storage.py                   ← 🆕 SQLite wrapper (SQLAlchemy interface reserved for switching to PG)
│   │   ├── process_runner.py            ← 🆕 asyncio subprocess runner (streams stdout/stderr)
│   │   ├── security.py                  ← 🆕 Password hashing (bcrypt) + simple RBAC decorator
│   │   └── logger.py                    ← 🆕 structlog structured logging
│   └── data/                            ← 🆕 (generated at runtime, not committed)
│       └── harness.db
│
├── src/                                 ← React front end (refactor of existing code)
│   ├── harness/                         ← 🆕 Front-end HARNESS SDK
│   │   ├── client.ts                    ← 🆕 HarnessClient (REST + SSE)
│   │   ├── sharedTypes.ts               ← 🆕 DTOs shared by front end and back end (ToolInfo / ExecutionEvent, etc.)
│   │   ├── plannerAgent.ts              ← 🆕 Planner Provider + ReAct loop (all LLM calls in the front end)
│   │   └── plannerProvider.ts           ← 🆕 Planner abstraction: LocalOllama / OpenAI / Anthropic / Custom
│   ├── components/
│   │   ├── AgentCore.tsx                ← Modified: hooked up to plannerAgent, no longer simulated with setInterval
│   │   ├── IntentPanel.tsx               ← Modified: triggers plannerAgent.run()
│   │   ├── VerificationPanel.tsx        ← Modified: calls back-end async execute
│   │   ├── LlmConfigModal.tsx           ← Modified: four-Provider UI + compliance-confirmation checkbox + local storage
│   │   └── Header.tsx                   ← Modified: adds login status display
│   ├── pages/                           ← 🆕 Login page
│   │   └── LoginPage.tsx
│   ├── utils/
│   │   ├── llmGateway.ts                ← Kept and enhanced: full SSE streaming for all four Providers (used directly by PlannerProvider)
│   │   ├── zipGenerator.ts              ← Kept: pure front-end ZIP (the back end has one too; they complement each other)
│   │   ├── ollamaClient.ts              ← 🗑️ Deleted: functionality merged into llmGateway
│   │   ├── paytableSheetParser.ts       ← Kept but deprecated: implemented in the back end; the front end only does preview parsing
│   │   ├── logVisionDiagnoser.ts        ← Kept: front-end rule matching
│   │   ├── verificationEngine.ts        ← Modified: now only calls back-end REST/SSE, no longer fetches the game URL directly
│   │   └── urlParser.ts                 ← Kept
│   ├── mock/testData.ts                 ← Modified: fetches from the back end or keeps the default demo
│   ├── types/index.ts                   ← Modified: deduplicated; domain types kept, HarnessClient types moved to harness/sharedTypes
│   ├── App.tsx                          ← Refactored: hooked up to auth guard + plannerAgent + HarnessClient
│   └── main.tsx                         ← Minor change: adds React Context wrapping
│
├── generate_testdata.py                 ← Kept (script is invoked by the back-end process_runner)
├── verify_testdata.py                   ← Kept (same as above)
├── start-dev.cmd                        ← Modified: launches Vite (3000) + FastAPI (8000) together
├── start-dev-debug.cmd                  ← Modified: same as above + logging enabled
├── healthcheck.cmd                      ← Modified: checks both Vite 3000 + FastAPI 8000
├── .env.example                         ← 🆕 Back-end configuration example (passwords/admin/session duration)
└── .gitignore                           ← Modified: adds harness.db, .env, server/__pycache__
```

---

## 3. P0 Core: Tool Plugin Layer (MCP-Compatible Interface)

### 3.1 Interface Definition (server/tools/base.py)

```python
from pydantic import BaseModel, Field
from typing import Any, Optional
from abc import ABC, abstractmethod

# --- Tool Meta (compatible with MCP tools/list response) ----
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

# --- Tool Result (compatible with MCP content) --------------
class ToolResult(BaseModel):
    success: bool
    content: Any = None            # Structured return value (dict recommended)
    error: Optional[str] = None
    execution_ms: int = 0
    artifacts: list[str] = []      # Paths relative to storage (downloadable)

# --- Execution context (unique per call) --------------------
class HarnessContext(BaseModel):
    execution_id: str
    user_id: str
    user_role: str                 # tester / admin
    session_token: str
    work_dir: str                  # Sandbox temp directory (cleaned up after use)

# --- ToolPlugin interface -----------------------------------
class ToolPlugin(ABC):
    @property
    @abstractmethod
    def info(self) -> ToolInfo: ...

    @abstractmethod
    async def execute(self, params: dict[str, Any], context: HarnessContext) -> ToolResult: ...

# --- ToolRegistry (singleton) -------------------------------
class ToolRegistry:
    def __init__(self): self._plugins: dict[str, ToolPlugin] = {}
    def register(self, plugin: ToolPlugin) -> None: ...
    def list_info(self) -> list[ToolInfo]: ...
    def get(self, name: str) -> ToolPlugin: ...
    def as_function_calling_schema(self) -> list[dict]: ...   # Format for LLM Function Calling
```

### 3.2 P0 Initial Set of 5 Built-In Tools

| Tool Name | Function | Corresponding Existing Implementation |
|---|---|---|
| `testdata_parser` | Parses CSV / pasted text → structured records + fileMap | Logic of `src/utils/paytableSheetParser.ts` rewritten in Python |
| `testdata_generator` | Given a list of records → writes .testdata XML files to the sandbox directory | Wraps the core logic of `generate_testdata.py` |
| `zip_packager` | Packs .testdata + manifest.json → ZIP artifact | Back-end counterpart of `src/utils/zipGenerator.ts` |
| `game_verifier` | Given a .testdata file + game URL → runs Selenium verification + HTML report + screenshots | Wraps `verify_testdata.py` |
| `log_diagnoser` | Given a list of verification results → diagnosis enum (SHEET_DATA_ERROR / INDEX_OOB / RENDER_BUG / SERVER_ERR) | Corresponds to the rules in `src/utils/logVisionDiagnoser.ts` |

---

## 4. P0 Core: Planner Agent (Front-End ReAct Loop, All LLM Calls in the Front End)

### 4.1 Confidentiality-Compliant Planner Provider

All LLM calls originate from the front-end browser (Ollama goes through `localhost:11434`; external Providers are also called directly from the browser against their official APIs, with the Key stored only in localStorage).

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

// Four implementations:
export class LocalOllamaPlanner  implements PlannerProvider { ... }  // /ollama or http://localhost:11434
export class OpenAIPlanner        implements PlannerProvider { ... }  // https://api.openai.com/v1
export class AnthropicPlanner     implements PlannerProvider { ... }  // https://api.anthropic.com/v1
export class CustomPlanner        implements PlannerProvider { ... }  // Custom baseUrl
```

### 4.2 Planner Agent ReAct Loop

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
    private readonly harness: HarnessClient,   // Calls back-end /api/tools/execute
    private readonly callbacks: PlannerAgentCallbacks,
  ) {}

  /**
   * Runs a full ReAct loop for one intent:
   *   LLM thinks → picks tool + params → POST /api/tools/execute → observes result → thinks again
   *   until the LLM outputs <task_complete /> or maxCycles is exceeded
   */
  async run(userIntent: {
    prompt: string;
    sheetUrl?: string;
    loginName: string;
    workflowStage: 1 | 2;
  }, maxCycles = 10): Promise<{ success: boolean; executionId: string | null }> {
    // 1. Fetch the tool list from the back end (MCP-format schema)
    const tools = await this.harness.tools.list();

    // 2. Assemble the system prompt:
    //    - Your role (Generator Agent / Verifier Agent, chosen by stage)
    //    - Tool schema (JSON)
    //    - Call format: <tool_call><name>xxx</name><params>{json}</params></tool_call>
    //    - Completion format: <task_complete />
    //    - Confidentiality notice (Ollama by default)

    // 3. Loop up to maxCycles:
    //    a. provider.streamChat(messages, onChunk=write THOUGHT)
    //    b. Parse the LLM's final output: match <tool_call> or <task_complete />
    //    c. Call the tool → this.harness.tools.execute(name, params)
    //    d. Append the ToolResult back into messages as an observation
  }
}
```

### 4.3 Function Calling Fallback Strategy for Small Models
1. First try to parse the `<tool_call><name>…</name><params>{json}</params></tool_call>` XML tags;
2. If that fails, try to extract `TOOL: xxx {json}` from the text with a regex;
3. If that also fails, self-heal: emit a `SELF_HEAL` log + ask the LLM to re-output a properly formatted call.

---

## 5. L4 API Protocol (Hybrid REST + SSE)

### 5.1 Login and Sessions

**POST /api/auth/login**
```json
Request:  { "username": "qa-zhang", "password": "plaintext-bcrypt-on-server" }
Response: { "session_token": "tok_abc", "user": { "id": "u_1", "username": "qa-zhang", "role": "tester" } }
```
- Header for subsequent requests: `Authorization: Bearer <session_token>`

**GET /api/auth/me** → Returns the current user or 401.

### 5.2 Tools
**GET /api/tools/list** → `[ToolInfo, ...]`

**POST /api/tools/execute**  (synchronous, short tasks <30s)
```json
Request:  { "tool_name": "testdata_generator", "params": { ... } }
Response: ToolResult
```

**POST /api/tools/execute-async**  (long tasks such as Selenium verification)
```json
Request:  { "tool_name": "game_verifier", "params": { ... }, "execution_id": "exe_xxx" }
Response: { "ok": true, "execution_id": "exe_xxx" }
```

### 5.3 Execution History and Streaming

**GET /api/executions/stream/{execution_id}**  —  **SSE event stream**
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
**GET /api/executions/{id}**  → Details + artifact list (downloadable URLs)
**GET /api/records/{id}/outcome.zip**  → Download the ZIP
**POST /api/executions/audit-llm** → `{ provider, model, tokens_in, tokens_out, duration_ms, success }` (metadata only; no prompt/content)

---

## 6. L1 Storage: SQLite Schema (server/infra/storage.py)

```sql
-- Users & sessions
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'tester',
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_ip TEXT
);

-- Executions
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

-- TestData records
CREATE TABLE test_records (
  id TEXT PRIMARY KEY, execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id), case_name TEXT NOT NULL,
  format_type TEXT NOT NULL, module_id TEXT NOT NULL,
  base_batch INTEGER NOT NULL, base_index INTEGER NOT NULL,
  bonus_batch INTEGER, bonus_index INTEGER, file_name TEXT,
  xml_snippet TEXT NOT NULL, created_at INTEGER NOT NULL
);

-- LLM call audit (no content)
CREATE TABLE llm_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, success INTEGER NOT NULL
);
```

**Smooth upgrade note**: All SQL is encapsulated in `Storage` class methods; switching to PostgreSQL in the future only requires swapping the implementation, and the Service layer is unaware of it.

---

## 7. P1: Tool Plugin → Python Script Bridge (process_runner.py)

For tools backed by "existing mature Python scripts", such as Selenium verification and generate_testdata.py:

```python
# server/infra/process_runner.py
class ProcessRunner:
    async def run(
        self,
        cmd: list[str],            # e.g. ['python', 'generate_testdata.py', '-m', '105359', '-f', 'input.txt']
        work_dir: Path,
        timeout_sec: int = 120,
        on_stdout: Callable[[str], None] | None = None,  # Writes to SSE in real time
    ) -> CompletedProcess:
        # asyncio.create_subprocess_exec, stdout=PIPE pushed to SSE line by line
        # stderr merged into the log
        # Timeout → SIGTERM → SIGKILL after 2s
```

Sandbox policy: each execution uses `server/data/runs/{execution_id}/` as its working directory; artifacts are cleaned up 24 hours after archiving.

---

## 8. P2: Upgrading Workflows from Hard-Coded to DAG (Prototype)

In P0, workflow_stage 1 / 2 is fixed, but the Service-layer interface is defined as a DAG:

```python
# Conceptual interface: hard-coded implementation in P0; opened up in P2
class WorkflowStep(BaseModel):
    id: str
    tool_name: str
    params_template: dict    # Supports {{ previous_step.output.xxx }} variable interpolation
    condition: str | None    # "step_a.result.success == true"

class Workflow(BaseModel):
    name: str                # e.g. "stage1_generate", "stage2_verify"
    steps: list[WorkflowStep]
```

In P0, `WorkflowService` calls tools directly step by step; in P2, Workflows can be customized via UI drag-and-drop or JSON.

---

## 9. Key UI Changes (React)

### 9.1 New Login Page
- `LoginPage.tsx`: username + password → POST `/api/auth/login` → store token in `sessionStorage` → redirect to the main UI
- Any page access without a token redirects to login

### 9.2 LlmConfigModal (Core UI for Demonstrating Extensibility)
Four Provider tabs:
  - **Local Ollama (default)**: baseUrl defaults to `http://localhost:11434`; shows a health-check indicator + model dropdown
  - **OpenAI**: grayed out + requires checking `⚠️ I confirm that using an external model complies with the company confidentiality agreement` → enables the baseUrl and apiKey inputs
  - **Anthropic**: same as above
  - **Custom**: same as above

Storage location: `localStorage['harness_llm_config_v1']` (labeled "visible on this machine only, not uploaded to the back end")

### 9.3 AgentCore.tsx Changes
- Remove the `setInterval`-driven simulated log progression;
- Instead, subscribe to the callbacks of `plannerAgent.run()` and append logs in real time;
- `tasks` progress is driven by the planner agent based on actual tool calls, not a fixed 4 steps.

### 9.4 App.tsx Changes
- Hook up AuthContext;
- Use HarnessClient for all back-end calls;
- Add React Contexts: `AuthContext` + `PlannerContext`.

---

## 10. Launch Scripts (Windows Double-Click)

**start-dev.cmd logic after the change:**
```
1. Check node.exe → if missing, prompt to install via winget (same as current)
2. Check python.exe → if missing, prompt to install Python 3.11+ via winget
3. npm ci (only when node_modules is missing)
4. pip install -r server/requirements.txt (only on first run or when changed)
5. Start in background: uvicorn server.main:app --port 8000
6. Start in foreground: npm run dev (Vite 3000)
7. Automatically open http://localhost:3000
```

**Production deployment (single server):**
```
Nginx (443 / company domain)
 ├── /                 →  serve -s dist (React build)
 └── /api              →  proxy_pass http://127.0.0.1:8000
uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 2
```

---

## 11. Acceptance Checklist for This Upgrade (P0–P2)

| # | Acceptance Item | Phase |
|---|---|---|
| P0-1 | `ToolPlugin` interface + `ToolRegistry`; the initial 5 tools can be registered/listed/invoked | P0 |
| P0-2 | `PlannerAgent` + 4 Providers (Ollama/OpenAI/Anthropic/Custom) fully implemented; health checks work; SSE streaming works | P0 |
| P0-3 | Real Planner Agent ReAct loop: Ollama outputs tool_call → back end executes → ToolResult fed back → next round of thinking → task_complete | P0 |
| P0-4 | LlmConfigModal UI: four Provider tabs + "compliance confirmation" checkbox required for external models + local storage + health indicator | P0 |
| P1-1 | All 5 FastAPI router modules working (auth/tools/executions/records) | P1 |
| P1-2 | `process_runner` bridges `generate_testdata.py` + `verify_testdata.py`; full Stage 1 + Stage 2 can be run from the UI | P1 |
| P1-3 | Simple password login + Session, persisted to back-end SQLite, @require_role guard | P1 |
| P1-4 | Front-end LoginPage + Auth Guard; redirect when not logged in | P1 |
| P2-1 | Execution history is traceable: /api/executions/mine + front-end history list + re-run button | P2 |
| P2-2 | `WorkflowStage` upgraded from hard-coded to a `Workflow` descriptor object (two built-in first: stage1 / stage2) | P2 |
| P2-3 | Shared front-end/back-end DTOs (sharedTypes.ts + pydantic) aligned; no drift in tool interfaces, log events, or table schemas | P2 |
| P2-4 | LLM audit persisted (provider/model/tokens/duration) without any prompt/response content | P2 |
| P2-5 | `start-dev.cmd` can launch Vite + FastAPI + automatically open the browser on Windows with a plain double-click | P2 |
