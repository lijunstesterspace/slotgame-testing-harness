# SKILL: Helpfile HTML Conversion and Diff Analysis Rules

## 1. Core Purpose
Skill for batch conversion, diff comparison and keyword analysis of Helpfile help files; provides constraints for the Helpfile Conversion Agent.

## 2. HTML → TXT Conversion Rules

### Rule 1: Traversal and Extraction
- Traverse all subdirectories under the source folder
- Read the `index.html` file in each subdirectory
- Name the output TXT file after the subdirectory

### Rule 2: html2text Conversion Config
- `ignore_links = True` — remove hyperlinks
- `ignore_images = True` — remove image references
- `ignore_emphasis = True` — remove bold/italic markers
- `body_width = 0` — no automatic line wrapping
- `single_line_break = True` — single line break between blocks
- `skip_internal_links = True` — remove internal anchors
- `bypass_tables = True` — keep table structure
- `mark_code = False` — do not mark code blocks

### Rule 3: Post-processing
- Remove empty lines (filter empty strings with `line.strip()`)
- Merge consecutive empty lines
- Output uniformly in UTF-8 encoding

## 3. Diff Comparison Rules

### Rule 4: Baseline File Selection
- Sort all subdirectory names alphabetically
- The TXT file of the first subdirectory after sorting is the **baseline file**
- Each remaining file is diffed against the baseline file separately

### Rule 5: Diff Generation
- Use `difflib.HtmlDiff` to generate the HTML diff report
- Output includes color-marked additions/deletions/changes

### Rule 6: Keyword Highlighting (no nesting)
- Sort all keywords by length in **descending order** before highlighting (match longer words first)
- Use BeautifulSoup to modify only **text nodes**, without breaking HTML structure
- Skip `<script>`, `<style>`, `<head>`, `<title>`, `<meta>` tags
- Match case-insensitively with `re.IGNORECASE`
- Wrap format: `<span style="background-color:yellow">matched text</span>`
- If BeautifulSoup parsing fails, fall back to global regex replacement

## 4. Keyword Counting Rules

### Rule 7: Counting Method
- For each TXT file, count occurrences of all keywords
- Use `txt_content.lower().count(keyword.lower())` case-insensitively
- Write results to an Excel worksheet

### Rule 8: Excel Output Format
- First row: `['File Name'] + keywords`
- Each following row: `[subdir name, keyword 1 count, keyword 2 count, ...]`
- File name: `output.xlsx`

## 5. Output Constraints
- All output files are saved to the specified output_folder
- TXT file naming: `{subdir_name}.txt`
- Diff HTML naming: `compare_{safe_base}_vs_{safe_compare}.html`
- Diff PNG naming: `compare_{safe_base}_vs_{safe_compare}.png`
- Special characters in file names are replaced with `_` (keep only `[A-Za-z0-9_.-]`)
