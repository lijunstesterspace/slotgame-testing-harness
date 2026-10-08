# SKILL: Portugal Plugin Symbol Mapping (Flow Step 0)

## 1. Core Purpose
The **precondition** of Portugal Plugin Verification: determine the letter → SYM mapping used for this run.
The mapping comes from the backend-provided **Portugal Plugin Output Guide** (Google Doc), replacing manual maintenance of `LETTER_TO_SYM` in each
`portugal-playcheck-plugin/ppv*.py`.
The import result is saved as `symbol_profiles/<GAME_CODE>.json`; later runs with the same moduleId reuse it automatically.

## 2. Decision Rules (Step 0, before any browser action)
| Situation | Result |
|---|---|
| Output Guide (.md) attached | Import: parse, validate, self-check, diff against stored version; save when **Save Imported Mapping** is checked |
| Not attached, moduleId has a stored mapping | Use the stored mapping |
| Not attached, moduleId has no mapping | **Stop**: `no_symbol_mapping_for_module:<id>`, prompt to attach that game's .md |
| moduleId of the attached .md ≠ this run's moduleId | **Stop**: `guide_module_mismatch` (document for the wrong game) |
| No moduleId at all (pasted outcome, no .md) | Use the built-in ACCR mapping (original tool behavior), show a notice in the console |

moduleId source: `moduleId=…` in the input box > `moduleId` parameter of the game URL.

## 2.1 Input
- Google Docs → File → Download → **Markdown (.md)**, attach in Harness with `+` (as a separate attachment, not in the input box)
- Optional overrides: `gameCode=ADPC`, `moduleId=105170`

## 3. Parsing Rules

### Rule 1: Locate the Mapping Table
- Take the first table whose header contains both `Definition` and `…letter` (Corresponding letter)
- Headerless continuation tables immediately following it, with the same column count and a single-letter letter column, are appended
- Separator rows (`| :---: |`) are skipped; `[imageN]: <data:…>` image data lines and `![][imageN]` image cells are ignored

### Rule 2: Cell Cleanup
- First split on unescaped `|`, then remove Google's Markdown escapes (`\#` → `#`, `\-1` → `-1`, `1\.` → `1.`)
- Remove `**bold**` / `_italic_` markers

### Rule 3: Mapping Generation
| Definition form | Result | Example |
|---|---|---|
| Integer | `SYM<n>` | `-1` → `SYM-1`, `15` → `SYM15` (GBOW document form) |
| `SYMn` (case-insensitive) | `SYM<n>` | `SYM15` → `SYM15` (ADPC document form) |
| Other name | As is | `GRAND` |
- Letter keys are always stored **uppercase**: the parser uppercases letters on lookup (`ppvADPC1.0.py` used lowercase keys + uppercase lookup, so the mapping never took effect; this rule prevents that class of bug)

### Rule 4: Metadata
- Game name and moduleId: body text `…guide for <Game> <moduleId>` (e.g. `guide for Apex Dragon Power Combo™ 105170`)
- If not found, game name is the part of the file name before ` - `
- Game code: initial letter of each word in the game name, digits kept (Apex Dragon Power Combo → `ADPC`, Mega Eagle 2 Ultra → `ME2U`)

## 4. Validation
| Type | Condition |
|---|---|
| Error (not saved) | Mapping table not found; letter column is not a single letter; same letter has two different definitions; game code cannot be determined |
| Warning | Same SYM assigned to multiple letters; gaps in the letter range; no moduleId in the document |
| Self-check | Parse the document's example string (`0:a;p;k;…#MV#…`) with the new mapping; report letters used by the example but missing from the table |

## 5. Saving
- Diff against stored version: added / changed / removed letters
- If identical, do not write; otherwise write `symbol_profiles/<GAME>.json`, old versions kept in `history` (max 20)
- moduleIds are merged with the stored ones, never lost
- Unchecking **Save Imported Mapping** in the test plan = use for this run only, do not save

## 6. portugal_plugin_symbol_map Interface Contract

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `markdown` | string | No | Attached .md content; empty = use stored mapping |
| `file_name` | string | No | Original file name (records source / fallback game name) |
| `module_id` | string | No | This run's moduleId (validate document, look up stored mapping) |
| `game_code` | string | No | Override game code / select stored mapping |
| `save` | boolean | No | Save imported mapping, default true |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "mode": "imported",
    "game_code": "ADPC", "title": "Apex Dragon Power Combo", "module_ids": ["105170"],
    "symbol_map": {"A": "SYM1", "M": "SYM15", "Y": "SYM99"},
    "profile": {"game_code": "ADPC", "title": "Apex Dragon Power Combo", "module_ids": ["105170"],
                "symbol_map": {"A": "SYM1", "M": "SYM15", "Y": "SYM99"}, "source": {"file": "…md", "imported_at": "…", "sha256": "…"}},
    "rows": 25, "letter_count": 25, "errors": [], "warnings": [],
    "examples": [{"example": "0:i;l;h;h;g#…", "spins": 1, "total_win": 70.0, "unmapped_letters": []}],
    "existing": false, "unchanged": false,
    "diff": {"added": {"a": "SYM1"}, "removed": {}, "changed": {}},
    "saved": true, "saved_path": "…/symbol_profiles/ADPC.json"
  }
}
```

When using a stored mapping (`mode` = `stored` / `default`), only returns
`mode`, `game_code`, `title`, `module_ids`, `symbol_map`, `letter_count`, `source`.
The next step `portugal_plugin_parser` uses the `game_code` + `symbol_map` returned here directly.
