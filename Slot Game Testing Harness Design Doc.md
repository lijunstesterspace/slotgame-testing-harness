# Slot Game Testing Harness Design Doc

> **Language**: English only. The earlier Chinese version of this document was removed on 2026-10-08 (company repositories must be in English); this English text is now the single authoritative version.

> **Synced with code at**: `d5fc203` (2026-10-28). Every feature commit should update this document in the same PR; doc-only catch-up revisions go on the `docs/design-doc-sync` branch (see `CLAUDE.md`).

> **Revision note (2026-10-28, incremental code-aligned revision)**
>
> Re-checked against `main` at commit `d5fc203` (2 commits after `5e95502`). Main changes:
>
> - TestData Verification now has **three** methods: `harness` (default), `api`, and the new **`local`** ("Local link (all files)") backed by the new `testdata_verifier_local` Plugin, which uploads and plays each .testdata file in turn through a locally served game launch URL, so one account can verify a whole folder; it shares the `_Run` helper with `testdata_verifier_harness`;
> - The Harness and Local link methods accept an **account keyword + count**: files in name order are verified as `keyword1`, `keyword2`, ... (Axiom's "Bulk Create Multiple Accounts" naming), each in its own session; an account that cannot log in fails only its own file (`LOGIN_FAILED`);
> - The Plugin count stays at **15** (the Layer 4 table, 10.2 addendum, 12.3 cancellation and directory structure were updated); `harness.cmd` now calls `npm` rather than `npm.cmd`.

> **Revision note (2026-10-27, incremental code-aligned revision)**
>
> Re-checked against `main` at commit `5e95502` (23 commits after the previous baseline `6c03e2a`), same "code is the source of truth" principle. Main changes:
>
> - Plugins: **15** registered (new `helpfile_report`); the EasyHelp pipeline is now **4 stages** (convert → compare → report → optional AI analyze), and `PipelineStepDef` gained an `optional` flag the engine honors;
> - `testdata_verifier_harness` now drives the browser with **Playwright** through the new `server/game_session/` layer (not Selenium), accepts either a Titan Harness launcher URL or a direct game launch URL, and stops cooperatively on cancel; Selenium page drivers moved to `selenium_page_drivers.py`;
> - `helpfile_analyzer` now uses the model picked in the UI when the active Provider is Ollama;
> - UI (EasyHelp review panel), directory structure, API list (`/api/tools/stage-local-files`), artifact locations and Chapter 13 were updated accordingly.

> **Revision note (2026-10-08, full code-aligned revision)**
>
> This revision re-checks every section against the current code (baseline: `main` branch, commit `6c03e2a`) on the principle that **"the code is the source of truth"**: wherever the document and the code disagreed, the document has been rewritten to match the code; vision content that has not landed yet is kept but explicitly marked "planned / not implemented". Main changes:
>
> - Scenarios and pipelines: corrected from "2–3 scenarios" to the **4 registered scenarios / 4 pipelines** (TestData Generation, TestData Verification, EasyHelp Checking, Portugal Plugin Verification); "log diagnosis" is no longer a standalone scenario and is now part of the verification report;
> - **The TestData Verification scenario does not go through ExecutionEngine** — `verificationEngine.ts` drives one of two verification methods directly (the Titan Harness method by default), see 10.2 / 10.7;
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

Pure-code tools, implemented in Python as `server/tools/impl/*_tool.py`, all subclassing `ToolPlugin` (MCP-compatible name / description / inputSchema), registered in `BUILTIN_TOOLS` in `server/tools/impl/__init__.py`, and loaded into `ToolRegistry` at backend startup. There are currently 15:

| Scenario | Plugins |
|---|---|
| TestData Generation | `testdata_parser` (parses pasted sheet text), `testdata_generator` (writes .testdata XML), `zip_packager` (ZIP + manifest) |
| TestData Verification | `testdata_verifier_harness` (default; real browser via Playwright through `server/game_session/`, entered through the Titan Harness launcher or a direct game launch URL), `testdata_verifier_api` (direct game HTTP APIs, no browser), `testdata_verifier_local` (Playwright on a locally served game launch URL; uploads and plays one file at a time, so one account covers a whole folder), `log_diagnoser` (rule-based failure attribution) |
| EasyHelp Checking | `html_to_text_converter`, `diff_comparator` (with keyword highlighting and Excel output), `helpfile_report` (deterministic `helpfile_report.html` / `.json`, no AI), `helpfile_analyzer` (optional; calls local Ollama server-side to analyze that report) |
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
| EasyHelp Checking | ExecutionEngine | `html_to_text_converter` → `diff_comparator` → `helpfile_report` → `helpfile_analyzer` (optional: a failure only warns, the stage-3 report is kept) |
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
    - **TestDataPreview**: shown only after TestData Generation completes, with XML preview and ZIP download;
    - **EasyHelpReviewPanel**: shown only after EasyHelp Checking completes, linking the generated HTML report (and the AI analysis when that optional step succeeded).

- **Standalone pages**: model management (LlmConfigPage — multi-model config store and connectivity test), Plugin (backend tool list + skill list), Agents, History (past executions; verification reports can be reopened).

- **Bottom status bar**: HARNESS v2, current scenario name, workflow state.

> UI capabilities that are planned but **not yet implemented**: single-step debugging; a panel for model-inference token usage / latency / cache-hit statistics (the backend already has the `llm_audit` table and the `/api/executions/audit-llm` endpoint, but the frontend never calls it).

> **Login note**: Harness itself has **no login** — open it and use it. `require_user()` in `server/infra/security.py` always returns the fixed local user `LOCAL_USER`, with no password or session check; the earlier `auth_router.py` account system has been deleted. Harness login and the real game/admin environment's login are two unconnected systems, so the early assumption that "logging into Harness spares you from logging into the game environment" did not hold, and the login was removed.
>
> Logging into the game environment is now handled by the verification method itself (see the addendum under Module Three in 10.2): the default **Harness method** opens a real browser with Playwright (`server/game_session/`) and logs in either through the QA-only Titan Harness launcher form (shared QA test password by default, overridable via the `harness_password` param; no Okta/MFA) or through a direct game launch URL that carries the account in its query string, with testdata uploaded directly via an Axiom API Key; the **Local link method** opens a locally served game launch URL that logs itself in from its query string (no launcher form), again uploading via an Axiom API Key; the **API method** needs the tester to paste an Okta access_token and an Axiom API Key; the earlier **Selenium method** (borrowing the tester's own logged-in Chrome profile + interactive Okta) has been removed; its shared helpers live on in `testdata_verify_common.py` and its Selenium page drivers in `selenium_page_drivers.py` (still used by `portugal_plugin_fetcher`), and its old history reports still reopen (the frontend still recognizes the `testdata_verifier` tool name in stored executions).

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
| `helpfile_analyzer` Plugin | Backend Python | **Direct Ollama call**, bypassing the frontend gateway (temperature 0.3). When the active Provider is `OLLAMA`, the frontend passes the selected model and Base URL; otherwise the plugin defaults apply (`http://localhost:11434`, `qwen3:latest`). If the requested model is not installed, it picks another installed local chat model | Optional AI analysis of the EasyHelp report |

### 5.4 Why a Multi-Gateway Design Instead of Hardcoding Two Providers

- **Built for future extensibility, not a current necessity**: the current 4 fixed pipelines are covered by the local 7B model; the point of the multi-gateway design is so that changing the model source in the future, or plugging in a customer's own model API, requires no rework of the Harness;

- **Architectural decoupling**: a change in model source only affects the Provider adaptation layer, and has no effect on intent routing, pipeline definitions, the execution engine, or Agent/Skill content — consistent with the "complete decoupling between layers" extensibility principle in Chapter 9 (`helpfile_analyzer`'s direct server-side Ollama call is currently the one exception — it follows the UI model choice only when that choice is an Ollama model);

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
│   ├── components/            # Header / Sidebar / ExecutionConsole / PipelineVisualization / TestDataPreview / EasyHelpReviewPanel / VerificationReportModal / LlmConfigModal / XmlViewer
│   ├── pages/                 # LlmConfigPage / PluginPage / AgentPage / HistoryPage
│   └── App.tsx                # Workbench: scenario state, parameter assembly, run entry points
├── server/                    # Backend: FastAPI
│   ├── main.py                # app entry, SSE hub, static file hosting
│   ├── config.py              # port, CORS, data dir (server/data/)
│   ├── api/                   # tools_router / executions_router / records_router
│   ├── services/execution_queue.py  # serial execution queue
│   ├── infra/                 # storage (SQLite) / security / cancellation / process_runner / logger
│   ├── game_session/          # Playwright game-session layer used by testdata_verifier_harness / _local
│   │                          #   (launcher / session / protocol / capture / env, plus a smoke script)
│   └── tools/                 # base.py (ToolPlugin / ToolRegistry) + impl/ (15 Plugins, plus shared helpers:
│                              #   testdata_verify_common.py, selenium_page_drivers.py, symbol_profiles.py)
├── tests/                     # pytest: game_session protocol (with recorded fixtures), account assignment,
│                              #   and the local-link verifier
├── docs/                      # supplementary design notes and plans
├── build.py / slot_harness.spec / harness.cmd   # PyInstaller + pywebview desktop packaging
├── generate_testdata.py       # standalone CLI script
└── assign_testdata_accounts.py  # CLI: rewrite each .testdata <Key loginName> to its own test account
                                 #   (automate01, automate02, ...) so a whole folder can be verified together.
                                 #   The UI's "Account keyword" (Harness / Local link) does the same per run,
                                 #   with Axiom's bulk-create names (automate1, automate2, ...)
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

15 Plugins have landed so far (see 2.2). SLOT-specific plugin directions for the future:

- **SLOT numeric-validation plugin**: multiplier validation, probability validation, compliance checks on random-value distributions;
- **Level/storyline test plugin**: batch generation and validity verification of multi-scenario storyline data;
- **Exception test-case generation plugin**: automatic construction of boundary values, illegal parameters, and exceptional scenarios;
- **Automated report export plugin**: test coverage, data-compliance reports, batch-execution reports;
- **Version-comparison plugin**: diffing test data between old and new versions, identifying change risk.

**Actual steps**:

1. Create `xxx_tool.py` in `server/tools/impl/`, subclass `ToolPlugin`, declare `info` (name / description / inputSchema) and implement `_run_impl`;
2. Register it in `BUILTIN_TOOLS` in `server/tools/impl/__init__.py` (it is loaded into `ToolRegistry` at backend startup and listed by `/api/tools/list`);
3. If it belongs to a scenario, add it to `SCENARIO_PLUGINS` in `server/api/tools_router.py` and to that scenario's `requiredPlugins` in `intentRouter.ts`;
4. Reference it as a step in `pipelineRegistry.ts`, declaring its input mapping with `buildParams` (mark it `optional: true` if the pipeline should complete without it);
5. If it runs long and should be interruptible by the Stop button, call `server/infra/cancellation.register()` with a cancel callback after acquiring the resource — either a force-close (e.g. `portugal_plugin_fetcher` kills its WebDriver) or a cooperative signal (e.g. `testdata_verifier_harness` sets a cancel event its Playwright session checks) — and `unregister()` when done.

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
| `game_verification` | TestData Verification | `game-verify-pipeline` | testdata_verifier_api, testdata_verifier_harness, testdata_verifier_local, log_diagnoser |
| `easyhelp_checking` | EasyHelp Checking | `helpfile-conversion-pipeline` | html_to_text_converter, diff_comparator, helpfile_report, helpfile_analyzer |
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
  optional?: boolean;          // A failure only logs a warning; the pipeline continues
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
| `game-verify-pipeline` | verify (testdata_verifier_harness, no retry) → diagnose (log_diagnoser, no retry) — **declared but not currently invoked**, see the addendum under Module Three |
| `helpfile-conversion-pipeline` | convert (html_to_text_converter, 1 retry) → compare (diff_comparator) → report (helpfile_report, deterministic HTML/JSON) → analyze (helpfile_analyzer, **optional**, reads the report's JSON) |
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
    any failed non-optional step in the stage → pipeline = failed, stop
    (a failed optional step only logs a warning)
  all done → pipeline = completed
  AbortSignal fired → pipeline = aborted
```

- Step states: `pending / running / retrying / success / failed` (the type also has `skipped`, currently unused); pipeline states: `running / completed / failed / aborted` (the type also has `idle / paused`, currently unused);
- `EngineCallbacks` (onStepChange / onStepComplete / onStepFail / onStatusChange / onLog) mirror progress into the task list and the execution console;
- **Stop**: the frontend AbortController stops further steps; for a browser-driven Plugin still running on the backend (`portugal_plugin_fetcher`, `testdata_verifier_harness`, `testdata_verifier_local`), the frontend also calls `POST /api/executions/{id}/cancel`, and the backend cancellation registry runs the Plugin's registered callback — `portugal_plugin_fetcher` force-closes its Selenium WebDriver, `testdata_verifier_harness` / `testdata_verifier_local` set a cancel event that its Playwright session stops on.

**Where the AI sits in a pipeline run** (orchestrated by App.tsx, always outside the engine):

- Before the run: code checks required inputs (`checkMissingField`); if one is missing, `PlannerAgent.clarify()` produces **one** clarifying question, the user's answer is written by code directly into the matching field (not reinterpreted by the AI), then the pipeline runs;
- After the run: the pipeline's completed state takes effect immediately, then `summarizeStepResult()` is called **asynchronously and non-blocking** to summarize the last step's result; if the LLM is unavailable, only a warning is logged.

**Addendum: the TestData Verification execution path**

This scenario **does not go through ExecutionEngine**; `game-verify-pipeline` is declared but never invoked. The actual path (`App.tsx` → `runRealGameVerification` in `utils/verificationEngine.ts`):

1. The user uploads .testdata files or a folder via "+" (persisted by the backend's `/api/tools/upload-testdata`), then picks files and a verification method and enters credentials in the test-plan preview panel;
2. **One** Plugin is chosen by method: `harness` (default) → `testdata_verifier_harness` (Playwright via `server/game_session/`), for which the frontend requires a URL, an Axiom API Key, Product Id and Client Id (Brand optional), with Username / Module Id derived from the testdata file's `<Key>`. The Plugin itself picks its mode from the URL: a `/harness/` launcher URL fills the Titan Harness form, any other URL is treated as the game's own launch URL carrying the account in its query string; on the backend Product Id / Client Id are only needed for launcher URLs (see Chapter 13). One session logs into a single account/module, so `assign_testdata_accounts.py` can give each file its own account before a folder is verified; `local` ("Local link (all files)") → `testdata_verifier_local`, needing only the local game launch URL and an Axiom API Key (env optional — read from the game's own traffic when omitted): each file is uploaded with its `<Key loginName>` rewritten in the uploaded copy and played before the next upload, so one account verifies the whole folder; a file for another moduleID is reported `MODULE_MISMATCH` and skipped; `api` → `testdata_verifier_api`, needing an Okta access_token and an Axiom API Key, no screenshots. For `harness` and `local`, an optional **account keyword + count** maps files in name order to `keyword1`, `keyword2`, ... (Axiom's bulk-create names), each in its own session; an account that cannot log in fails only its own file (`LOGIN_FAILED`);
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
  3. **Analysis-report generation** — implemented: the post-pipeline step-result summary (`summarizeStepResult`), AI diagnosis of failed verification cases (`runAIDiagnosis`), and the optional EasyHelp AI analysis (`helpfile_analyzer` calling Ollama server-side on top of the deterministic `helpfile_report`);

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
| EasyHelp Checking | HTML→TXT conversion, baseline diff, keyword counting and highlighting, Excel output, HTML/JSON report (`helpfile_report`) | Optional `helpfile_analyzer` analysis of that report (server-side Ollama); post-pipeline step summary |
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
| `helpfile_analyzer` | Requested model not installed → uses another installed local chat model; none available, timeout or call error → returns a failed result (`ollama_no_chat_model` / `ollama_timeout` / `ollama_chat_error`). It is an `optional` step, so the pipeline still completes and the deterministic `helpfile_report.html` is kept |

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
- **HARNESS auto-routing** (planned, **not implemented**): code would choose the model source by task complexity. Today, every frontend call uses the single model the user selected in the model drop-down / model-management page, and `helpfile_analyzer` always uses local Ollama server-side (the selected model when the active Provider is Ollama, otherwise its own default).

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
| `POST /api/tools/stage-local-files` | Desktop app only: stages loose HTML files picked with the native dialog (real absolute paths) as `<stem>/index.html`, and returns their source folder so reports can be written next to them |
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
- `SerialExecutionQueue`: runs **serially** under a per-user asyncio lock so multiple browser sessions (Selenium or Playwright) don't collide (the interface leaves room to swap in a parallel queue);
- `cancellation`: browser-driven Plugins register a cancel callback, which the cancel endpoint invokes — `portugal_plugin_fetcher` registers a WebDriver force-close, `testdata_verifier_harness` and `testdata_verifier_local` register a cancel event their Playwright session checks.

### 12.4 Data Storage

SQLite (`server/data/harness.db`) with four tables:

- `executions`: one run (intent, stage, status, LLM provider/model, token counts, duration, error);
- `tool_calls`: each Plugin call (params, success, result snippet, artifacts, duration, error);
- `test_records`: test records from TestData generation (case, format, module, batch/index, file name, XML snippet);
- `llm_audit`: LLM-call audit (nothing writes to it today).

Artifact directories: `server/data/runs/` (per-execution working directories; `config.py` defines `HARNESS_RUN_TTL_HOURS`, but no cleanup logic uses it yet) and `server/data/artifacts/` (downloadable reports and ZIPs); Portugal symbol maps persist in the repository-root `symbol_profiles/`. EasyHelp Checking writes its outputs (TXT, Excel, `helpfile_report.html/.json`, `ai_analysis_report.html/.json`) to an `_easyhelp_output` folder: next to the source files when they are a real local path (picked with the desktop app's native dialog, or a folder path typed in answer to the clarifying question), otherwise (browser upload) under the upload staging folder in `server/data/runs/uploads/`.

---

## 13. Code Status & Known Discrepancies (new)

The following inconsistencies — within the code, or between the code and the plan — were found during the revisions. The document describes the code as it is; whether to change the code is a separate decision. Status as of 2026-10-28 (commit `d5fc203`).

| # | Current state | Impact | Status |
|---|---|---|---|
| 1 | `game-verify-pipeline` is declared, but TestData Verification actually runs through `verificationEngine.ts`, and that Pipeline's verify step covers only the Harness method (not the API or Local link method) | Pipeline declaration and actual execution disagree | Open |
| 2 | `PipelineStepDef.dependsOn` is not checked by the execution engine; the `skipped` / `paused` / `idle` states are unused (the newer `optional` flag, by contrast, is honored) | Declarative metadata only | Open |
| 3 | `agents/ui_log_diagnoser_agent.md` is referenced by no scenario; the `log_diagnosis` scenario and `log-diagnose-pipeline` it mentions no longer exist | Orphaned file | Open |
| 4 | Agent data in `AgentPage.tsx` is hardcoded, and its "Planner Agent" still claims to "drive the conversation loop and tool orchestration" (and lists only three scenarios); the Skill display data in `PluginPage.tsx` is hardcoded too | Display may drift from actual responsibilities/files | Open |
| 5 | The frontend never calls `auditLlm`, so the `llm_audit` table and the executions token fields stay empty; the UI shows no token / latency / cache statistics; `HARNESS_RUN_TTL_HOURS` is defined but no cleanup uses it | The monitoring panel in 4.1 is planned only | Open |
| 6 | `helpfile_analyzer` calls Ollama directly server-side. It now receives the UI-selected model and Base URL when the active Provider is `OLLAMA`; with any other Provider it still falls back to its own default (`qwen3:latest` on `localhost:11434`) | The only call that bypasses the unified gateway | Partially resolved |
| 7 | The input-box model drop-down `MODEL_OPTIONS` is hardcoded (with labels like `deepseek-chat`, `claude-3-haiku`) and doesn't map one-to-one onto the Provider Presets | Options may not match the current Provider | Open |
| 8 | TestData Generation's `gamePrefix` (P5P) and default `moduleId` (105359) are hardcoded in App.tsx; Google Sheet URLs are never fetched, yet the scenario description in `intentRouter.ts` still says "Parse Paytable from Google Sheet" | Other games rely on the Module ID in the pasted text | Open |
| 9 | Test-plan preview checkboxes don't affect execution, except Portugal's "Save Imported Mapping"; TestDataPreview's "Regenerate" just resets to mock records | Interactions are weaker than the UI implies | Open |
| 10 | Supporting docs are out of date: `plugins/README.md` lists the nonexistent `game_verifier_tool.py`; `workflows/README.md` says pipelines are hardcoded in `plannerAgent.ts`; `skill-generator-plugin-contract.md` still has a `game_verifier` "with Selenium" contract; `skill-verification-protocol.md` and the root `README.md` still describe Selenium-based verification, while `testdata_verifier_harness` now uses Playwright | Supporting docs are out of date | Open (scope grew) |
| 11 | `pipelineRegistry.ts` header comment says steps within a stage "can run in parallel" (the engine runs them serially), and a comment on the helpfile pipeline says it "was missing from this registry until now" | Stale code comments | Open |
| 12 | `testdata_verifier_harness` accepts a direct game launch URL, where Product Id / Client Id are not needed (both are optional on the backend), but `verificationEngine.ts` always requires both and its error text asks for a "Titan Harness launcher page URL" | The direct-URL mode is harder to use from the UI than the Plugin allows | Addressed for local links: the "Local link (all files)" method runs `testdata_verifier_local`, which takes the direct URL alone (no Product Id / Client Id, env optional) and uploads + plays each file in turn as the link's account |
