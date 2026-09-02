# SKILL: Helpfile转换分析插件接口契约规范

## 1. 核心定位
定义 Helpfile 转换分析相关 Plugin 工具层与 Agent 层的接口契约，保障参数格式一致。

## 2. html_to_text_converter 接口契约

**功能：** 批量将HTML帮助文件转换为纯文本

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `source_folder` | string | 是 | 包含子目录（各含index.html）的源文件夹路径 |
| `output_folder` | string | 是 | 转换后TXT文件输出路径 |

**输出结构：**
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

## 3. diff_comparator 接口契约

**功能：** 对转换后的TXT文件进行差异比较、关键词高亮、统计

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `txt_files` | array | 是 | TXT文件路径列表 `[{subdir_name, txt_path}]` |
| `keywords` | array | 是 | 需要高亮和统计的关键词列表 |
| `output_folder` | string | 是 | 差异报告输出路径 |
| `baseline_file` | string | 否 | 基准文件路径（默认取字母序第一个） |
| `generate_png` | boolean | 否 | 是否生成PNG截图，默认 true |

**输出结构：**
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

## 4. helpfile_analyzer 接口契约

**功能：** 调用本地AI模型（Ollama）对转换和比较结果进行智能分析，生成分析报告

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `txt_files` | array | 是 | TXT文件路径列表 `[{subdir_name, txt_path}]` |
| `keywords` | array | 是 | 分析关键词列表 |
| `comparison_results` | array | 否 | diff_comparator 输出的比较结果 |
| `output_folder` | string | 是 | 分析报告输出路径 |
| `ollama_base_url` | string | 否 | Ollama服务地址，默认 `http://localhost:11434` |
| `ollama_model` | string | 否 | 模型名称，默认 `qwen3:latest` |

**输出结构：**
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

## 5. 工具调用顺序约束

Agent 必须按以下顺序调用工具：
1. `html_to_text_converter` → 批量转换 HTML 为 TXT
2. `diff_comparator` → 差异比较 + 关键词高亮 + Excel 统计
3. `helpfile_analyzer` → 调用本地 AI 生成智能分析报告
