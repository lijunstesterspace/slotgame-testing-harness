"""Symbol profile store — one JSON file per game in symbol_profiles/ (letter → SYM mapping).

Replaces the per-game LETTER_TO_SYM tables that used to be hand-edited inside each
portugal-playcheck-plugin/ppv*.py script. Files live next to the exe when frozen (like skills/),
at the project root in development, so QA can version and review them without a rebuild.

File shape (symbol_profiles/<GAME_CODE>.json):
    {
      "game_code": "ADPC", "title": "Apex Dragon Power Combo", "module_ids": ["105170"],
      "symbol_map": {"A": "SYM1", ...},          # keys always upper-case (lookup upper-cases)
      "source": {"file": "...md", "imported_at": "...", "sha256": "..."},
      "history": [{"imported_at": "...", "symbol_map": {...}, "source": {...}}]   # previous versions
    }
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
from typing import Any

HISTORY_LIMIT = 20

# Built-in fallback so the scenario works with an empty store (ported from ppvACCR1.0.py).
BUILTIN_PROFILES: dict[str, dict[str, Any]] = {
    "ACCR": {
        "game_code": "ACCR",
        "title": "Amazing Catch Cold Rush",
        "module_ids": [],
        "symbol_map": {
            'A': 'SYM1', 'B': 'SYM2', 'C': 'SYM3', 'D': 'SYM4',
            'E': 'SYM5', 'F': 'SYM6', 'G': 'SYM7', 'H': 'SYM8',
            'I': 'SYM9', 'J': 'SYM10', 'K': 'SYM11', 'L': 'SYM12',
            'M': 'SYM20', 'N': 'SYM21', 'O': 'SYM22', 'P': 'SYM23',
            'Q': 'SYM30',
        },
        "source": {"file": "portugal-playcheck-plugin/ppvACCR1.0.py", "builtin": True},
    },
    # Fallback for a fetched game with no profile yet: keep the raw letters instead of applying
    # another game's table (which would silently produce wrong SYM names).
    "RAW": {"game_code": "RAW", "title": "Unmapped (raw letters)", "module_ids": [], "symbol_map": {},
            "source": {"builtin": True}},
}


def profiles_dir() -> Path:
    if getattr(sys, "frozen", False):
        d = Path(sys.executable).parent / "symbol_profiles"
    else:
        d = Path(__file__).resolve().parents[3] / "symbol_profiles"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _bundled_dir() -> Path | None:
    """Read-only copies packed into the exe (slot_harness.spec) — seeds for a fresh install."""
    base = getattr(sys, "_MEIPASS", None)
    d = Path(base) / "symbol_profiles" if base else None
    return d if d and d.is_dir() else None


def load_all() -> dict[str, dict[str, Any]]:
    """Built-ins, then profiles bundled in the exe, then the writable symbol_profiles/ folder —
    later sources win for the same game code."""
    out = {k: dict(v) for k, v in BUILTIN_PROFILES.items()}
    files = sorted(_bundled_dir().glob("*.json")) if _bundled_dir() else []
    files += sorted(profiles_dir().glob("*.json"))
    for f in files:
        try:
            prof = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        code = str(prof.get("game_code") or f.stem).upper()
        prof["symbol_map"] = {str(k).upper(): str(v) for k, v in (prof.get("symbol_map") or {}).items()}
        prof["module_ids"] = [str(m) for m in prof.get("module_ids") or []]
        out[code] = prof
    return out


def get(game_code: str) -> dict[str, Any] | None:
    return load_all().get(game_code.upper())


def profile_for(game_code: str | None, module_id: str | None) -> str:
    """Explicit game_code wins; else the profile listing module_id; else RAW (fetched, unknown
    game) or ACCR (pasted text with no module — the original tool's behaviour)."""
    if game_code:
        return game_code.upper()
    if module_id:
        for code, prof in load_all().items():
            if str(module_id) in prof.get("module_ids", []):
                return code
        return "RAW"
    return "ACCR"


def save(profile: dict[str, Any]) -> tuple[Path, dict[str, Any] | None]:
    """Write a profile, pushing the previous stored version into its history.
    Returns (path, previous_profile_or_None)."""
    code = profile["game_code"].upper()
    path = profiles_dir() / f"{code}.json"
    previous = None
    history: list[dict] = []
    if path.exists():
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            previous = None
    if previous:
        history = list(previous.get("history") or [])
        history.insert(0, {k: previous.get(k) for k in ("symbol_map", "module_ids", "title", "source")})
        history = history[:HISTORY_LIMIT]
    data = {**profile, "game_code": code, "history": history}
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path, previous
