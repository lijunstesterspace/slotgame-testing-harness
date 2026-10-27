"""Protocol + env parsing. Payloads are trimmed from live Mega Eagle 2 (gtp603) responses, 2026-10-21."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from server.game_session import protocol
from server.game_session.env import env_from_host, is_local_url, require_env_before_launch, resolve_env

SPIN = {
    "id": {"verb": "Spin"}, "version": 5,
    "gameResponse": {
        "player": {"balance": 10018700, "transNumber": 39},
        "slot": {"stages": [{"name": "BaseGame"}, {"name": "LinkAndWin"}],
                 "stage": "BaseGame", "index": 0, "nextStage": "LinkAndWin", "nextIndex": 1},
        "testData": {"spin": {"preGen": {"batch": 312, "index": 0}, "stage": "BaseGame", "comment": "TestMode"}},
        "financials": {"wager": 100, "win": 400, "totalWager": 100, "totalWin": 400},
    },
}
BONUS_STEP = {
    "id": {"verb": "Bonus"}, "version": 5,
    "gameResponse": {
        "player": {"balance": 10018700, "transNumber": 39},
        "slot": {"stages": [{"name": "BaseGame", "logic": {"pregen": {"checksum": "vL4AAAAAAAA="}}},
                            {"name": "LinkAndWin", "logic": {"pregen": {"checksum": "+SYbAAAAAAA="}}}],
                 "stage": "LinkAndWin", "index": 1, "nextStage": "LinkAndWin", "nextIndex": 1},
        "financials": {"wager": 0, "win": 0, "totalWager": 100, "totalWin": 400},
    },
}
BONUS_LAST = json.loads(json.dumps(BONUS_STEP))
BONUS_LAST["gameResponse"]["slot"]["nextStage"] = "BaseGame"
BONUS_LAST["gameResponse"]["financials"] = {"wager": 0, "win": 3900, "totalWager": 100, "totalWin": 4300}
BONUS_LAST["gameResponse"]["player"]["balance"] = 10022600


def test_spin_carries_pregen_and_feature_trigger():
    r = protocol.parse(json.dumps(SPIN))
    assert r.verb == "Spin"
    assert r.pregen == (312, 0)
    assert r.testdata_stage == "BaseGame" and r.testdata_comment == "TestMode"
    assert r.stage == "BaseGame" and r.next_stage == "LinkAndWin"
    assert not r.ends_play
    assert (r.win, r.wager, r.total_win, r.trans_number) == (400, 100, 400, 39)


def test_feature_step_has_no_pregen_even_with_checksum():
    r = protocol.parse(json.dumps(BONUS_STEP).encode())
    assert r.verb == "Bonus" and r.stage == "LinkAndWin"
    assert r.pregen is None
    assert not r.ends_play


def test_last_feature_step_ends_play():
    r = protocol.parse(json.dumps(BONUS_LAST))
    assert r.ends_play
    assert r.total_win == 4300 and r.balance == 10022600


def test_error_verb():
    r = protocol.parse(json.dumps({"id": {"verb": "Error"}, "gameResponse": {"error": "TEST_DATA_ERROR 527"}}))
    assert r.is_error and "527" in r.error


def test_xml_format():
    xml = ('<Pkt><Id verb="Spin"/><Response><Player balance="900" transNumber="7"/>'
           '<Slot stage="BaseGame" nextStage="FreeSpin"/><Financial win="50" wager="100"/>'
           '<TestData><Spin><PreGen batch="58" index="3"/></Spin></TestData></Response></Pkt>')
    r = protocol.parse(xml)
    assert r.verb == "Spin" and r.pregen == (58, 3) and r.next_stage == "FreeSpin" and r.win == 50


FIXTURES = Path(__file__).parent / "fixtures" / "mega_eagle2"


@pytest.mark.parametrize("name,expect", [
    ("spin_basegame_win.json", {"verb": "Spin", "stage": "BaseGame", "nextStage": "BaseGame",
                                "win": 80.0, "wager": 100.0, "transNumber": 42}),
    ("spin_basegame_nowin.json", {"verb": "Spin", "win": 0.0, "totalWin": 0.0, "transNumber": 43}),
    ("refresh_bonus_end.json", {"verb": "Refresh", "stage": "LinkAndWin", "nextStage": "BaseGame",
                                "totalWin": 3400.0, "transNumber": 41}),
])
def test_wire_envelope_fixtures(name, expect):
    """Real /casino/play bodies: JSON envelope around an XML <Pkt>; <Logic><Pregen checksum> is not a seed."""
    r = protocol.parse((FIXTURES / name).read_text(encoding="utf-8"))
    s = r.summary()
    for k, v in expect.items():
        assert s[k] == v, (k, s[k], v)
    assert r.pregen is None
    assert isinstance(r.raw, dict) and "packet" in r.raw


def test_live_feature_play_fixtures():
    """test.testdata uploaded to gtp603: Spin(140,16)+<Feature><PreGen 8,2587> then Spin(5,0)."""
    spin = protocol.parse((FIXTURES / "spin_testdata_triggers_linkandwin.json").read_text(encoding="utf-8"))
    assert spin.verb == "Spin" and spin.pregen == (140, 16) and spin.next_stage == "LinkAndWin"
    assert spin.testdata_pregens == [("Spin", 140, 16), ("Spin/Feature", 8, 2587)]
    assert spin.testdata_stage == "BaseGame" and "<Meter" in spin.testdata_xml

    step = protocol.parse((FIXTURES / "bonus_step_linkandwin.json").read_text(encoding="utf-8"))
    assert step.verb == "Bonus" and step.pregen is None and step.testdata_pregens == [] and not step.ends_play
    last = protocol.parse((FIXTURES / "bonus_last_linkandwin.json").read_text(encoding="utf-8"))
    assert last.ends_play and last.trans_number == spin.trans_number
    assert last.total_win == 2370.0 and last.balance - spin.balance == last.total_win - spin.total_win

    bigwin = protocol.parse((FIXTURES / "spin_testdata_bigwin.json").read_text(encoding="utf-8"))
    assert bigwin.pregen == (5, 0) and bigwin.testdata_pregens == [("Spin", 5, 0)] and bigwin.ends_play


def test_json_v5_nested_feature_pregen():
    data = json.loads(json.dumps(SPIN))
    data["gameResponse"]["testData"]["spin"]["feature"] = {"preGen": {"batch": 8, "index": 2587}}
    r = protocol.parse(json.dumps(data))
    assert r.pregen == (312, 0)
    assert r.testdata_pregens == [("Spin", 312, 0), ("Spin/Feature", 8, 2587)]


def test_wire_envelope_with_testdata():
    payload = ('<Pkt version="5"><Id verb="Spin" /><Response><Player balance="1" transNumber="9" />'
               '<Financial wager="100" win="0" totalWager="100" totalWin="0" />'
               '<Slot stage="BaseGame" index="0" nextStage="FreeSpin" nextIndex="1"><Stage name="BaseGame">'
               '<Logic><BaseGame><Pregen checksum="vL4AAAAAAAA=" /></BaseGame></Logic></Stage></Slot>'
               '<TestData><Spin stage="BaseGame" comment="TestMode"><PreGen batch="2663" index="163" /></Spin></TestData>'
               '</Response></Pkt>')
    r = protocol.parse(json.dumps({"context": {}, "packet": {"payload": payload, "isBase64Encoded": False}}))
    assert r.pregen == (2663, 163) and r.testdata_stage == "BaseGame" and r.testdata_comment == "TestMode"
    assert r.next_stage == "FreeSpin"


def test_unknown_format():
    with pytest.raises(ValueError):
        protocol.parse("not a response")


@pytest.mark.parametrize("host,env", [
    ("api5-rhel1-gtp603.installprogram.eu", "gtp603"),
    ("mobile-app1-gtp537.installprogram.eu", "gtp537"),
    ("axiomcore-app1-GTP600.installprogram.eu", "gtp600"),
    ("localhost", None),
    ("gamescloud.gameassists.co.uk", None),
    ("", None),
])
def test_env_from_host(host, env):
    assert env_from_host(host) == env


def test_resolve_env_order():
    local = "http://localhost:5241/launch/mgs/megaEagle2UltraLinkWin?moduleId=104938"
    remote = "https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/harness/x"
    assert resolve_env("GTP700", remote) == "gtp700"
    assert resolve_env(None, remote) == "gtp537"
    assert resolve_env(None, local) is None
    assert resolve_env(None, local, ["gamescloud.gameassists.co.uk", "api5-rhel1-gtp603.installprogram.eu"]) == "gtp603"
    assert is_local_url(local) and not is_local_url(remote)
    with pytest.raises(ValueError, match="env_required"):
        require_env_before_launch(None, local)
