"""Give every .testdata file its own test account, so a whole folder can be uploaded and verified at once.

The game server keeps one active .testdata per (loginName, moduleID): uploading several files for the
same account leaves only one of them in play. Rewriting each file's <Key loginName> to its own account
(automate01, automate02, ...) lets every file be uploaded together and verified in parallel.

    python assign_testdata_accounts.py --folder "C:/.../V96" --out "C:/.../V96_automate"

The source folder is never modified. Files are numbered in case-insensitive name order (the order
Windows Explorer lists them in), and every file is rewritten — an empty or existing loginName alike.
<out>/accounts.json records which account each file got.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# set_login_name lives with the verifier tools, which rewrite <Key loginName> the same way before
# uploading to a local game link; imported here so this script's callers are unaffected.
from server.tools.impl.testdata_verify_common import _KEY_TAG, _LOGIN_ATTR, set_login_name

__all__ = ["account_name", "assign_accounts", "set_login_name"]


def account_name(prefix: str, n: int, width: int = 2) -> str:
    return f"{prefix}{n:0{width}d}"


def assign_accounts(folder: Path, out: Path, prefix: str = "automate", start: int = 1, width: int = 2) -> list[dict]:
    files = sorted(folder.glob("*.testdata"), key=lambda p: p.name.lower())
    if not files:
        raise FileNotFoundError(f"no .testdata files in {folder}")
    if out.resolve() == folder.resolve():
        raise ValueError("--out must differ from --folder; the originals are never overwritten")
    out.mkdir(parents=True, exist_ok=True)
    assignments = []
    for n, src in enumerate(files, start=start):
        login = account_name(prefix, n, width)
        raw = src.read_bytes()
        bom = b"\xef\xbb\xbf" if raw.startswith(b"\xef\xbb\xbf") else b""
        text = raw[len(bom):].decode("utf-8")   # bytes in, bytes out: CRLF/LF line endings are kept
        key = _KEY_TAG.search(text)
        old = _LOGIN_ATTR.search(key.group(0)) if key else None
        try:
            new_text = set_login_name(text, login)
        except ValueError as e:
            raise ValueError(f"{src.name}: {e}") from None
        (out / src.name).write_bytes(bom + new_text.encode("utf-8"))
        assignments.append({"file": src.name, "loginName": login,
                            "originalLoginName": old.group(1)[1:-1] if old else None})
    (out / "accounts.json").write_text(
        json.dumps({"source": str(folder), "prefix": prefix, "accounts": assignments}, indent=1, ensure_ascii=False),
        encoding="utf-8")
    return assignments


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--folder", required=True, help="folder with the original .testdata files (left untouched)")
    ap.add_argument("--out", required=True, help="where the rewritten copies and accounts.json go")
    ap.add_argument("--prefix", default="automate")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--width", type=int, default=2, help="zero-padded digits: 2 -> automate01")
    args = ap.parse_args(argv)
    for a in assign_accounts(Path(args.folder), Path(args.out), args.prefix, args.start, args.width):
        print(f"{a['loginName']}  {a['file']}  (was {a['originalLoginName']!r})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
