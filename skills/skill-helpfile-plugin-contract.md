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
| `baseline_file` | string | No | Baseline file path (defaults to the alphabetically first) |
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

## 4. helpfile_analyzer Interface Contract

**Function:** Call the local AI model (Ollama) to analyze conversion and comparison results and generate an analysis report

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `txt_files` | array | Yes | List of TXT file paths `[{subdir_name, txt_path}]` |
| `keywords` | array | Yes | List of analysis keywords |
| `comparison_results` | array | No | Comparison results output by diff_comparator |
| `output_folder` | string | Yes | Output path for analysis report |
| `ollama_base_url` | string | No | Ollama service URL, default `http://localhost:11434` |
| `ollama_model` | string | No | Model name, default `qwen3:latest` |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "ai_analysis": {
      "summary": "Overall content comparison summary...",
      "keyDifferences": ["Difference 1...", "Difference 2..."],
      "keywordCoverage": {
        "keyword1": {"total": 15, "files_with_hits": 4, "files_without_hits": 1},
        "keyword2": {"total": 0, "files_with_hits": 0, "files_without_hits": 5}
      },
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
3. `helpfile_analyzer` → call local AI to generate the analysis report
