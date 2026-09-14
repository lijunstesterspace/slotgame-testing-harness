# AGENT: Helpfile Conversion & Analysis Agent

## ⚠️ Execution Model (read this first)

This file is loaded as **domain-reference context** for the `easyhelp_checking` scenario. It is
**not** an autonomous multi-step executor.

The `helpfile-conversion-pipeline` (see `src/harness/pipelineRegistry.ts`) declares the fixed step
order:

```
convert (html_to_text_converter)  →  compare (diff_comparator)  →  analyze (helpfile_analyzer)
```

`ExecutionEngine` calls these three Plugins in this exact order, every time. The AI never decides
which Plugin runs next. Conversion (Rule 1) and diffing/keyword-highlighting (Rules 2-3) are
implemented as **deterministic code** inside `server/tools/impl/html_to_text_converter_tool.py`
and `server/tools/impl/diff_comparator_tool.py`.

The one place a model genuinely runs in this scenario is **Rule 4 below** — and it already lives
entirely server-side, inside the `helpfile_analyzer` Plugin
(`server/tools/impl/helpfile_analyzer_tool.py`), which calls a local Ollama model directly with the
conversion + diff results. This frontend `PlannerAgent` class is not involved in that call at all;
it is documented here so the prompt/rule design for that server-side call stays traceable to one
place.

## AI Responsibility (narrowed, per design doc §1.2 / §10.7 / §11)

For this scenario, AI involvement is:

- **Analysis-report generation** (bucket 3 of the AI's role) — implemented server-side in the
  `helpfile_analyzer` Plugin (see Rule 4), and optionally echoed to the user as a short frontend
  summary via `PlannerAgent.summarizeStepResult()` after the pipeline completes.

It never decides which files to scan, never picks the baseline, and never does the keyword
diffing — all of that is 100% code, and the pipeline still produces TXT/diff/Excel output even if
the AI analysis step is unavailable (it is the only step allowed to fail without failing the whole
pipeline, per its Plugin's own error handling).

---

## Domain Reference: Conversion & Analysis Rules

### Rule 1: HTML → Text Conversion (implemented in `html_to_text_converter_tool.py`)
- Uses the `html2text` library with the following configuration:
  - `ignore_links = True` — strip hyperlinks
  - `ignore_images = True` — strip image references
  - `ignore_emphasis = True` — remove bold/italic markers
  - `body_width = 0` — no line wrapping
  - `single_line_break = True` — single newline between blocks
  - `skip_internal_links = True` — remove internal anchors
  - `bypass_tables = True` — preserve table structure
- Post-processing: strip blank lines, normalize whitespace.

### Rule 2: Baseline Selection & Diff Comparison (implemented in `diff_comparator_tool.py`)
- Sorts all subdirectory names alphabetically.
- The first subdirectory's TXT becomes the **baseline file** (unless overridden).
- Compares each remaining file against the baseline using `difflib.HtmlDiff`.
- Generates per-file diff HTML with color-coded changes.

### Rule 3: Keyword Highlighting, Nested-Safe (implemented in `diff_comparator_tool.py`)
- Sorts keywords by length **descending** before highlighting (longer matches first).
- Uses BeautifulSoup to only modify **text nodes**, preserving HTML structure.
- Skips `<script>`, `<style>`, `<head>`, `<title>`, `<meta>` tags.
- Wraps matches in `<span style="background-color:yellow">` tags.
- Falls back to global regex replacement if BeautifulSoup parsing fails.

### Rule 4: AI Analysis Report (the actual model call — implemented in `helpfile_analyzer_tool.py`)
- After conversion and comparison, this Plugin invokes a local Ollama model directly (server-side,
  via `ollama_base_url` / `ollama_model` params — no frontend PlannerAgent involved).
- It provides the model with:
  - The file list and keyword-count summary
  - Key diff snippets (top N most-changed sections)
  - Keyword coverage statistics
- The model is asked to generate a structured analysis containing:
  - `summary`: overall content-comparison summary
  - `keyDifferences`: major content differences identified
  - `keywordCoverage`: keyword distribution analysis
  - `qualityIssues`: potential inconsistencies or missing content
  - `recommendations`: actionable suggestions for improvement
- The prompt for this call must stay tightly constrained (single JSON schema, low temperature,
  one judgment per call) per design doc §11.3 — it is a single-shot classification/report call,
  not a multi-turn agent loop.

---

## Output Specification

Generated output package in `{output_folder}/`:

**Converted Text Files:**
- `{subdir_name}.txt` — one per source subdirectory

**Diff Comparison Reports:**
- `compare_{baseline}_vs_{target}.html` — HTML diff with keyword highlighting
- `compare_{baseline}_vs_{target}.png` — PNG screenshot of diff (if wkhtmltoimage available)

**Keyword Analysis:**
- `output.xlsx` — Excel workbook with keyword count per file

**AI Analysis Report:**
- `ai_analysis_report.json` — structured AI analysis result
- `ai_analysis_report.html` — human-readable HTML report with AI insights
