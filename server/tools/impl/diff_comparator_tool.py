"""Plugin: diff_comparator — diff comparison, keyword highlighting, Excel statistics report"""
from __future__ import annotations
import difflib
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import openpyxl
from bs4 import BeautifulSoup

from server.tools.impl.html_to_text_converter_tool import pick_baseline
from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)


def _safe_filename(name: str) -> str:
    """Replace special characters in a filename with underscores"""
    return re.sub(r"[^A-Za-z0-9_.\-]", "_", name)


def _highlight_keywords_in_html(diff_html: str, keywords: list[str]) -> str:
    """Highlight keywords in the diff HTML (nesting-safe version)

    Fixes the nested <span> issue of the original script:
    1. Sort keywords by length descending so longer words match first
    2. Use BeautifulSoup to process text nodes only
    """
    # Sort keywords by length descending to avoid nesting of short words
    sorted_keywords = sorted(
        [k for k in keywords if k],
        key=len,
        reverse=True,
    )
    if not sorted_keywords:
        return diff_html

    try:
        soup = BeautifulSoup(diff_html, "html.parser")
        for text_node in soup.find_all(string=True):
            if text_node.parent and text_node.parent.name in (
                "script", "style", "head", "title", "meta",
            ):
                continue
            original = str(text_node)
            new_text = original
            for keyword in sorted_keywords:
                try:
                    pattern = re.compile(re.escape(keyword), re.IGNORECASE)
                    new_text = pattern.sub(
                        lambda m: f'<span style="background-color:yellow">{m.group(0)}</span>',
                        new_text,
                    )
                except re.error:
                    continue
            if new_text != original:
                new_frag = BeautifulSoup(new_text, "html.parser")
                text_node.replace_with(new_frag)
        return str(soup)
    except Exception:
        # Fall back to global replacement
        result = diff_html
        for keyword in sorted_keywords:
            try:
                pattern = re.compile(re.escape(keyword), re.IGNORECASE)
                result = pattern.sub(
                    lambda m: f'<span style="background-color:yellow">{m.group(0)}</span>',
                    result,
                )
            except re.error:
                continue
        return result


def _compare_and_mark_files(
    file1: str, file2: str, keywords: list[str],
) -> str:
    """Compare two file contents and mark keywords; return the temporary HTML file path"""
    with open(file1, "r", encoding="utf-8") as f1, open(file2, "r", encoding="utf-8") as f2:
        text1 = f1.readlines()
        text2 = f2.readlines()

    differ = difflib.HtmlDiff()
    diff_html = differ.make_file(text1, text2, file1, file2)

    # Highlight keywords
    diff_html = _highlight_keywords_in_html(diff_html, keywords)

    # Save as a temporary HTML file
    temp_html = tempfile.NamedTemporaryFile(suffix=".html", delete=False)
    temp_html.write(diff_html.encode("utf-8"))
    temp_html.close()
    return temp_html.name


def _take_screenshot(html_file: str, output_image: str) -> bool:
    """Convert the HTML comparison result to an image; return True on success"""
    try:
        import imgkit
    except ImportError:
        return False

    wk = shutil.which("wkhtmltoimage")
    if wk is None:
        exe_dir = os.path.dirname(os.path.abspath(__file__))
        wkhtml_path = os.path.join(exe_dir, "wkhtmltoimage.exe")
        if os.path.exists(wkhtml_path):
            wk = wkhtml_path

    if wk is None:
        return False

    config = imgkit.config(wkhtmltoimage=wk)
    try:
        imgkit.from_file(html_file, output_image, config=config)
        return True
    except Exception:
        return False


class DiffComparatorTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="diff_comparator",
            description=(
                "Compares converted TXT files against a baseline, generates HTML diff reports "
                "with keyword highlighting, optional PNG screenshots, and Excel keyword statistics."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(
                    name="txt_files", type="array", required=True,
                    description='List of TXT file entries: [{"subdir_name": "xxx", "txt_path": "/path/to/file.txt"}]',
                ),
                ToolParameter(
                    name="keywords", type="array", required=True,
                    description="List of keywords to highlight and count",
                ),
                ToolParameter(
                    name="output_folder", type="string", required=True,
                    description="Absolute path for diff reports and Excel output",
                ),
                ToolParameter(
                    name="baseline_file", type="string", default="",
                    description="Baseline TXT file path (defaults to the English file: en, then en-*, else alphabetically first)",
                ),
                ToolParameter(
                    name="generate_png", type="boolean", default=True,
                    description="Whether to generate PNG screenshots of diff HTML",
                ),
            ]),
            permissions=["filesystem:read", "filesystem:write"],
            timeout_seconds=180,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        txt_files: list[dict] = params["txt_files"]
        keywords: list[str] = params["keywords"]
        output_folder = Path(params["output_folder"])
        baseline_file: str = params.get("baseline_file", "")
        generate_png: bool = bool(params.get("generate_png", True))
        output_folder.mkdir(parents=True, exist_ok=True)

        if not txt_files:
            return ToolResult(success=False, error="txt_files_empty: No TXT files provided")

        # Determine the baseline file
        if not baseline_file:
            baseline_file = pick_baseline(txt_files)["txt_path"]

        baseline_name = Path(baseline_file).stem

        # Excel workbook
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        header_row = ["File Name"] + keywords
        sheet.append(header_row)

        comparisons: list[dict] = []

        for entry in txt_files:
            txt_path = entry["txt_path"]
            subdir_name = entry["subdir_name"]

            if txt_path == baseline_file:
                continue

            temp_html = None
            try:
                # Generate the diff comparison
                temp_html = _compare_and_mark_files(baseline_file, txt_path, keywords)

                # Save the diff HTML
                compare_name = subdir_name
                safe_base = _safe_filename(baseline_name)
                safe_compare = _safe_filename(compare_name)
                diff_html_dest = output_folder / f"compare_{safe_base}_vs_{safe_compare}.html"
                shutil.copyfile(temp_html, str(diff_html_dest))

                # Generate PNG
                diff_png_dest = ""
                if generate_png:
                    png_path = output_folder / f"compare_{safe_base}_vs_{safe_compare}.png"
                    if _take_screenshot(str(temp_html), str(png_path)):
                        diff_png_dest = str(png_path.resolve())

                # Count keywords
                txt_content = Path(txt_path).read_text(encoding="utf-8")
                keyword_counts = {
                    kw: txt_content.lower().count(kw.lower())
                    for kw in keywords
                }
                row_data = [subdir_name] + [keyword_counts[kw] for kw in keywords]
                sheet.append(row_data)

                comparisons.append({
                    "baseline": baseline_name,
                    "target": subdir_name,
                    "diff_html_path": str(diff_html_dest.resolve()),
                    "diff_png_path": diff_png_dest,
                    "keyword_counts": keyword_counts,
                })

            except Exception as e:
                comparisons.append({
                    "baseline": baseline_name,
                    "target": subdir_name,
                    "error": str(e),
                })
            finally:
                if temp_html and os.path.exists(temp_html):
                    try:
                        os.unlink(temp_html)
                    except Exception:
                        pass

        # Save Excel
        excel_path = output_folder / "output.xlsx"
        workbook.save(str(excel_path))

        return ToolResult(
            success=True,
            content={
                "comparisons": comparisons,
                "excel_report": str(excel_path.resolve()),
                "total_comparisons": len(comparisons),
            },
        )
