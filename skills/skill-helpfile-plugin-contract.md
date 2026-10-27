# SKILL: Helpfile Conversion Analysis Plugin Interface Contract Specification

## 1. Core Purpose
Defines the interface contract between the Helpfile conversion analysis Plugin tool layer and the Agent layer, ensuring consistent parameter formats.

## 2. html_to_text_converter Interface Contract

**Function:** Batch convert HTML help files to plain text

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `source_folder` | string | Yes | Source folder path containing subdirectories (each with index.html) |
| `output_folder` | string | Yes | Output path for converted TXT files |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "converted_files": [
      {
        "subdir_name": "module_a",
        "html_path": "/source/module_a/index.html",
        "txt_path": "/output/module_a.txt",
        "char_count": 1523
      }
    ],
    "total_converted": 5,
    "baseline_file": "/output/aaa_first_module.txt"
  }
}
```

## 3. diff_comparator Interface Contract

**Function:** Diff-compare converted TXT files, highlight keywords, compute statistics

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `txt_files` | array | Yes | List of TXT file paths `[{subdir_name, txt_path}]` |
| `keywords` | array | Yes | List of keywords to highlight and count |
| `output_folder` | string | Yes | Output path for diff reports |
| `baseline_file` | string | No | Baseline file path (defaults to the English file: `en`, then `en-*`, else the alphabetically first) |
| `generate_png` | boolean | No | Whether to generate PNG screenshots, default true |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "comparisons": [
      {
        "baseline": "aaa_first_module",
        "target": "module_b",
        "diff_html_path": "/output/compare_aaa_first_module_vs_module_b.html",
        "diff_png_path": "/output/compare_aaa_first_module_vs_module_b.png",
        "keyword_counts": {"keyword1": 3, "keyword2": 0}
      }
    ],
    "excel_report": "/output/output.xlsx",
    "total_comparisons": 4
  }
}
```

## 4a. helpfile_report Interface Contract

**Function:** Build the deterministic comparison report (no AI): file inventory, keyword counts per file
and differences vs the baseline. This report is always produced, even when no local model is available.

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `txt_files` | array | Yes | List of TXT file paths `[{subdir_name, txt_path}]` |
| `keywords` | array | Yes | List of analysis keywords |
| `output_folder` | string | Yes | Output path for the report |
| `comparison_results` | array | No | Comparison results output by diff_comparator |
| `baseline_file` | string | No | Baseline TXT path (from html_to_text_converter) |
| `excel_report` | string | No | diff_comparator's Excel path, linked from the HTML |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "report_html_path": "/output/helpfile_report.html",
    "report_json_path": "/output/helpfile_report.json",
    "files_count": 5,
    "changed_count": 2,
    "missing_keywords": ["keyword2"]
  }
}
```

## 4b. helpfile_analyzer Interface Contract

**Function:** Call the local AI model (Ollama) to analyze `helpfile_report.json` and write an AI analysis
report. Optional pipeline step: if it fails, the pipeline still completes with the 4a report.

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `report_json_path` | string | Yes | `helpfile_report.json` written by helpfile_report |
| `output_folder` | string | Yes | Output path for analysis report |
| `ollama_base_url` | string | No | Ollama service URL, default `http://localhost:11434` |
| `ollama_model` | string | No | Model name, default `qwen3:latest` (the pipeline passes the model selected in the UI) |

The call uses `think: false` and `format: "json"`; reasoning models otherwise spend minutes thinking
on a local CPU before answering.

**Output structure:**
```json
{
  "success": true,
  "content": {
    "ai_analysis": {
      "summary": "Overall content comparison summary...",
      "keyDifferences": ["Difference 1...", "Difference 2..."],
      "qualityIssues": ["Issue 1...", "Issue 2..."],
      "recommendations": ["Recommendation 1...", "Recommendation 2..."]
    },
    "report_json_path": "/output/ai_analysis_report.json",
    "report_html_path": "/output/ai_analysis_report.html",
    "model_used": "qwen3:latest",
    "analysis_duration_ms": 12500
  }
}
```

## 5. Tool Call Order Constraint

The Agent must call tools in the following order:
1. `html_to_text_converter` → batch convert HTML to TXT
2. `diff_comparator` → diff comparison + keyword highlighting + Excel statistics
3. `helpfile_report` → deterministic HTML/JSON report (always produced)
4. `helpfile_analyzer` → optional: local AI analyzes the report
