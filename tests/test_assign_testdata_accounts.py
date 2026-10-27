"""assign_testdata_accounts: every file gets its own automateNN loginName, nothing else changes."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

import pytest

from assign_testdata_accounts import assign_accounts, set_login_name

BODY = '<Slot>\r\n    <Spin stage="BaseGame"><PreGen batch="1" index="2" /></Spin>\r\n  </Slot>\r\n</Test>'


def _testdata(key: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?>\r\n<Test>\r\n  {key}\r\n  {BODY}'


@pytest.mark.parametrize("key", [
    '<Key moduleID="105271" loginName="lijunt" />',
    '<Key moduleID="105271" loginName="" />',
    "<Key loginName='sarala' moduleID=\"105271\"/>",
    '<Key moduleID="105271" />',
    '<Key moduleID="105271">',
])
def test_set_login_name_any_key_shape(key):
    out = set_login_name(_testdata(key), "automate07")
    new_key = re.search(r"<Key\b[^>]*>", out).group(0)
    assert 'loginName="automate07"' in new_key
    assert out.count("loginName=") == 1
    assert new_key.endswith("/>") == key.endswith("/>")
    if key.endswith("/>"):
        assert ET.fromstring(out.split("?>", 1)[1]).find("Key").get("loginName") == "automate07"
    assert 'moduleID="105271"' in out
    assert out.endswith(BODY)            # records and CRLF untouched


def test_set_login_name_requires_key():
    with pytest.raises(ValueError):
        set_login_name("<Test><Slot/></Test>", "automate01")


def test_assign_accounts_orders_like_explorer_and_keeps_originals(tmp_path):
    src = tmp_path / "V96"
    src.mkdir()
    names = ["LLCEA_Basegame_NoWin.testdata", "LL2CEA_BaseGame_BigWins.testdata", "LL2CEA__Betlines.testdata",
             "ll2cea_basegame_a.testdata"]
    for i, n in enumerate(names):
        (src / n).write_bytes(_testdata(f'<Key moduleID="105271" loginName="{"" if i % 2 else "lijunt"}" />')
                              .encode("utf-8"))
    (src / "notes.txt").write_text("ignored")
    originals = {p.name: p.read_bytes() for p in src.iterdir()}

    out = tmp_path / "V96_automate"
    got = assign_accounts(src, out)

    assert [a["file"] for a in got] == ["LL2CEA__Betlines.testdata", "ll2cea_basegame_a.testdata",
                                        "LL2CEA_BaseGame_BigWins.testdata", "LLCEA_Basegame_NoWin.testdata"]
    assert [a["loginName"] for a in got] == ["automate01", "automate02", "automate03", "automate04"]
    for a in got:
        data = (out / a["file"]).read_bytes()
        assert f'loginName="{a["loginName"]}"'.encode() in data
        assert data.replace(f'loginName="{a["loginName"]}"'.encode(), b"") == \
            originals[a["file"]].replace(f'loginName="{a["originalLoginName"]}"'.encode(), b"")
    assert {p.name: p.read_bytes() for p in src.iterdir()} == originals
    assert json.loads((out / "accounts.json").read_text(encoding="utf-8"))["accounts"] == got


def test_assign_accounts_refuses_to_overwrite_source(tmp_path):
    (tmp_path / "a.testdata").write_text(_testdata('<Key moduleID="1" loginName="x" />'))
    with pytest.raises(ValueError):
        assign_accounts(tmp_path, tmp_path)
