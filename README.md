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
├── verify_testdata.py       # Automated verifier (Selenium + HTML report)
├── generator_gui.html       # Visual web-based generator (works out of the box)
├── mock_game.html           # Mock game page (for debugging the verifier)
├── report.html              # Sample verification report
├── screenshots/             # Directory for screenshots taken during verification
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

### Option 3: Automated Verification

```bash
# Verify by clicking SPIN manually
python verify_testdata.py -f generated_wins.testdata -u "https://your-game-url.com"

# Trigger SPIN automatically with the space bar (5-second interval)
python verify_testdata.py -f generated_wins.testdata -u "https://your-game-url.com" --auto-spin --spin-delay 5.0
```

## Installing Dependencies

The generator (`generate_testdata.py`) depends only on the Python standard library; **no additional installation is required**.

The verifier (`verify_testdata.py`) requires Selenium:

```bash
pip install selenium
```

If Selenium is not installed when you first run `verify_testdata.py`, the script automatically runs `pip install selenium`. You also need:

- The **Google Chrome** browser installed
- A **ChromeDriver** that matches your Chrome version (Selenium 4.6+ manages this automatically; no manual download needed)

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

## verify_testdata.py Parameters

| Parameter | Short | Default | Description |
|------|------|--------|------|
| `--file` | `-f` | **Required** | Path to the `.testdata` file to verify |
| `--url` | `-u` | **Required** | Game page URL |
| `--output` | `-o` | `report.html` | Save path for the generated HTML report |
| `--auto-spin` | — | Off | When enabled, automatically presses the space bar to trigger SPIN |
| `--spin-delay` | — | `5.0` | Interval in seconds between automatic SPINs |

### Verification Flow

1. The script launches Chrome and opens the specified URL
2. The user logs in and loads the game in the browser
3. Switch back to the console and press `Enter` to start listening
4. After each SPIN, the game page's console must output a log line like `batch: 58, index: 3`
5. The script captures that log automatically and compares it one by one against the expected sequence parsed from the testdata
6. Every comparison automatically takes a browser screenshot and saves it to `screenshots/`
7. After all SPINs are done, an HTML report is generated in the current directory (with overall statistics, per-entry details, and click-to-enlarge thumbnails)

## Debugging with the Mock Game

Use the bundled `mock_game.html` to verify the flow without a real game:

```bash
# 1. Start a local static server (pick any one)
python -m http.server 8000

# 2. Run the verifier with the URL pointing at the mock page
python verify_testdata.py ^
  -f P5P_Bonus_Mini.testdata ^
  -u "http://localhost:8000/mock_game.html" ^
  --auto-spin --spin-delay 1.0
```

The mock page is preloaded with two SPIN entries: `(58,3)` → `(2,67933)`. Pressing the space bar or clicking the button both output a log line to the console.

## FAQ

**Q: The verifier doesn't receive the batch/index log?**
A: Make sure the game page's console actually outputs in the `batch: X, index: Y` format (matched by regex; other text before or after is fine). You can first open the browser DevTools → Console to confirm manually.

**Q: Chrome fails to start or the version is incompatible?**
A: Upgrade to the latest Chrome and Selenium: `pip install --upgrade selenium`. Selenium Manager in Selenium 4.6+ automatically downloads the matching ChromeDriver version.

**Q: In nested Bonus mode, why is the stage in the XML fixed to BaseGame/Bonus, ignoring the CLI --stage?**
A: The double-pair template (4 values) means "Base Game triggers Bonus", so it always writes an outer `stage="BaseGame"` + an inner Feature with `stage="Bonus"`, regardless of the --stage argument (which only applies to the single-pair template).

**Q: Can filenames contain Chinese characters or spaces?**
A: Yes. The parser supports both Chinese and English filenames. When a space separates the name from the number pairs, make sure the filename itself does not contain multiple consecutive spaces; using a Tab as the separator is recommended.
