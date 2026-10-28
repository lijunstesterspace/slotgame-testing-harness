""".testdata parsing, injection and echo judging across the layouts different games use.

tests/fixtures/testdata_variants holds real files from several games (collected 2026-10-28): with and
without <Slot>, with Meter/Token/Random controls, a nested <Feature><PreGen>, and a feature round
written as its own <Spin stage="FreeSpin">.
"""
from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from server.game_session import PlayResponse, PlayResult, protocol
from server.game_session.capture import Captured
from server.tools.impl import testdata_verifier_harness_tool as harness
# Aliased: pytest would try to collect the Test*/test* names as tests.
from server.tools.impl.testdata_verify_common import (
    TestdataFormatError as FormatError, _extract_testdata_key, _parse_testdata, compare_feature,
    compare_spin, testdata_bytes_with_login as with_login,
)

VARIANTS = Path(__file__).parent / "fixtures" / "testdata_variants"

# file -> (moduleID, [(stage, [(path, batch, index), ...]) per <Spin>])
EXPECTED = {
    "Apex Dragon Power Combo_Base Game_Max Exposure.testdata":
        ("105169", [("BaseGame", [("Spin", 75, 43)])]),
    "Apex Dragon Power Combo_Link&Win Feature trigger_Expand, Surge, Claim.testdata":
        ("105169", [("BaseGame", [("Spin", 1465, 1)])]),
    "Mega Eagle 2 Ultra Link&Win_Big wins.testdata":
        ("104938", [("BaseGame", [("Spin", 5, 0)]), ("BaseGame", [("Spin", 6, 0)]),
                    ("BaseGame", [("Spin", 26, 210)]), ("BaseGame", [("Spin", 26, 1245)])]),
    "Mega Eagle 2 Ultra Link&Win_Ultra Link&Win Feature trigger_Grower, Adder, Booster, Doubler, Flash Win.testdata":
        ("104938", [("BaseGame", [("Spin", 620, 0), ("Spin/Feature", 3809, 38)])]),
    "TGPF_BaseGame_BigWins.testdata":
        ("104811", [("BaseGame", [("Spin", 1189, 13)]), ("BaseGame", [("Spin", 1875, 17)]),
                    ("BaseGame", [("Spin", 296, 0)]), ("BaseGame", [("Spin", 60, 0)])]),
    "TGPF_WildBonusSpins_x2wildInFrame.testdata":
        ("104811", [("BaseGame", [("Spin", 706, 0)]), ("FreeSpin", [("Spin", 11, 10)])]),
    "WG3_BaseGame_BigWins.testdata":
        ("104115", [("BaseGame", [("Spin", 197, 129)]), ("BaseGame", [("Spin", 89, 1204)]),
                    ("BaseGame", [("Spin", 89, 1714)]), ("BaseGame", [("Spin", 90, 45)])]),
    "WG3_Bonus Spins_CashBonus_MinWin.testdata":
        ("104115", [("BaseGame", [("Spin", 2659, 44)]), ("FreeSpin", [("Spin", 0, 0)])]),
}


def test_every_variant_fixture_is_covered():
    assert sorted(p.name for p in VARIANTS.glob("*.testdata")) == sorted(EXPECTED)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_variant_parses_to_its_seeds(name):
    module_id, spins = EXPECTED[name]
    records = _parse_testdata(VARIANTS / name)
    assert _extract_testdata_key(VARIANTS / name) == {"moduleID": module_id, "loginName": ""}
    assert [(r["stage"], [(p["path"], p["batch"], p["index"]) for p in r["pregens"]]) for r in records] == spins
    for r, (_, seeds) in zip(records, spins):
        assert (r["batch"], r["index"]) == seeds[0][1:]
        assert r["isBonus"] == (len(seeds) > 1)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_variant_injects_only_the_login(name, tmp_path):
    original = (VARIANTS / name).read_bytes()
    injected = with_login(VARIANTS / name, "automate1")
    assert injected == original.replace(b'loginName=""', b'loginName="automate1"', 1)
    copy = tmp_path / name
    copy.write_bytes(injected)
    assert _extract_testdata_key(copy)["loginName"] == "automate1"
    assert _parse_testdata(copy) == _parse_testdata(VARIANTS / name)


def _write(tmp_path, text: str, raw_prefix: bytes = b"") -> Path:
    p = tmp_path / "x.testdata"
    p.write_bytes(raw_prefix + text.encode("utf-8"))
    return p


def test_tolerates_bom_leading_blank_lines_case_and_namespace(tmp_path):
    p = _write(tmp_path, '\r\n  <?xml version="1.0" encoding="UTF-8"?>\r\n<test xmlns="urn:x">'
                         '<key ModuleID="7" LoginName="" /><slot><spin Stage="BaseGame">'
                         '<pregen Batch=" 3 " INDEX="4"/><feature><PREGEN batch="5" index="6"/></feature>'
                         '</spin></slot></test>', raw_prefix=b"\xef\xbb\xbf")
    [rec] = _parse_testdata(p)
    assert rec["stage"] == "BaseGame"
    assert [(q["path"], q["batch"], q["index"]) for q in rec["pregens"]] == [("Spin", 3, 4), ("Spin/feature", 5, 6)]
    assert _extract_testdata_key(p) == {"moduleID": "7", "loginName": ""}
    assert b'LoginName="bob"' in with_login(p, "bob") or \
        b'loginName="bob"' in with_login(p, "bob")


@pytest.mark.parametrize("body,message", [
    ('<Key moduleID="1"/>', "no <Spin> record"),
    ('<Spin stage="BaseGame"><Display name="B_G"/><B_G seed="35,4|4,4"/></Spin>', "reel-seed record"),
    ('<Spin stage="BaseGame"><Feature><PreGen batch="1" index="2"/></Feature></Spin>', "Spin #1"),
    ('<Spin><PreGen batch="1" index="2"/></Spin><Spin><PreGen batch="x1" index="2"/></Spin>', "Spin #2"),
    ('<Spin><PreGen batch="1"/></Spin>', "no index attribute"),
    ('<Spin><PreGen batch="1" index="2"></Spin>', "not well-formed"),
])
def test_unusable_files_say_why(tmp_path, body, message):
    p = _write(tmp_path, f'<Test><Key moduleID="1" loginName=""/>{body}</Test>')
    with pytest.raises(FormatError, match=message.replace("|", r"\|")):
        _parse_testdata(p)


# ── judging against the <TestData> echo ───────────────────────────────────────────────────────

def _spin_response(echo: str, stage: str = "BaseGame", verb: str = "Spin") -> PlayResponse:
    test_data = f"<TestData>{echo}</TestData>" if echo else ""
    return protocol.parse(f'<Pkt><Id verb="{verb}"/><Response><Player balance="1" transNumber="9"/>'
                          f'<Slot stage="{stage}" nextStage="BaseGame"/><Financial win="5" wager="1"/>'
                          f"{test_data}</Response></Pkt>")


FEATURE_FILE = VARIANTS / "Mega Eagle 2 Ultra Link&Win_Ultra Link&Win Feature trigger_Grower, Adder, Booster, Doubler, Flash Win.testdata"


def test_spin_with_nested_feature_passes_when_echo_matches():
    [rec] = _parse_testdata(FEATURE_FILE)
    echo = ('<Spin stage="BaseGame"><Meter state="0" token="0" /><PreGen batch="620" index="0" />'
            '<Feature><PreGen batch="3809" index="38"></PreGen></Feature></Spin>')
    result = compare_spin(rec, _spin_response(echo), "f")
    assert result["verdict"] == "PASSED" and result["passed"]
    assert (result["actualBatch"], result["actualIndex"]) == (620, 0)


def test_spin_with_wrong_feature_seed_is_a_seed_mismatch():
    [rec] = _parse_testdata(FEATURE_FILE)
    echo = '<Spin stage="BaseGame"><PreGen batch="620" index="0" /><Feature><PreGen batch="1" index="2"/></Feature></Spin>'
    result = compare_spin(rec, _spin_response(echo), "f")
    assert result["verdict"] == "SEED_MISMATCH"
    assert result["issues"] == ["feature seed mismatch: expected=['spin/feature:(3809, 38)'], "
                                "actual=['spin/feature:(1, 2)']"]


def test_spin_without_echo_says_no_testdata_was_played():
    [rec] = _parse_testdata(FEATURE_FILE)
    result = compare_spin(rec, _spin_response(""), "f")
    assert result["verdict"] == "SEED_MISMATCH" and "no <TestData> echo" in result["issues"][0]


def test_json_echo_paths_match_case_insensitively():
    [rec] = _parse_testdata(FEATURE_FILE)
    play = PlayResponse(verb="Spin", pregen=(620, 0), testdata_stage="BaseGame",
                        testdata_pregens=[("Spin", 620, 0), ("Spin/Feature", 3809, 38)])
    assert compare_spin(rec, play, "f")["verdict"] == "PASSED"


def test_stage_mismatch_with_right_seeds():
    rec = _parse_testdata(VARIANTS / "TGPF_BaseGame_BigWins.testdata")[0]
    result = compare_spin(rec, _spin_response('<Spin stage="FreeSpin"><PreGen batch="1189" index="13"/></Spin>'), "f")
    assert result["verdict"] == "STAGE_MISMATCH" and not result["passed"]


SIBLING_FILE = VARIANTS / "TGPF_WildBonusSpins_x2wildInFrame.testdata"


def test_sibling_feature_record_passes_when_a_response_echoes_it():
    _, free = _parse_testdata(SIBLING_FILE)
    plays = [_spin_response('<Spin stage="BaseGame"><PreGen batch="706" index="0"/></Spin>'),
             _spin_response('<Spin stage="FreeSpin"><PreGen batch="11" index="10"/></Spin>', "FreeSpin", "Freespin")]
    assert compare_feature(free, plays, "f")["verdict"] == "PASSED"


def test_sibling_feature_record_not_echoed_is_reported_as_such():
    _, free = _parse_testdata(SIBLING_FILE)
    plays = [_spin_response('<Spin stage="BaseGame"><PreGen batch="706" index="0"/></Spin>'),
             _spin_response("", "FreeSpin", "Freespin")]
    result = compare_feature(free, plays, "f")
    assert result["verdict"] == "SEED_NOT_ECHOED" and not result["passed"]
    assert "stage was played" in result["issues"][0]


# ── a whole file through the harness play loop ───────────────────────────────────────────────

def _captured(play: PlayResponse) -> Captured:
    return Captured(seq=0, t=time.time(), url="u", status=200, request_body=None, body="", play=play)


def test_feature_record_is_not_spun_and_is_judged_against_the_triggering_play(tmp_path):
    base, free = _parse_testdata(SIBLING_FILE)
    spins: list[str] = []

    def play(label="play", shots_dir=None):
        spins.append(label)
        responses = [_spin_response('<Spin stage="BaseGame"><PreGen batch="706" index="0"/></Spin>'),
                     _spin_response('<Spin stage="FreeSpin"><PreGen batch="11" index="10"/></Spin>',
                                    "FreeSpin", "Freespin")]
        return PlayResult(responses=[_captured(r) for r in responses], states=[], started_at=0,
                          ended_at=0, touches=0)

    import threading
    run = harness._Run(cancel_event=threading.Event(), screenshots_dir=tmp_path, on_bonus=False,
                       on_fail=False, log_prefix="t")
    run.play(SimpleNamespace(play=play, screenshot=lambda path: None),
             [(SIBLING_FILE.name, base), (SIBLING_FILE.name, free)])
    assert spins == [f"{SIBLING_FILE.name}:spin1"]
    assert [r["verdict"] for r in run.results] == ["PASSED", "PASSED"]


# ── testdata_verifier_api: no browser, every request faked ─────────────────────────────────────

def test_api_verifier_spins_once_for_base_plus_freespin_file(monkeypatch, tmp_path):
    import asyncio
    import json

    import httpx

    from server.tools.base import HarnessContext
    from server.tools.impl import testdata_verifier_api_tool as api

    td = tmp_path / "wild.testdata"
    td.write_bytes(SIBLING_FILE.read_bytes().replace(b'loginName=""', b'loginName="qa1"'))
    plays: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts/real"):
            return httpx.Response(200, json={"tokens": {"userToken": "u", "refreshTokens": ["r"]}})
        if request.url.path.endswith("/Upload/TestDataFile"):
            return httpx.Response(200, text="ok")
        plays.append(request.url.path)
        payload = ('<Pkt><Id verb="Spin"/><Response><Player balance="1" transNumber="1"/>'
                   '<Slot stage="BaseGame" nextStage="FreeSpin"/><Financial win="0" wager="1"/>'
                   '<TestData><Spin stage="BaseGame"><PreGen batch="706" index="0"/></Spin></TestData>'
                   '</Response></Pkt>')
        return httpx.Response(200, json={"packet": {"payload": payload}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(api.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    ctx = HarnessContext(execution_id="e", user_id="u", user_role="r", session_token="t", work_dir=str(tmp_path))
    result = asyncio.run(api.TestdataVerifierApiTool()._run_impl({
        "testdata_file": str(td), "okta_access_token": "o", "axiom_api_key": "k", "spin_delay_sec": 0,
        "target_url": "https://mobile-app1-gtp603.installprogram.eu/x?username=qa1&moduleId=104811&clientId=1&productId=2",
    }, ctx))

    assert len(plays) == 1  # the FreeSpin record is not spun for
    verdicts = [c["verdict"] for c in result.content["cases"]]
    assert verdicts == ["PASSED", "SEED_NOT_ECHOED"]
    json.dumps(result.content)  # the cases stay serialisable
