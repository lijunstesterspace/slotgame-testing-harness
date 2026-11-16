"""testdata_parser / testdata_generator: generated files stay well-formed XML and valid file names
whatever the sheet's case names contain ("Ultra Link&Win trigger", "Free Spins 10/15", 'Big "Win"').

Every generated file is read back with the verifiers' own parser (_parse_testdata), since that is
what will consume it.
"""
from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from server.tools.base import HarnessContext
from server.tools.impl.testdata_generator_tool import (
    TestdataGeneratorTool, _write_xml, safe_testdata_filename,
)
from server.tools.impl.testdata_parser_tool import TestdataParserTool
from server.tools.impl.testdata_verify_common import _parse_testdata


def _ctx(tmp_path: Path) -> HarnessContext:
    return HarnessContext(execution_id="exe_test", user_id="local", user_role="admin",
                          session_token="local", work_dir=str(tmp_path))


def _generate(raw_text: str, tmp_path: Path) -> list[Path]:
    parsed = asyncio.run(TestdataParserTool().execute({"raw_text": raw_text, "game_prefix": "ME2"}, _ctx(tmp_path)))
    assert parsed.success, parsed.error
    generated = asyncio.run(TestdataGeneratorTool().execute({"records": parsed.content["records"]}, _ctx(tmp_path)))
    assert generated.success, generated.error
    return [Path(f) for f in generated.content["files"]]


@pytest.mark.parametrize("case_name", [
    "Ultra Link&Win trigger",
    'Big "Win" <x>',
    "it's a 'quoted' case",
    "Dash--dash case",
])
def test_single_seed_case_names_are_escaped(tmp_path, case_name):
    (path,) = _generate(f"{case_name}\t58,3", tmp_path)
    (record,) = _parse_testdata(path)
    assert (record["batch"], record["index"], record["comment"]) == (58, 3, case_name)


def test_double_pregen_case_with_ampersand_is_well_formed(tmp_path):
    (path,) = _generate("Link&Win Feature trigger\t58,3\t2,67933", tmp_path)
    (record,) = _parse_testdata(path)
    assert [(p["path"], p["batch"], p["index"]) for p in record["pregens"]] == [
        ("Spin", 58, 3), ("Spin/Feature", 2, 67933)]


def test_parser_snippet_is_well_formed_xml(tmp_path):
    parsed = asyncio.run(TestdataParserTool().execute({"raw_text": 'Link&Win "A"\t1,2'}, _ctx(tmp_path)))
    (record,) = parsed.content["records"]
    assert ET.fromstring(record["xml_snippet"]).get("comment") == 'Link&Win "A"'


def test_key_attributes_are_escaped(tmp_path):
    out = _write_xml([{"case_name": "c", "base_batch": 1, "base_index": 2}],
                     str(tmp_path / "k.testdata"), 'mod"1', "a&b")
    key = ET.fromstring(Path(out).read_text(encoding="utf-8")).find("Key")
    assert (key.get("moduleID"), key.get("loginName")) == ('mod"1', "a&b")


def test_case_name_cannot_create_a_subfolder_or_leave_the_work_dir(tmp_path):
    files = _generate("Free Spins 10/15\t21,4683\n..\\..\\escape\t3,4", tmp_path)
    assert sorted(f.name for f in files) == ["ME2_.._.._escape.testdata", "ME2_Free Spins 10_15.testdata"]
    assert all(f.parent == tmp_path.resolve() for f in files)


@pytest.mark.parametrize("name, expected", [
    ("P5P_Base game_Big Wins.testdata", "P5P_Base game_Big Wins.testdata"),   # ordinary names untouched
    ('a<b>c:d"e/f\\g|h?i*j.testdata', "a_b_c_d_e_f_g_h_i_j.testdata"),
    ("", "generated.testdata"),
])
def test_safe_testdata_filename(name, expected):
    assert safe_testdata_filename(name) == expected


def test_names_differing_only_in_an_unsafe_character_share_one_file(tmp_path):
    records = [
        {"case_name": "a", "base_batch": 1, "base_index": 1, "file_name": "x/y.testdata"},
        {"case_name": "b", "base_batch": 2, "base_index": 2, "file_name": "x_y.testdata"},
    ]
    generated = asyncio.run(TestdataGeneratorTool().execute({"records": records}, _ctx(tmp_path)))
    (path,) = generated.content["files"]
    assert [(r["batch"], r["index"]) for r in _parse_testdata(Path(path))] == [(1, 1), (2, 2)]
