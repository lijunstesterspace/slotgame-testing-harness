"""Plugin: helpfile_analyzer — calls a local AI model to generate an intelligent analysis report"""
from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Any

import httpx

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)
from server.infra.logger import log


# ── Ollama client ──────────────────────────────────────────────

async def _ollama_health_check(base_url: str) -> dict:
    """Check whether the Ollama service is online"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base_url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]
                return {"online": True, "models": models}
            return {"online": False, "models": [], "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"online": False, "models": [], "error": str(e)}


async def _ollama_chat(
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    timeout_sec: int = 120,
) -> str:
    """Call the Ollama /api/chat endpoint (non-streaming)"""
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        resp = await client.post(
            f"{base_url}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 4096,
                },
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama API error: HTTP {resp.status_code} - {resp.text}")
        data = resp.json()
        return data.get("message", {}).get("content", "")


# ── Analysis data preparation ──────────────────────────────────────────────

def _build_analysis_context(
    txt_files: list[dict],
    keywords: list[str],
    comparison_results: list[dict] | None,
) -> str:
    """Build the analysis context sent to the AI"""
    lines: list[str] = []

    # File list
    lines.append("=== File Inventory ===")
    for f in txt_files:
        lines.append(f"  - {f['subdir_name']}: {f['txt_path']}")
    lines.append("")

    # Keyword list
    lines.append("=== Keywords Under Analysis ===")
    lines.append(f"  {', '.join(keywords)}")
    lines.append("")

    # Diff comparison results
    if comparison_results:
        lines.append("=== Comparison Results ===")
        for comp in comparison_results:
            if "error" in comp:
                lines.append(f"  [{comp['target']}] Error: {comp['error']}")
                continue
            lines.append(f"  Baseline: {comp.get('baseline', 'N/A')} vs Target: {comp.get('target', 'N/A')}")
            kc = comp.get("keyword_counts", {})
            if kc:
                count_str = ", ".join(f"{k}={v}" for k, v in kc.items())
                lines.append(f"    Keyword counts: {count_str}")
        lines.append("")

    # Content excerpt of each file (first 500 characters)
    lines.append("=== File Content Summaries (first 500 chars each) ===")
    for f in txt_files:
        try:
            content = Path(f["txt_path"]).read_text(encoding="utf-8")
            snippet = content[:500].replace("\n", " ")
            lines.append(f"  [{f['subdir_name']}]: {snippet}...")
        except Exception:
            lines.append(f"  [{f['subdir_name']}]: (unable to read)")
    lines.append("")

    return "\n".join(lines)


def _build_ai_prompt(context: str) -> list[dict[str, str]]:
    """Build the message list sent to the AI"""
    system_prompt = (
        "You are a Help File Quality Assurance Analyst AI.\n"
        "Your task is to analyze help file content differences and keyword coverage,\n"
        "then produce a structured JSON analysis report.\n\n"
        "You MUST respond with ONLY a valid JSON object (no markdown fences, no extra text).\n"
        "The JSON must follow this exact structure:\n"
        "{\n"
        '  "summary": "Overall summary of content comparison across all files",\n'
        '  "keyDifferences": ["List of major content differences found"],\n'
        '  "keywordCoverage": {\n'
        '    "keyword_name": {\n'
        '      "total": 0,\n'
        '      "files_with_hits": 0,\n'
        '      "files_without_hits": 0,\n'
        '      "assessment": "good/poor/missing"\n'
        "    }\n"
        "  },\n"
        '  "qualityIssues": ["List of potential content inconsistencies or missing sections"],\n'
        '  "recommendations": ["Actionable suggestions for improvement"]\n'
        "}\n\n"
        "Be thorough but concise. Focus on actionable insights."
    )

    user_prompt = (
        "Please analyze the following help files and generate a quality assessment report.\n\n"
        f"{context}\n\n"
        "Generate the JSON analysis report now."
    )

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def _parse_ai_response(raw: str) -> dict:
    """Parse the JSON returned by the AI, handling possible format issues"""
    # Strip a possible markdown code block
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # Remove the ```json ... ``` wrapper
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to extract a JSON object from the text
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                pass
        # Final fallback
        return {
            "summary": cleaned[:500],
            "keyDifferences": [],
            "keywordCoverage": {},
            "qualityIssues": ["AI response could not be parsed as structured JSON"],
            "recommendations": ["Retry the analysis or check Ollama model availability"],
        }


# ── HTML report generation ─────────────────────────────────────────────

def _generate_analysis_html(analysis: dict, model_used: str, duration_ms: int) -> str:
    """Generate a human-readable HTML analysis report"""
    summary = analysis.get("summary", "No summary available")
    key_diffs = analysis.get("keyDifferences", [])
    kw_coverage = analysis.get("keywordCoverage", {})
    quality_issues = analysis.get("qualityIssues", [])
    recommendations = analysis.get("recommendations", [])

    # Build HTML fragments
    diffs_html = ""
    for i, d in enumerate(key_diffs, 1):
        diffs_html += f'<li class="diff-item">{d}</li>\n'
    if not diffs_html:
        diffs_html = '<li class="empty">No significant differences identified</li>'

    kw_rows = ""
    for kw, data in kw_coverage.items():
        if isinstance(data, dict):
            total = data.get("total", 0)
            with_hits = data.get("files_with_hits", 0)
            without_hits = data.get("files_without_hits", 0)
            assessment = data.get("assessment", "unknown")
        else:
            total = with_hits = without_hits = 0
            assessment = "unknown"
        badge_cls = {
            "good": "badge-good", "poor": "badge-poor", "missing": "badge-missing",
        }.get(assessment, "badge-unknown")
        kw_rows += f"""
        <tr>
            <td>{kw}</td>
            <td>{total}</td>
            <td>{with_hits}</td>
            <td>{without_hits}</td>
            <td><span class="badge {badge_cls}">{assessment}</span></td>
        </tr>"""

    issues_html = ""
    for issue in quality_issues:
        issues_html += f'<div class="issue-item">⚠ {issue}</div>\n'
    if not issues_html:
        issues_html = '<div class="empty">No quality issues detected</div>'

    recs_html = ""
    for rec in recommendations:
        recs_html += f'<div class="rec-item">💡 {rec}</div>\n'
    if not recs_html:
        recs_html = '<div class="empty">No recommendations</div>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Helpfile AI Analysis Report</title>
<style>
    :root {{
        --bg: #0f172a; --surface: #1e293b; --border: #334155;
        --text: #f1f5f9; --text-muted: #94a3b8;
        --green: #10b981; --red: #ef4444; --amber: #f59e0b; --cyan: #06b6d4;
    }}
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--bg); color: var(--text); padding: 2rem;
    }}
    .container {{ max-width: 960px; margin: 0 auto; }}
    header {{
        text-align: center; margin-bottom: 2rem;
        padding-bottom: 1.5rem; border-bottom: 1px solid var(--border);
    }}
    header h1 {{ font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }}
    header .meta {{ font-size: 0.8rem; color: var(--text-muted); }}
    .section {{
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;
    }}
    .section h2 {{
        font-size: 1rem; font-weight: 600; margin-bottom: 1rem;
        color: var(--cyan); border-bottom: 1px solid var(--border);
        padding-bottom: 0.5rem;
    }}
    .summary-text {{ font-size: 0.9rem; line-height: 1.6; color: var(--text); }}
    .diff-item, .issue-item, .rec-item {{
        font-size: 0.85rem; padding: 0.5rem 0.8rem;
        margin-bottom: 0.4rem; border-radius: 6px;
    }}
    .diff-item {{ background: rgba(6,182,212,0.08); border-left: 3px solid var(--cyan); }}
    .issue-item {{ background: rgba(245,158,11,0.08); color: var(--amber); }}
    .rec-item {{ background: rgba(16,185,129,0.08); color: var(--green); }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; }}
    th {{ text-align: left; padding: 0.5rem; color: var(--text-muted); border-bottom: 1px solid var(--border); }}
    td {{ padding: 0.5rem; border-bottom: 1px solid rgba(51,65,85,0.5); }}
    .badge {{
        font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.5rem;
        border-radius: 6px; text-transform: uppercase;
    }}
    .badge-good {{ background: rgba(16,185,129,0.15); color: var(--green); }}
    .badge-poor {{ background: rgba(245,158,11,0.15); color: var(--amber); }}
    .badge-missing {{ background: rgba(239,68,68,0.15); color: var(--red); }}
    .badge-unknown {{ background: rgba(148,163,184,0.15); color: var(--text-muted); }}
    .empty {{ font-size: 0.8rem; color: var(--text-muted); font-style: italic; }}
    .footer {{
        text-align: center; margin-top: 2rem; padding-top: 1rem;
        border-top: 1px solid var(--border); font-size: 0.7rem; color: var(--text-muted);
    }}
</style>
</head>
<body>
<div class="container">
    <header>
        <h1>Helpfile AI Analysis Report</h1>
        <div class="meta">
            <div>Model: {model_used} &nbsp;|&nbsp; Analysis Time: {duration_ms}ms</div>
            <div>Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
        </div>
    </header>

    <div class="section">
        <h2>Summary</h2>
        <div class="summary-text">{summary}</div>
    </div>

    <div class="section">
        <h2>Key Differences</h2>
        <ul style="list-style:none;">{diffs_html}</ul>
    </div>

    <div class="section">
        <h2>Keyword Coverage</h2>
        <table>
            <thead>
                <tr><th>Keyword</th><th>Total</th><th>Files with Hits</th><th>Files without</th><th>Assessment</th></tr>
            </thead>
            <tbody>{kw_rows}</tbody>
        </table>
    </div>

    <div class="section">
        <h2>Quality Issues</h2>
        {issues_html}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        {recs_html}
    </div>

    <div class="footer">
        Slot Game Testing Harness &mdash; Helpfile AI Analysis Report (Local Ollama)
    </div>
</div>
</body>
</html>"""


# ── Plugin ─────────────────────────────────────────────────────

class HelpfileAnalyzerTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="helpfile_analyzer",
            description=(
                "Invokes local AI model (Ollama) to analyze help file conversion results. "
                "Generates intelligent analysis report with content comparison summary, "
                "keyword coverage assessment, quality issues, and recommendations."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(
                    name="txt_files", type="array", required=True,
                    description='TXT file entries: [{"subdir_name": "xxx", "txt_path": "/path/file.txt"}]',
                ),
                ToolParameter(
                    name="keywords", type="array", required=True,
                    description="Keywords for coverage analysis",
                ),
                ToolParameter(
                    name="output_folder", type="string", required=True,
                    description="Absolute path for analysis report output",
                ),
                ToolParameter(
                    name="comparison_results", type="array", default=None,
                    description="Optional: diff_comparator comparison results for richer analysis",
                ),
                ToolParameter(
                    name="ollama_base_url", type="string", default="http://localhost:11434",
                    description="Ollama service base URL",
                ),
                ToolParameter(
                    name="ollama_model", type="string", default="qwen3:latest",
                    description="Ollama model name to use for analysis",
                ),
            ]),
            permissions=["filesystem:read", "filesystem:write", "network:outbound"],
            timeout_seconds=300,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        txt_files: list[dict] = params["txt_files"]
        keywords: list[str] = params["keywords"]
        output_folder = Path(params["output_folder"])
        comparison_results: list[dict] | None = params.get("comparison_results")
        ollama_url: str = params.get("ollama_base_url", "http://localhost:11434").rstrip("/")
        ollama_model: str = params.get("ollama_model", "qwen3:latest")
        output_folder.mkdir(parents=True, exist_ok=True)

        t0 = time.perf_counter()

        # ── 1. Check the Ollama service ────────────────────────────────
        health = await _ollama_health_check(ollama_url)
        if not health["online"]:
            return ToolResult(
                success=False,
                error=f"ollama_unavailable:{health.get('error', 'unknown')}."
                      f" Please ensure Ollama is running at {ollama_url}",
            )

        # Check whether the model is available
        available_models = health.get("models", [])
        model_found = any(ollama_model in m for m in available_models)
        if not model_found and available_models:
            # Try to use the first available model
            fallback_model = available_models[0]
            log.warning(
                "helpfile_analyzer.model_not_found",
                requested=ollama_model,
                fallback=fallback_model,
                available=available_models,
            )
            ollama_model = fallback_model

        log.info("helpfile_analyzer.start", model=ollama_model, files=len(txt_files))

        # ── 2. Build the analysis context ──────────────────────────────────
        context = _build_analysis_context(txt_files, keywords, comparison_results)
        messages = _build_ai_prompt(context)

        # ── 3. Call the local AI model ────────────────────────────────
        try:
            raw_response = await _ollama_chat(ollama_url, ollama_model, messages, timeout_sec=120)
        except Exception as e:
            return ToolResult(
                success=False,
                error=f"ollama_chat_error:{e}",
            )

        # ── 4. Parse the AI response ────────────────────────────────────
        analysis = _parse_ai_response(raw_response)
        duration_ms = int((time.perf_counter() - t0) * 1000)

        log.info("helpfile_analyzer.complete", duration_ms=duration_ms)

        # ── 5. Save reports ────────────────────────────────────────
        # JSON report
        report_json = {
            "ai_analysis": analysis,
            "model_used": ollama_model,
            "analysis_duration_ms": duration_ms,
            "files_analyzed": len(txt_files),
            "keywords_analyzed": keywords,
        }
        json_path = output_folder / "ai_analysis_report.json"
        json_path.write_text(json.dumps(report_json, indent=2, ensure_ascii=False), encoding="utf-8")

        # HTML report
        html_content = _generate_analysis_html(analysis, ollama_model, duration_ms)
        html_path = output_folder / "ai_analysis_report.html"
        html_path.write_text(html_content, encoding="utf-8")

        return ToolResult(
            success=True,
            content={
                "ai_analysis": analysis,
                "report_json_path": str(json_path.resolve()),
                "report_html_path": str(html_path.resolve()),
                "model_used": ollama_model,
                "analysis_duration_ms": duration_ms,
            },
            artifacts=[str(json_path.resolve()), str(html_path.resolve())],
        )
