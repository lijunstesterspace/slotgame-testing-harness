"""Plugin: portugal_plugin_symbol_map — 从后端提供的 Portugal Plugin Output Guide（Google Doc → Markdown）导入 letter → SYM 映射

Input is the Google Doc exported via File → Download → Markdown (.md), or the same text pasted.
Confirmed against "Apex Dragon Power Combo™ - Portugal Report Plugin Output Guide.md" (matches
portugal-playcheck-plugin/ppvADPC1.0.py's LETTER_TO_SYM letter for letter):
  - the mapping is one pipe table with header "| Symbol | Definition | Corresponding letter |";
    image cells are `![][imageN]` (sometimes wrapped in **…**) and the image bytes are separate
    `[imageN]: <data:image/png;base64,…>` lines at the end of the file (dropped here);
  - Google escapes markdown characters (`\\#`, `\\-`, `1\\.`), so cells are unescaped after splitting;
  - the intro sentence carries the game name and module id: "…output guide for <Game> 105170";
  - the guide's worked examples (`0:a;p;k;…#MV#100#MT#1#MG#0#`) are parsed with the new map as a
    self-test: any letter they use that the table doesn't define is reported.
Definition cells come in two styles across games: `SYM15` (ADPC) or a bare number `-1` / `15`
(GBOW, where the hand-written map is 'a': 'SYM-1'); both normalise to `SYM<n>`. Anything else
(e.g. `GRAND`) is kept as written.
"""
from __future__ import annotations
import hashlib
import re
from datetime import datetime
from typing import Any

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl import symbol_profiles
from server.tools.impl.portugal_plugin_parser_tool import parse_portugal_plugin

IMAGE_DATA_LINE = re.compile(r"^\[image\d+\]:\s*<data:[^>]*>\s*$", re.M)
MD_ESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|<>~=])")
SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")
GUIDE_FOR = re.compile(r"guide\s+for\s+(.+?)\s+(\d{5,7})\b", re.I)
EXAMPLE_TOKEN = re.compile(r"(?<![\w])\d+:[a-z][^\s]*")


def strip_image_data(md: str) -> str:
    return IMAGE_DATA_LINE.sub("", md)


def unescape(text: str) -> str:
    return MD_ESCAPE.sub(r"\1", text)


def split_row(line: str) -> list[str]:
    """Split a pipe-table row on unescaped '|' and unescape each cell."""
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    cells = re.split(r"(?<!\\)\|", body)
    return [unescape(c).strip() for c in cells]


def _plain(cell: str) -> str:
    """Drop bold/italic markers and image references from a cell."""
    cell = re.sub(r"!\[[^\]]*\]\[[^\]]*\]|!\[[^\]]*\]\([^)]*\)", "", cell)
    return cell.replace("**", "").replace("__", "").strip().strip("*_").strip()


def normalize_definition(value: str) -> str:
    v = _plain(value)
    if re.fullmatch(r"-?\d+", v):
        return f"SYM{int(v)}"
    m = re.fullmatch(r"(?i)sym\s*(-?\d+)", v)
    return f"SYM{int(m.group(1))}" if m else v


def find_symbol_rows(md: str) -> tuple[list[dict], list[str]]:
    """Rows of the table whose header has 'Definition' and '…letter'; headerless continuation
    tables that follow it (same width, single-letter letter cell) are appended."""
    lines = md.splitlines()
    rows: list[dict] = []
    errors: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            header = [c.lower() for c in split_row(lines[i])]
            def_idx = next((k for k, c in enumerate(header) if "definition" in c), None)
            let_idx = next((k for k, c in enumerate(header) if "letter" in c), None)
            if def_idx is not None and let_idx is not None:
                width = len(header)
                j = i + 1
                while j < len(lines):
                    line = lines[j]
                    if not line.strip():
                        # a blank line ends the table unless a same-shaped table follows directly
                        k = j
                        while k < len(lines) and not lines[k].strip():
                            k += 1
                        if k < len(lines) and lines[k].lstrip().startswith("|") and len(split_row(lines[k])) == width \
                                and re.fullmatch(r"[A-Za-z]", _plain(split_row(lines[k])[let_idx])):
                            j = k
                            continue
                        break
                    if not line.lstrip().startswith("|"):
                        break
                    cells = split_row(line)
                    j += 1
                    if all(SEPARATOR_CELL.match(c) for c in cells if c):
                        continue
                    if len(cells) < width:
                        errors.append(f"line {j}: expected {width} cells, got {len(cells)}")
                        continue
                    letter = _plain(cells[let_idx])
                    definition = cells[def_idx]
                    if not re.fullmatch(r"[A-Za-z]", letter):
                        errors.append(f"line {j}: letter cell is not a single letter: {cells[let_idx]!r}")
                        continue
                    if not _plain(definition):
                        errors.append(f"line {j}: empty definition for letter {letter!r}")
                        continue
                    rows.append({"line": j, "letter": letter.upper(), "definition": normalize_definition(definition),
                                 "raw_definition": _plain(definition)})
                return rows, errors
        i += 1
    return rows, ["symbol_table_not_found: no table with 'Definition' and 'Corresponding letter' columns"]


def game_code_from_title(title: str) -> str:
    """Word initials, digits kept: Apex Dragon Power Combo → ADPC, Mega Eagle 2 Ultra → ME2U."""
    words = re.findall(r"[A-Za-z]+|\d+", title)
    return "".join(w if w.isdigit() else w[0].upper() for w in words)


def detect_meta(md: str, file_name: str = "") -> dict[str, str]:
    text = unescape(md)
    m = GUIDE_FOR.search(text)
    title = m.group(1) if m else ""
    module_id = m.group(2) if m else ""
    if not title and file_name:
        title = file_name.split(" - ")[0]
    title = re.sub(r"[™®©]", "", title).strip()
    return {"title": title, "module_id": module_id}


def check_examples(md: str, symbol_map: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Parse the guide's own example strings with the new map; report letters it doesn't define."""
    text = unescape(md)
    examples: list[dict] = []
    warnings: list[str] = []
    seen: set[str] = set()
    for tok in EXAMPLE_TOKEN.findall(text):
        tok = tok.rstrip(".,;")
        if tok in seen or "#" not in tok:
            continue
        seen.add(tok)
        spins, total, parse_warn = parse_portugal_plugin(tok, symbol_map)
        letters = {c for s in spins for row in s["ROWS"] for c in row if re.fullmatch(r"[a-z]", c or "")}
        letters |= {ch for s in spins for w in s["WINNING_SYM"] for ch in w
                    if re.fullmatch(r"[a-z]", ch) and ch.upper() not in symbol_map}
        unmapped = sorted(letters)
        examples.append({"example": tok[:120] + ("…" if len(tok) > 120 else ""), "spins": len(spins),
                         "total_win": total, "unmapped_letters": unmapped})
        if unmapped:
            warnings.append(f"example uses letters not in the table: {', '.join(unmapped)} ({tok[:40]}…)")
        warnings += [f"example parse: {w}" for w in parse_warn]
    return examples, warnings


def build_profile(md: str, file_name: str = "", game_code: str = "", module_id: str = "",
                  title: str = "") -> dict[str, Any]:
    """Pure function: markdown → {profile, errors, warnings, examples}."""
    md = strip_image_data(md.replace("\r\n", "\n"))
    rows, errors = find_symbol_rows(md)
    warnings: list[str] = []

    symbol_map: dict[str, str] = {}
    for r in rows:
        prev = symbol_map.get(r["letter"])
        if prev is not None and prev != r["definition"]:
            errors.append(f"letter {r['letter'].lower()} defined twice: {prev} and {r['definition']} (line {r['line']})")
        symbol_map[r["letter"]] = r["definition"]
    if rows and not errors:
        by_def: dict[str, list[str]] = {}
        for k, v in symbol_map.items():
            by_def.setdefault(v, []).append(k.lower())
        warnings += [f"{d} is assigned to several letters: {', '.join(ls)}" for d, ls in by_def.items() if len(ls) > 1]
        letters = sorted(symbol_map)
        gaps = [chr(c).lower() for c in range(ord(letters[0]), ord(letters[-1]) + 1) if chr(c) not in symbol_map]
        if gaps:
            warnings.append(f"letters missing inside the range {letters[0].lower()}–{letters[-1].lower()}: {', '.join(gaps)}")

    meta = detect_meta(md, file_name)
    title = title or meta["title"]
    module_id = str(module_id or meta["module_id"] or "")
    code = (game_code or game_code_from_title(title)).upper()
    if not code:
        errors.append("game_code_unknown: pass game_code (no game title found in the guide)")
    if not module_id:
        warnings.append("module_id not found in the guide — pass moduleId=… so fetched outcomes pick this map")

    examples, ex_warn = check_examples(md, symbol_map) if symbol_map else ([], [])
    warnings += ex_warn
    return {
        "profile": {
            "game_code": code, "title": title, "module_ids": [module_id] if module_id else [],
            "symbol_map": dict(sorted(symbol_map.items())),
        },
        "rows": len(rows), "errors": errors, "warnings": warnings, "examples": examples,
    }


def diff_maps(old: dict[str, str], new: dict[str, str]) -> dict[str, Any]:
    return {
        "added": {k.lower(): new[k] for k in sorted(new) if k not in old},
        "removed": {k.lower(): old[k] for k in sorted(old) if k not in new},
        "changed": {k.lower(): {"from": old[k], "to": new[k]} for k in sorted(new) if k in old and old[k] != new[k]},
    }


class PortugalPluginSymbolMapTool(ToolPlugin):
    """Stage 0 of portugal-plugin-verify-pipeline: decide which letter → SYM map this run uses.

    - guide attached  → import it (validate, self-test, diff, optionally save) and use it;
    - no guide        → the stored profile for module_id (symbol_profiles/*.json);
    - neither         → fail before any slow browser work, asking for the game's guide;
    - no module_id at all (pasted outcome, no guide) → built-in ACCR, the original tool's table.
    """

    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="portugal_plugin_symbol_map",
            description=(
                "Resolves the letter → SYM mapping for a Portugal Plugin Verification run: imports the "
                "backend team's Output Guide (Google Doc → Markdown) when attached — validating it, "
                "self-testing it on the guide's examples, diffing and saving symbol_profiles/<GAME>.json — "
                "otherwise uses the stored profile for the module id."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="markdown", type="string",
                              description="Attached guide (.md content); empty = use the stored profile"),
                ToolParameter(name="file_name", type="string", description="Original guide file name"),
                ToolParameter(name="module_id", type="string",
                              description="Module under test (from the game URL / moduleId=…)"),
                ToolParameter(name="game_code", type="string", description="Override the profile / game code"),
                ToolParameter(name="save", type="boolean", default=True,
                              description="Save an imported guide (previous version kept in history)"),
            ]),
            permissions=["filesystem:write"],
            timeout_seconds=30,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        md = str(params.get("markdown") or "")
        module_id = str(params.get("module_id") or "").strip()
        game_code = str(params.get("game_code") or "").strip().upper()
        if md.strip():
            return self._import(md, params, module_id, game_code, ctx)

        code = symbol_profiles.profile_for(game_code or None, module_id or None)
        profile = symbol_profiles.get(code)
        if code == "RAW" or profile is None:
            return ToolResult(success=False, error=(
                f"no_symbol_mapping_for_module:{module_id or game_code} — attach this game's Portugal Plugin "
                "Output Guide (Google Doc → File → Download → Markdown) with + and run again"))
        return ToolResult(success=True, content={
            "mode": "stored" if module_id or game_code else "default",
            "game_code": code, "title": profile.get("title", code),
            "module_ids": profile.get("module_ids", []), "symbol_map": profile["symbol_map"],
            "letter_count": len(profile["symbol_map"]), "source": profile.get("source", {}),
        })

    def _import(self, md: str, params: dict[str, Any], module_id: str, game_code: str,
                ctx: HarnessContext) -> ToolResult:
        result = build_profile(md, str(params.get("file_name") or ""), game_code, "", "")
        profile = result["profile"]
        if result["errors"]:
            return ToolResult(success=False, error="guide_invalid: " + "; ".join(result["errors"][:5]), content=result)
        guide_modules = profile["module_ids"]
        if module_id and guide_modules and module_id not in guide_modules:
            return ToolResult(success=False, error=(
                f"guide_module_mismatch: the attached guide is for {profile['title']} (module "
                f"{', '.join(guide_modules)}), but this run is for module {module_id}"), content=result)
        if module_id and not guide_modules:
            profile["module_ids"] = [module_id]

        existing = symbol_profiles.get(profile["game_code"]) or {}
        is_stored = bool(existing) and not existing.get("source", {}).get("builtin")
        diff = diff_maps(existing.get("symbol_map") or {}, profile["symbol_map"]) if is_stored else             diff_maps({}, profile["symbol_map"])
        old_modules = set(existing.get("module_ids") or []) if is_stored else set()
        profile["module_ids"] = sorted(old_modules | set(profile["module_ids"]))
        unchanged = is_stored and not any(diff.values()) and old_modules == set(profile["module_ids"])
        profile["source"] = {
            "file": params.get("file_name") or "",
            "imported_at": datetime.now().isoformat(timespec="seconds"),
            "sha256": hashlib.sha256(strip_image_data(md).encode("utf-8")).hexdigest()[:16],
            "execution_id": ctx.execution_id,
        }
        saved_path = ""
        if params.get("save") and not unchanged:
            path, _ = symbol_profiles.save(profile)
            saved_path = str(path)

        return ToolResult(success=True, content={
            **result,
            "mode": "imported",
            "game_code": profile["game_code"], "title": profile["title"],
            "module_ids": profile["module_ids"], "symbol_map": profile["symbol_map"],
            "profile": profile,
            "letter_count": len(profile["symbol_map"]),
            "existing": is_stored, "diff": diff, "unchanged": unchanged,
            "saved": bool(saved_path), "saved_path": saved_path,
        }, artifacts=[saved_path] if saved_path else [])
