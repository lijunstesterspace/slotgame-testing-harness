"""Plugin: helpfile_analyzer — asks a local AI model (Ollama) to analyze the helpfile report

Runs after helpfile_report, reading the JSON that step wrote. It is an optional pipeline step:
if Ollama is down or too slow, the deterministic helpfile_report.html is still there.
"""
from __future__ import annotations
import html
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)
from server.infra.logger import log


# Local CPU inference is slow (a 4B model runs at ~7 tok/s); the plugin timeout must exceed this
_OLLAMA_CHAT_TIMEOUT_SEC = 540

# Models that cannot (or should not) answer a local chat request
_NON_CHAT_MODEL_HINTS = ("embed", ":cloud", "-cloud")


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


def _pick_model(requested: str, available: list[str]) -> str | None:
    """Exact name first, then same family with another tag, then the first chat-capable local model"""
    if requested in available:
        return requested
    base = requested.split(":")[0]
    for m in available:
        if m.split(":")[0] == base:
            return m
    for m in available:
        if not any(h in m for h in _NON_CHAT_MODEL_HINTS):
            return m
    return None


async def _ollama_chat(
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    timeout_sec: int = _OLLAMA_CHAT_TIMEOUT_SEC,
) -> str:
    """Call the Ollama /api/chat endpoint (non-streaming).

    think=False: reasoning models (qwen3 / qwen3.5 / deepseek-r1) otherwise spend thousands of
    tokens thinking before the answer — on a local 4B model that alone takes several minutes.
    format="json" makes Ollama constrain the output to a JSON object.
    """
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec, connect=10)) as client:
        resp = await client.post(
            f"{base_url}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "think": False,
                "format": "json",
                "options": {
                    "temperature": 0.3,
                    "num_predict": 2048,
                    "num_ctx": 8192,
                },
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama API error: HTTP {resp.status_code} - {resp.text}")
        data = resp.json()
        return data.get("message", {}).get("content", "")


# ── Analysis data preparation ──────────────────────────────────────────────

def _build_analysis_context(report: dict, max_chars: int = 12000) -> str:
    """Turn helpfile_report's JSON into the prompt context: real diff lines + computed coverage"""
    lines: list[str] = []

    lines.append(f"=== Files (baseline: {report.get('baseline', '?')}) ===")
    for f in report.get("files", []):
        lines.append(f"  - {f['name']} ({f['lines']} lines)")
    lines.append("")

    lines.append("=== Keyword Coverage (computed occurrence counts per file) ===")
    coverage = report.get("keyword_coverage", {})
    if coverage:
        for kw, c in coverage.items():
            per = ", ".join(f"{n}={v}" for n, v in c["per_file"].items())
            lines.append(f"  '{kw}': {per}")
    else:
        lines.append("  (no keywords supplied)")
    lines.append("")

    lines.append("=== Differences vs Baseline ('-' = only in baseline, '+' = only in target) ===")
    for comp in report.get("comparisons", []):
        title = f"{comp.get('baseline')} vs {comp.get('target')}"
        if "error" in comp:
            lines.append(f"--- {title}: comparison error: {comp['error']}")
            continue
        if comp.get("identical"):
            lines.append(f"--- {title}: identical")
            continue
        lines.append(f"--- {title}: -{comp['lines_removed']} / +{comp['lines_added']} lines")
        lines.extend(f"- {l}" for l in comp.get("removed_excerpt", [])[:30])
        lines.extend(f"+ {l}" for l in comp.get("added_excerpt", [])[:30])
        lines.append("")

    ctx = "\n".join(lines)
    if len(ctx) > max_chars:
        ctx = ctx[:max_chars] + "\n... (context truncated)"
    return ctx


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
        '  "qualityIssues": ["List of potential content inconsistencies or missing sections"],\n'
        '  "recommendations": ["Actionable suggestions for improvement"]\n'
        "}\n\n"
        "Keyword counts are already computed for you - do not recount them, but do point out\n"
        "keywords that are missing from some files.\n"
        "Base every statement on the diff lines provided; do not invent content.\n"
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
    # Strip reasoning blocks some models still inline into content
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if not cleaned:
        return {
            "summary": "The model returned an empty response.",
            "keyDifferences": [],
            "qualityIssues": ["AI response was empty (output budget exhausted or model error)"],
            "recommendations": ["Retry the analysis or pick a non-reasoning model"],
        }
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
            "qualityIssues": ["AI response could not be parsed as structured JSON"],
            "recommendations": ["Retry the analysis or check Ollama model availability"],
        }


# ── HTML report generation ─────────────────────────────────────────────

def _as_list(value: Any) -> list:
    """Small models sometimes return a string where a list is expected"""
    if isinstance(value, list):
        return value
    return [value] if value else []


def _generate_analysis_html(analysis: dict, model_used: str, duration_ms: int, base_report_html: str) -> str:
    """Generate a human-readable HTML analysis report"""
    esc = lambda v: html.escape(str(v))
    summary = esc(analysis.get("summary", "No summary available"))

    def items(key: str, cls: str, prefix: str, empty: str) -> str:
        out = "".join(f'<div class="{cls}">{prefix}{esc(v)}</div>\n' for v in _as_list(analysis.get(key)))
        return out or f'<div class="empty">{empty}</div>'

    diffs_html = items("keyDifferences", "diff-item", "", "No significant differences identified")
    issues_html = items("qualityIssues", "issue-item", "⚠ ", "No quality issues detected")
    recs_html = items("recommendations", "rec-item", "💡 ", "No recommendations")
    base_link = (f'<a href="{esc(Path(base_report_html).resolve().as_uri())}">helpfile_report.html</a>'
                 if base_report_html else "helpfile_report.html")

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
    a {{ color: var(--cyan); }}
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
            <div>Model: {esc(model_used)} &nbsp;|&nbsp; Analysis Time: {duration_ms}ms</div>
            <div>Generated: {time.strftime('%Y-%m-%d %H:%M:%S')} &nbsp;|&nbsp; Data: {base_link}</div>
        </div>
    </header>

    <div class="section">
        <h2>Summary</h2>
        <div class="summary-text">{summary}</div>
    </div>

    <div class="section">
        <h2>Key Differences</h2>
        {diffs_html}
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
        Slot Game Testing Harness &mdash; Helpfile AI Analysis Report (Local Ollama).
        Keyword counts and full diffs are in the comparison report.
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
                "Invokes local AI model (Ollama) to analyze the report written by helpfile_report. "
                "Produces a summary, key differences, quality issues and recommendations."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(
                    name="report_json_path", type="string", required=True,
                    description="helpfile_report.json written by the helpfile_report plugin",
                ),
                ToolParameter(
                    name="output_folder", type="string", required=True,
                    description="Absolute path for analysis report output",
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
            # Must exceed _OLLAMA_CHAT_TIMEOUT_SEC; tools_router waits exactly this long
            timeout_seconds=_OLLAMA_CHAT_TIMEOUT_SEC + 60,
            version="2.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        report_json_path = Path(params["report_json_path"])
        output_folder = Path(params["output_folder"])
        ollama_url: str = (params.get("ollama_base_url") or "http://localhost:11434").rstrip("/")
        ollama_model: str = params.get("ollama_model") or "qwen3:latest"
        output_folder.mkdir(parents=True, exist_ok=True)

        try:
            report = json.loads(report_json_path.read_text(encoding="utf-8"))
        except Exception as e:
            return ToolResult(success=False, error=f"report_unreadable:{report_json_path}: {e}")

        t0 = time.perf_counter()

        # ── 1. Check the Ollama service ────────────────────────────────
        health = await _ollama_health_check(ollama_url)
        if not health["online"]:
            return ToolResult(
                success=False,
                error=f"ollama_unavailable:{health.get('error', 'unknown')}."
                      f" Please ensure Ollama is running at {ollama_url}",
            )

        available_models = health.get("models", [])
        picked = _pick_model(ollama_model, available_models)
        if picked is None:
            return ToolResult(
                success=False,
                error=f"ollama_no_chat_model: '{ollama_model}' is not installed and no local chat model "
                      f"is available (found: {available_models})",
            )
        if picked != ollama_model:
            log.warning(
                "helpfile_analyzer.model_not_found",
                requested=ollama_model,
                fallback=picked,
                available=available_models,
            )
            ollama_model = picked

        log.info("helpfile_analyzer.start", model=ollama_model, files=len(report.get("files", [])))

        # ── 2. Call the local AI model ────────────────────────────────
        messages = _build_ai_prompt(_build_analysis_context(report))
        try:
            raw_response = await _ollama_chat(ollama_url, ollama_model, messages)
        except httpx.TimeoutException as e:
            # str() of an httpx timeout is usually empty, which hid the cause in the UI
            return ToolResult(
                success=False,
                error=f"ollama_timeout:{type(e).__name__} - model '{ollama_model}' did not answer "
                      f"within {_OLLAMA_CHAT_TIMEOUT_SEC}s",
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=f"ollama_chat_error:{type(e).__name__}: {e}",
            )

        # ── 3. Parse the AI response ────────────────────────────────────
        analysis = _parse_ai_response(raw_response)
        duration_ms = int((time.perf_counter() - t0) * 1000)

        log.info("helpfile_analyzer.complete", duration_ms=duration_ms)

        # ── 4. Save reports ────────────────────────────────────────
        report_json = {
            "ai_analysis": analysis,
            "model_used": ollama_model,
            "analysis_duration_ms": duration_ms,
            "source_report": str(report_json_path.resolve()),
        }
        json_path = output_folder / "ai_analysis_report.json"
        json_path.write_text(json.dumps(report_json, indent=2, ensure_ascii=False), encoding="utf-8")

        base_html = report_json_path.with_suffix(".html")
        html_content = _generate_analysis_html(
            analysis, ollama_model, duration_ms, str(base_html) if base_html.exists() else "",
        )
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
