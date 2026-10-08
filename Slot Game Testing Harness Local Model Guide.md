# Slot Game Testing Harness — Local Model Guide (Draft)

> **Status**: Draft · 2026-10-08
> **Audience**: QA testers and developers who run Slot Game Testing Harness on their own machine
> **Based on**: *Slot Game Testing Harness Design Doc* (Chapter 5 "Model Adaptation Strategy" and Chapter 11 "AI Model Functional Positioning")

This guide explains how to install a local AI model with **Ollama**, connect it to Slot Game Testing Harness, and check that it works. Following it end to end takes about 20–30 minutes, most of which is downloading the model.

---

## 1. What the local model does (and doesn't do)

Slot Game Testing Harness is built so that **code runs the test pipelines, not the AI**. Parsing paytables, generating `.testdata` files, verifying in the game environment, diffing help files, and checking Portugal Plugin output are all done by code. They still work, and give the same results, if no model is connected.

The local model only handles a few lightweight language tasks:

| Where | What the model does | If the model is offline |
|---|---|---|
| Input box, **Enter** key | Short chat replies | A warning is logged; nothing else is affected |
| Before a run, when a required input is missing | Writes one clarifying question | A built-in fixed question is used instead |
| After a pipeline completes | Writes a 3–6 sentence summary of the result | A warning is logged; the run still counts as completed |
| TestData Verification with failed cases | Diagnoses the likely root cause of each failure | Falls back to the rule-based diagnoser |
| EasyHelp Checking, "AI Analysis Report" step | Writes the help-file analysis report | The step returns a fallback report |

**Takeaway**: the model makes results easier to read, but it isn't required for testing. Setting it up is still recommended.

---

## 2. Before you start

| Item | Recommendation |
|---|---|
| Operating system | Windows 10/11 (primary), macOS, or Linux |
| Memory | 16 GB RAM recommended (8 GB is the bare minimum for a 7B/8B model) |
| GPU | Optional. A GPU with ≥ 6 GB VRAM makes replies much faster; CPU-only works but is slower |
| Disk | About 5 GB free per model |
| Network | Needed only once, to download Ollama and the models. After that, everything runs offline |
| Ports | `11434` (Ollama) and `8000` (Harness backend) must be free on your machine |

---

## 3. Install Ollama

### Windows

1. Go to **https://ollama.com/download** and download the Windows installer.
2. Run the installer and follow the prompts.
3. Ollama starts automatically and runs in the background (look for the llama icon in the system tray).

### macOS

1. Download the macOS app from **https://ollama.com/download**.
2. Drag it into **Applications** and open it once.

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Check that Ollama is running

Open a terminal (PowerShell on Windows) and run:

```bash
ollama --version
```

Then open **http://localhost:11434** in a browser. You should see the text `Ollama is running`.

---

## 4. Download the models

Slot Game Testing Harness uses two local models by default:

| Model | Used by | Required? |
|---|---|---|
| `qwen2.5-coder:7b` | Chat, clarifying questions, result summaries, verification diagnosis (the Harness default) | **Yes** |
| `qwen3:latest` | EasyHelp Checking's AI Analysis Report (the backend calls this model directly) | Only if you use EasyHelp Checking |

Pull them from a terminal:

```bash
ollama pull qwen2.5-coder:7b
```

```bash
ollama pull qwen3:latest
```

Each download is about 5 GB. When they finish, confirm both are installed:

```bash
ollama list
```

Optional quick test (type a question, then `/bye` to exit):

```bash
ollama run qwen2.5-coder:7b
```

> **Other models**: Harness also lists `deepseek-r1:8b` and `qwen3-vl:8b` as Ollama options. You can use any model you have pulled, but stick to 7B–8B models unless your machine has plenty of memory. Larger models (14B/32B) give better answers but run noticeably slower.

---

## 5. Start Slot Game Testing Harness

Use whichever applies to you.

### Option A — Packaged desktop app (most testers)

Double-click `slotgametestingharness.exe`. It starts the backend and opens the Harness window.

### Option B — From source (developers)

Start the backend (port 8000). The first time, install its dependencies:

```bash
python -m pip install -r server\requirements.txt --target .deps
```

```bash
server\start-server.cmd
```

Start the frontend in a second terminal (port 3000):

```bash
npm ci
```

```bash
npm run dev
```

Then open **http://localhost:3000** in a browser.

> Harness has no login, so it opens straight into the Workbench.

---

## 6. Connect Harness to your local model

Model settings are kept in your **browser's local storage** (or the desktop app's, for the exe). Every tester sets this up once on their own machine.

1. In the Workbench header, click the **Model Management** icon.
2. On the model management page, a **Local Ollama** entry already exists by default. Select it. If it isn't there, click **Add Model** and choose the **OLLAMA** tab.
3. Check the fields:
   - **Base URL**: `http://localhost:11434`
   - **API Key**: leave empty (Ollama doesn't need one)
4. Click **Test & Fetch Models**.
   - If it succeeds, the page shows the connection as online, and the model list is replaced with the models you actually pulled.
   - If it fails, see §9 Troubleshooting.
5. Pick `qwen2.5-coder:7b` (or another model you pulled) in the model selector.
6. If this isn't the default entry yet, click **Set as Default**.
7. Click **Save Changes**, then return to the Workbench.

The execution console logs a line like `Model config updated · Active: OLLAMA · qwen2.5-coder:7b`.

> **Compliance note**: Local Ollama is the only provider that sends no data outside your machine. OpenAI, Anthropic and Custom endpoints are marked "⚠️ External, requires compliance", and Harness shows a warning in the console whenever a pipeline runs with one of them. Use them only if you are allowed to send test data to that service.

---

## 7. Check that it works

1. On the Workbench, pick any scenario in the left **Scenarios** list.
2. Type `hello` in the input box and press **Enter** (Enter sends chat; **Shift+Enter** adds a new line; the **▲** button runs a test task).
3. Within a few seconds the console should show `AI: …` with a short reply.

The first reply after Ollama starts can take 10–60 seconds while the model loads into memory. Later replies are much faster: Harness asks Ollama to keep the model loaded for 30 minutes after each use.

To check the full flow, run a small TestData Generation task. When the pipeline completes, an `AI summary: …` line appears in the console a few seconds later.

---

## 8. Day-to-day tips

- **Quick model switch**: the model drop-down at the bottom right of the input box changes only the **model name**, not the provider or the Base URL. If your active provider is Ollama, pick only models you have actually pulled. Some entries in that list (for example `deepseek-chat`, `gpt-4o-mini`, `claude-3-haiku`) are cloud models and won't work against Ollama. For a lasting change, use the Model Management page instead.
- **Verification diagnosis uses the saved config**: AI diagnosis of failed verification cases uses the configuration saved on the Model Management page, not the quick drop-down.
- **EasyHelp uses its own model**: the EasyHelp AI Analysis Report always calls `qwen3:latest` on `http://localhost:11434` from the backend, whatever is selected in the UI. Keep `qwen3:latest` pulled if you use that scenario.
- **Fixed model settings**: Harness always calls the model with temperature 0.3 and caps each reply at 512 tokens. These keep a small model's answers short and stable, and they aren't exposed in the UI.
- **Freeing memory**: to unload models when you're done, quit Ollama from the system tray (Windows/macOS), or run `ollama stop qwen2.5-coder:7b`.

---

## 9. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| **Test & Fetch Models** fails with "Failed to fetch" / "Failed to connect" | Ollama isn't running | Start Ollama (Windows: from the Start menu; it should appear in the system tray). Check that http://localhost:11434 shows `Ollama is running` |
| Test fails with `Ollama HTTP 404` or a similar status code | Wrong Base URL | Use exactly `http://localhost:11434`, without `/v1` or `/api` |
| Connection test passes, but chat fails with "model not found" | The selected model hasn't been pulled | Run `ollama list`, then `ollama pull <model>`, or pick a model that is already listed |
| First reply is very slow or times out | The model is loading, or the machine is CPU-only | Wait for the first load; try again. On slow machines, stay with 7B models and close other heavy applications |
| EasyHelp "AI Analysis Report" says to check Ollama model availability | `qwen3:latest` isn't installed | `ollama pull qwen3:latest` |
| Opening Harness from **another computer** (e.g. `http://<your-ip>:3000`) and model calls fail | The browser calls Ollama directly, so the request goes to `localhost` on the *viewer's* machine, and Ollama blocks requests from unknown origins | Prefer running Harness and Ollama on the same machine. Otherwise see §10 |
| Settings disappear after switching browser or computer | Settings are stored per browser | Repeat §6 in the new browser or on the new machine |

---

## 10. Advanced: using Ollama on another machine (optional)

If one well-equipped machine (for example, one with a GPU) runs Ollama for the team:

1. On the Ollama machine, set these environment variables and restart Ollama:
   - `OLLAMA_HOST=0.0.0.0:11434` (accepts connections from the network, not just localhost)
   - `OLLAMA_ORIGINS=*`, or better, the exact Harness address such as `http://<harness-host>:3000` (lets the Harness page call Ollama from the browser)
2. Allow inbound port `11434` in that machine's firewall.
3. On each tester's Harness, set **Base URL** to `http://<ollama-machine-ip>:11434` on the Model Management page, then run **Test & Fetch Models**.

> Two limitations: (1) EasyHelp's AI Analysis Report always calls `http://localhost:11434` on the machine running the Harness backend, so a remote Ollama doesn't help that step. (2) Exposing Ollama on the network means anyone who can reach that port can use it. Keep it on the internal network only.

---

## 11. Quick reference

| Item | Value |
|---|---|
| Ollama download | https://ollama.com/download |
| Ollama address | `http://localhost:11434` |
| Default Harness model | `qwen2.5-coder:7b` |
| EasyHelp analysis model | `qwen3:latest` |
| Pull a model | `ollama pull <model>` |
| List installed models | `ollama list` |
| Harness frontend (dev) | http://localhost:3000 |
| Harness backend | http://localhost:8000 (health check: `/healthz`) |
| Where model settings live | Model Management page → browser local storage |
| Model parameters | temperature 0.3, max 512 output tokens, kept loaded for 30 minutes |

---

## Open questions for the next revision

- Should EasyHelp's analysis model follow the model chosen in the UI instead of always using `qwen3:latest`? (Design Doc §13, item 6)
- Should the input-box quick drop-down list only the models pulled into Ollama instead of a fixed list? (Design Doc §13, item 7)
- Do we want a recommended hardware baseline for testers' laptops, measured on our own machines?
