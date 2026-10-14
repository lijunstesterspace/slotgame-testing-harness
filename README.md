# Testdata Updating Tool

> A toolkit for batch-generating and automatically verifying slot machine `.testdata` test data. It supports two formats, single-pair and nested Bonus double-pair, offers three ways to use it (CLI, interactive, and web GUI), and can use Selenium browser automation to verify that the generated data matches the game's actual output.

## Features

-  **Multi-format input parsing**: Automatically recognizes two data formats: a single `batch,index` pair and a nested Bonus double pair (Base + Bonus)
-  **Batch file generation**: A single input can produce multiple `.testdata` XML files at once, using either file-header separators or inline naming
-  **Three usage modes**:
   - Python CLI (arguments + pipe + file input)
   - Python interactive wizard (with automatic clipboard detection)
   - Pure front-end web GUI (live preview + ZIP download, no environment setup required)
-  **Automated verification**: Opens the game page with Selenium + Chrome, listens to console logs, compares expected vs. actual `(batch, index)`, takes screenshots automatically, and generates a polished HTML report
-  **Built-in mock game**: Includes a simulated game page so you can debug the verification flow without a real game environment

## Directory Structure

```
testdata updating tool/
├── generate_testdata.py     # .testdata generator (Python CLI / interactive)
├── generator_gui.html       # Visual web-based generator (works out of the box)
└── README.md                # This file
```

## Quick Start

### Option 0: AI Assistant Front End (React/Vite)

The project includes a front-end UI (`src/`) that chains the steps together as an "AI Agent workbench": enter intent → generate testdata → (optional) real-environment verification.

```bash
# 1) Install dependencies (using the lockfile is recommended for consistency)
npm ci

# 2) Start the dev server
npm run dev
```

Once it starts, open `http://localhost:3000/` in your browser.

#### Double-Click Launch (Windows)

If you'd rather not remember commands and just double-click to launch: run `start-dev.cmd` in the root directory (it automatically runs `npm ci` once if dependencies are missing).

If a colleague's computer doesn't have Node.js / npm installed yet:
- `npm` is installed together with Node.js (just install Node.js LTS).
- `start-dev.cmd` checks whether `node` exists: if the system has `winget`, you can choose to install Node.js LTS automatically; otherwise it opens the Node.js download page automatically.

If the window flashes and disappears right after double-clicking (commonly caused by: clicking the wrong file, the script's pre-launch checks failing, or `npm run dev` erroring out immediately):
- Make sure you double-clicked `start-dev.cmd` (not `README.md` or another `.md` file; Windows may hide file extensions)
- Double-click `start-dev-debug.cmd` (it prints the full log and keeps the window open on failure)
  - Note: In a Windows batch script, `.cmd` scripts such as `npm` must be run with `call`; otherwise the current script "exits immediately after npm finishes", which shows up as the window flashing closed or later steps not running.

#### (Optional) LLM / Ollama

By default, the Vite proxy forwards `/ollama` to `http://localhost:11434` (see `vite.config.ts`) to connect to a local Ollama instance.

- If you have Ollama locally: make sure port `11434` is available; the page will show `OLLAMA Online` and you can pick a model in the UI.
- If you don't have Ollama: the page still opens, but it falls back to offline/deterministic logic (this does not affect using the Python/web GUI generators).

#### Production Preview

```bash
npm ci
npm run build
npm run preview
```

After `preview` starts, the terminal prints a local address (usually `http://localhost:4173/`); open it in your browser.

### Option 1: Web GUI (Recommended, Zero Dependencies)

Open `generator_gui.html` directly in your browser, paste data → live preview → download the ZIP with one click.

### Option 2: Python Generator

```bash
# Interactive (with automatic clipboard detection)
python generate_testdata.py

# Command line + file input
python generate_testdata.py -m 10539 -s BaseGame -c TestMode -f input_data.txt

# Pipe input
echo "Bonus_MINI  58,3  2,67933" | python generate_testdata.py -m 10539
```

### Option 3: Verification Against the Game

Verification runs from the AI Assistant front end (Option 0): pick the TestData Verification
scenario, then the Harness method (Titan Harness launcher login, with screenshots) or Direct API.

## Installing Dependencies

The generator (`generate_testdata.py`) depends only on the Python standard library; **no additional installation is required**.

## Input Data Format

### Format A: Block Format (with File-Header Separators)

File headers can be written in 4 ways: `[filename]`, `# filename`, `== filename ==`, or just `xxx.testdata`

```
# File_A_BaseSpins
21,4683
batch and index: 21, 4684

[File_B_Bonus]
58,3  2,67933
58,3  4,145
```

### Format B: Single-Line Named Format (One File Entry per Line)

```
# Single-pair format: filename + batch,index
Bonus Feature trigger_Ascend    58,3

# Double-pair format (nested Bonus): filename + base_batch,base_index  bonus_batch,bonus_index
Bonus Feature_MINI Prize        58,3    2,67933
Bonus Feature_Maxi Prize        58,3    4,145
```

The two formats can be **pasted mixed together**; the parser recognizes them automatically and assigns them to the corresponding files.

## Generated .testdata XML Structure

### Single-Pair (Single Spin) Template

```xml
<Test>
  <Key moduleID="10539" loginName="" />
  <Slot>
    <Spin stage="BaseGame" comment="TestMode">
      <PreGen batch="21" index="4683" />
    </Spin>
    <Spin stage="BaseGame" comment="TestMode">
      <PreGen batch="21" index="4684" />
    </Spin>
  </Slot>
</Test>
```

### Nested Bonus (Double PreGen) Template

```xml
<Test>
  <Key moduleID="10539" loginName="" />
  <Slot>
    <Spin stage="BaseGame">
      <PreGen batch="58" index="3"></PreGen>
      <Feature stage="Bonus">
        <PreGen batch="2" index="67933"></PreGen>
      </Feature>
    </Spin>
  </Slot>
</Test>
```

## generate_testdata.py Parameters

| Parameter | Short | Default | Description |
|------|------|--------|------|
| `--module` | `-m` | `10539` | Global moduleID |
| `--stage` | `-s` | `BaseGame` | Spin stage attribute for the single-pair template |
| `--comment` | `-c` | `TestMode` | Spin comment attribute for the single-pair template |
| `--output` | `-o` | `generated_wins.testdata` | Default output filename for unnamed data |
| `--file` | `-f` | — | Read input data from the specified file (otherwise reads stdin/clipboard) |

**In interactive mode**, the script first tries to read the clipboard; if it detects valid data, it asks whether to use it directly.

## FAQ

**Q: In nested Bonus mode, why is the stage in the XML fixed to BaseGame/Bonus, ignoring the CLI --stage?**
A: The double-pair template (4 values) means "Base Game triggers Bonus", so it always writes an outer `stage="BaseGame"` + an inner Feature with `stage="Bonus"`, regardless of the --stage argument (which only applies to the single-pair template).

**Q: Can filenames contain Chinese characters or spaces?**
A: Yes. The parser supports both Chinese and English filenames. When a space separates the name from the number pairs, make sure the filename itself does not contain multiple consecutive spaces; using a Tab as the separator is recommended.
