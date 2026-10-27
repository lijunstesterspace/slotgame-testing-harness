"""Plugin: helpfile_report — deterministic HTML/JSON report of the conversion + diff results (no AI)

This step always produces a report. The optional AI step (helpfile_analyzer) reads the JSON
written here, so a missing/slow local model never costs the user their report.
"""
from __future__ import annotations
import difflib
import html
import json
import time
from pathlib import Path
from typing import Any

from server.tools.impl.html_to_text_converter_tool import pick_baseline
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)

REPORT_JSON_NAME = "helpfile_report.json"
REPORT_HTML_NAME = "helpfile_report.html"


def _read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except Exception:
        return ""


def compute_keyword_coverage(texts: dict[str, str], keywords: list[str]) -> dict[str, dict]:
    """Per-keyword occurrence counts per file, plus a good/poor/missing assessment"""
    lowered = {name: t.lower() for name, t in texts.items()}
    coverage: dict[str, dict] = {}
    for kw in keywords:
        per_file = {name: t.count(kw.lower()) for name, t in lowered.items()}
        with_hits = sum(1 for c in per_file.values() if c > 0)
        without = len(per_file) - with_hits
        assessment = "missing" if with_hits == 0 else ("good" if without == 0 else "poor")
        coverage[kw] = {
            "total": sum(per_file.values()),
            "files_with_hits": with_hits,
            "files_without_hits": without,
            "assessment": assessment,
            "per_file": per_file,
        }
    return coverage


def _diff_lines(baseline_text: str, target_text: str) -> tuple[list[str], list[str]]:
    """Lines only in the baseline (removed) and lines only in the target (added)"""
    diff = difflib.unified_diff(baseline_text.splitlines(), target_text.splitlines(), lineterm="", n=0)
    removed: list[str] = []
    added: list[str] = []
    for line in diff:
        if line.startswith(("---", "+++", "@@")):
            continue
        if line.startswith("-"):
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append(line[1:])
    return removed, added


def build_report_data(
    txt_files: list[dict],
    keywords: list[str],
    comparison_results: list[dict],
    baseline_file: str,
    excel_report: str,
    max_diff_lines: int = 60,
) -> dict:
    """Everything the HTML report (and the AI step) needs, as plain JSON-able data"""
    texts = {f["subdir_name"]: _read_text(f["txt_path"]) for f in txt_files}
    paths = {f["subdir_name"]: f["txt_path"] for f in txt_files}
    baseline_text = _read_text(baseline_file) if baseline_file else ""

    comparisons: list[dict] = []
    for comp in comparison_results or []:
        target = comp.get("target", "")
        entry: dict[str, Any] = {
            "baseline": comp.get("baseline", ""),
            "target": target,
            "diff_html_path": comp.get("diff_html_path", ""),
        }
        if "error" in comp:
            entry["error"] = comp["error"]
        else:
            removed, added = _diff_lines(baseline_text, texts.get(target, ""))
            entry.update({
                "lines_removed": len(removed),
                "lines_added": len(added),
                "removed_excerpt": [l[:300] for l in removed[:max_diff_lines]],
                "added_excerpt": [l[:300] for l in added[:max_diff_lines]],
                "identical": not removed and not added,
            })
        comparisons.append(entry)

    return {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "baseline": next((n for n, p in paths.items() if p == baseline_file), Path(baseline_file).stem),
        "files": [
            {"name": n, "txt_path": paths[n], "chars": len(t), "lines": len(t.splitlines())}
            for n, t in texts.items()
        ],
        "keywords": keywords,
        "keyword_coverage": compute_keyword_coverage(texts, keywords),
        "comparisons": comparisons,
        "excel_report": excel_report,
    }


def _render_html(data: dict) -> str:
    esc = lambda v: html.escape(str(v))
    file_uri = lambda p: Path(p).resolve().as_uri() if p else ""

    base_badge = ' <span class="badge badge-base">baseline</span>'
    files_rows = "".join(
        f"<tr><td>{esc(f['name'])}{base_badge if f['name'] == data['baseline'] else ''}</td>"
        f"<td>{f['lines']}</td><td>{f['chars']}</td></tr>"
        for f in data["files"]
    )

    names = [f["name"] for f in data["files"]]
    head_cells = "".join(f"<th>{esc(n)}</th>" for n in names)
    kw_rows = ""
    for kw, c in data["keyword_coverage"].items():
        cells = ""
        for n in names:
            count = c["per_file"].get(n, 0)
            cells += f'<td class="{"zero" if count == 0 else ""}">{count}</td>'
        kw_rows += (
            f"<tr><td>{esc(kw)}</td>{cells}<td>{c['total']}</td>"
            f"<td><span class=\"badge badge-{c['assessment']}\">{c['assessment']}</span></td></tr>"
        )
    if not kw_rows:
        kw_rows = f'<tr><td colspan="{len(names) + 3}" class="empty">No keywords supplied</td></tr>'

    comp_html = ""
    for comp in data["comparisons"]:
        link = (f' &middot; <a href="{esc(file_uri(comp["diff_html_path"]))}">full diff</a>'
                if comp.get("diff_html_path") else "")
        title = f"{esc(comp['baseline'])} &rarr; {esc(comp['target'])}"
        if "error" in comp:
            comp_html += f'<div class="comp"><h3>{title}</h3><div class="issue">Comparison error: {esc(comp["error"])}</div></div>'
            continue
        if comp["identical"]:
            comp_html += f'<div class="comp"><h3>{title} <span class="badge badge-good">identical</span>{link}</h3></div>'
            continue
        removed = "".join(f'<div class="del">- {esc(l)}</div>' for l in comp["removed_excerpt"])
        added = "".join(f'<div class="add">+ {esc(l)}</div>' for l in comp["added_excerpt"])
        more = ""
        if comp["lines_removed"] > len(comp["removed_excerpt"]) or comp["lines_added"] > len(comp["added_excerpt"]):
            more = '<div class="empty">Excerpt truncated — open the full diff for everything.</div>'
        comp_html += (
            f'<div class="comp"><h3>{title} <span class="stat">-{comp["lines_removed"]} / +{comp["lines_added"]} lines</span>{link}</h3>'
            f'<div class="diff">{removed}{added}</div>{more}</div>'
        )
    if not comp_html:
        comp_html = '<div class="empty">Only one file — nothing to compare against the baseline.</div>'

    excel = (f'<a href="{esc(file_uri(data["excel_report"]))}">{esc(data["excel_report"])}</a>'
             if data.get("excel_report") else "—")
    changed = sum(1 for c in data["comparisons"] if not c.get("identical") and "error" not in c)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Helpfile Comparison Report</title>
<style>
    :root {{
        --bg: #0f172a; --surface: #1e293b; --border: #334155;
        --text: #f1f5f9; --text-muted: #94a3b8;
        --green: #10b981; --red: #ef4444; --amber: #f59e0b; --cyan: #06b6d4;
    }}
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--bg); color: var(--text); padding: 2rem; }}
    a {{ color: var(--cyan); }}
    .container {{ max-width: 1100px; margin: 0 auto; }}
    header {{ text-align: center; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }}
    header h1 {{ font-size: 1.5rem; margin-bottom: 0.5rem; }}
    .meta {{ font-size: 0.8rem; color: var(--text-muted); }}
    .section {{ background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; overflow-x: auto; }}
    .section h2 {{ font-size: 1rem; margin-bottom: 1rem; color: var(--cyan); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; }}
    th {{ text-align: left; padding: 0.5rem; color: var(--text-muted); border-bottom: 1px solid var(--border); }}
    td {{ padding: 0.5rem; border-bottom: 1px solid rgba(51,65,85,0.5); }}
    td.zero {{ color: var(--red); font-weight: 700; }}
    .badge {{ font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 6px; text-transform: uppercase; }}
    .badge-good {{ background: rgba(16,185,129,0.15); color: var(--green); }}
    .badge-poor {{ background: rgba(245,158,11,0.15); color: var(--amber); }}
    .badge-missing {{ background: rgba(239,68,68,0.15); color: var(--red); }}
    .badge-base {{ background: rgba(6,182,212,0.15); color: var(--cyan); }}
    .comp {{ margin-bottom: 1.25rem; }}
    .comp h3 {{ font-size: 0.9rem; margin-bottom: 0.5rem; }}
    .stat {{ font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }}
    .diff {{ font-family: Consolas, monospace; font-size: 0.78rem; border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; }}
    .del {{ color: #fca5a5; background: rgba(239,68,68,0.08); white-space: pre-wrap; }}
    .add {{ color: #86efac; background: rgba(16,185,129,0.08); white-space: pre-wrap; }}
    .issue {{ color: var(--amber); font-size: 0.85rem; }}
    .empty {{ font-size: 0.8rem; color: var(--text-muted); font-style: italic; margin-top: 0.4rem; }}
    .footer {{ text-align: center; margin-top: 2rem; font-size: 0.7rem; color: var(--text-muted); }}
</style>
</head>
<body>
<div class="container">
    <header>
        <h1>Helpfile Comparison Report</h1>
        <div class="meta">
            <div>Baseline: {esc(data['baseline'] or '—')} &nbsp;|&nbsp; {len(data['files'])} file(s) &nbsp;|&nbsp; {changed} differ from baseline</div>
            <div>Generated: {esc(data['generated_at'])} &nbsp;|&nbsp; Excel: {excel}</div>
        </div>
    </header>

    <div class="section">
        <h2>Files</h2>
        <table><thead><tr><th>File</th><th>Lines</th><th>Chars</th></tr></thead><tbody>{files_rows}</tbody></table>
    </div>

    <div class="section">
        <h2>Keyword Coverage</h2>
        <table>
            <thead><tr><th>Keyword</th>{head_cells}<th>Total</th><th>Assessment</th></tr></thead>
            <tbody>{kw_rows}</tbody>
        </table>
    </div>

    <div class="section">
        <h2>Differences vs Baseline</h2>
        {comp_html}
    </div>

    <div class="footer">Slot Game Testing Harness &mdash; Helpfile Comparison Report (AI analysis, if run, is in ai_analysis_report.html)</div>
</div>
</body>
</html>"""


class HelpfileReportTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="helpfile_report",
            description=(
                "Builds a deterministic HTML/JSON report from help file conversion + diff results: "
                "file inventory, per-file keyword coverage and baseline differences. No AI involved."
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
                    description="Absolute path for report output",
                ),
                ToolParameter(
                    name="comparison_results", type="array", default=None,
                    description="diff_comparator comparison results",
                ),
                ToolParameter(
                    name="baseline_file", type="string", default="",
                    description="Baseline TXT path used by diff_comparator",
                ),
                ToolParameter(
                    name="excel_report", type="string", default="",
                    description="Path of diff_comparator's Excel report, linked from the HTML",
                ),
            ]),
            permissions=["filesystem:read", "filesystem:write"],
            timeout_seconds=60,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        txt_files: list[dict] = params["txt_files"]
        output_folder = Path(params["output_folder"])
        if not txt_files:
            return ToolResult(success=False, error="txt_files_empty: No TXT files provided")
        output_folder.mkdir(parents=True, exist_ok=True)

        baseline_file = params.get("baseline_file") or pick_baseline(txt_files)["txt_path"]
        data = build_report_data(
            txt_files,
            params.get("keywords") or [],
            params.get("comparison_results") or [],
            baseline_file,
            params.get("excel_report") or "",
        )

        json_path = output_folder / REPORT_JSON_NAME
        json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        html_path = output_folder / REPORT_HTML_NAME
        html_path.write_text(_render_html(data), encoding="utf-8")

        return ToolResult(
            success=True,
            content={
                "report_html_path": str(html_path.resolve()),
                "report_json_path": str(json_path.resolve()),
                "files_count": len(data["files"]),
                "changed_count": sum(1 for c in data["comparisons"] if not c.get("identical") and "error" not in c),
                "missing_keywords": [k for k, c in data["keyword_coverage"].items() if c["assessment"] != "good"],
            },
            artifacts=[str(html_path.resolve()), str(json_path.resolve())],
        )
