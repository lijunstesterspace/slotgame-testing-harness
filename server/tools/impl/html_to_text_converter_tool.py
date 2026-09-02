"""Plugin: html_to_text_converter — 批量将HTML帮助文件转换为纯文本"""
from __future__ import annotations
from pathlib import Path
from typing import Any

import html2text

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter,
    ToolResult, HarnessContext,
)


def _build_converter() -> html2text.HTML2Text:
    """构建标准化的 html2text 转换器"""
    h = html2text.HTML2Text()
    h.ignore_links = True
    h.ignore_images = True
    h.ignore_emphasis = True
    h.body_width = 0
    h.single_line_break = True
    h.skip_internal_links = True
    h.bypass_tables = True
    h.mark_code = False
    return h


def _post_process(txt: str) -> str:
    """后处理：去除空行、统一换行"""
    lines = [line.strip() for line in txt.split("\n") if line.strip()]
    return "\n".join(lines)


class HtmlToTextConverterTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="html_to_text_converter",
            description=(
                "Batch-converts HTML help files to plain text. "
                "Scans source_folder subdirectories for index.html, "
                "converts each to clean TXT, and determines the baseline file."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(
                    name="source_folder", type="string", required=True,
                    description="Absolute path to the source folder containing subdirectories with index.html",
                ),
                ToolParameter(
                    name="output_folder", type="string", required=True,
                    description="Absolute path to the output folder for converted TXT files",
                ),
            ]),
            permissions=["filesystem:read", "filesystem:write"],
            timeout_seconds=120,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        source_folder = Path(params["source_folder"])
        output_folder = Path(params["output_folder"])
        output_folder.mkdir(parents=True, exist_ok=True)

        if not source_folder.is_dir():
            return ToolResult(success=False, error=f"source_folder_not_found:{source_folder}")

        converter = _build_converter()
        converted_files: list[dict] = []

        # 按子目录名排序遍历，确保确定性
        subdirs = sorted(
            [d for d in source_folder.iterdir() if d.is_dir()],
            key=lambda p: p.name,
        )

        for subdir in subdirs:
            html_path = subdir / "index.html"
            if not html_path.exists():
                continue

            # 读取并转换 HTML
            try:
                html_content = html_path.read_text(encoding="utf-8")
                txt_content = converter.handle(html_content)
                txt_content = _post_process(txt_content)
            except Exception as e:
                return ToolResult(
                    success=False,
                    error=f"conversion_error:{subdir.name}:{e}",
                )

            # 保存 TXT
            txt_filename = f"{subdir.name}.txt"
            txt_path = output_folder / txt_filename
            txt_path.write_text(txt_content, encoding="utf-8")

            converted_files.append({
                "subdir_name": subdir.name,
                "html_path": str(html_path.resolve()),
                "txt_path": str(txt_path.resolve()),
                "char_count": len(txt_content),
            })

        if not converted_files:
            return ToolResult(
                success=False,
                error="no_html_files_found: No subdirectories with index.html were found",
            )

        # 基准文件 = 字母序第一个
        baseline_file = converted_files[0]["txt_path"]

        return ToolResult(
            success=True,
            content={
                "converted_files": converted_files,
                "total_converted": len(converted_files),
                "baseline_file": baseline_file,
            },
        )
