"""playcheck_verifier: reel/financial comparison semantics, the XML reel grid, PlayCheck origin
derivation, the js-body wrapper, and the verdict → tool-success contract.

The browser and PlayCheck are faked: `open_session` yields a fake game session and
`PlayCheckClient` returns a canned GameDetail page, so the whole `_run_sync` pipeline
(launch → spin → compare → report) runs without a real Chrome.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from server.game_session import PlayResponse, PlayResult, protocol
from server.game_session.capture import Captured
from server.game_session.protocol import SlotSpin, StageResult
from server.tools.base import HarnessContext
from server.tools.impl import playcheck, playcheck_verifier_tool as pv

_GAME_URL = ("https://mobile-app1-gtp601.installprogram.eu/htmlGames/4.60.1/launch/mgs/x"
             "?moduleId=105359&username=lijunt&password=test1234%24")
_HARNESS_URL = "https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.60.0/harness/x"
_SYMBOL_MAP = {"ic://A": "1", "ic://B": "2"}


# ── XML <Stage>/<Spin> parsing (the format real /casino/play bodies use) ──────────────────

def test_xml_stages_are_parsed_into_reel_grids():
    payload = (
        '<Pkt version="5"><Id verb="Spin"/><Response><Player balance="900" transNumber="7"/>'
        '<Financial win="80" wager="100" totalWin="80" totalWager="100"/>'
        '<Slot stage="BaseGame" nextStage="BaseGame">'
        '<Stage name="BaseGame" wager="100" win="80" totalWager="100" totalWin="80">'
        '<Spins><Spin width="5" height="3" seed="11,3|47,3" stickies="0,2" '
        'symbols="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"/></Spins></Stage>'
        '<Stage name="LinkAndWin" wager="0" win="0" totalWager="0" totalWin="0"/>'
        '</Slot></Response></Pkt>'
    )
    r = protocol.parse(json.dumps({"packet": {"payload": payload, "isBase64Encoded": False}}))

    assert [s.name for s in r.stages] == ["BaseGame", "LinkAndWin"]
    base = r.stages[0]
    assert base.financials == {"wager": 100.0, "win": 80.0, "totalWager": 100.0, "totalWin": 80.0}
    spin = base.spins[0]
    assert (spin.width, spin.height, spin.seed, spin.stickies) == (5, 3, "11,3|47,3", [0, 2])
    assert spin.grid() == [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]
    assert r.stages[1].spins == []


# ── _compare_reels (H1: unmapped icons; H2: dimensions) ──────────────────────────────────

def _game(grid: list[list[int]], stage: str = "BaseGame") -> list[dict]:
    return [{"stage": stage, "grid": grid}]


def _pc(reel_images: list[list[str]]) -> list[dict]:
    return [{"reel_images": reel_images}]


def test_every_cell_mapped_and_equal_is_a_pass():
    findings = pv._compare_reels(_game([[1, 2], [1, 2]]), _pc([["ic://A", "ic://B"], ["ic://A", "ic://B"]]),
                                 _SYMBOL_MAP)
    assert findings == [{"check": "reels_spin_0", "ok": True, "mismatches": 0, "stage": "BaseGame"}]
    assert pv._verdict(findings) == "PASS"


def test_unmapped_icon_is_inconclusive_and_never_a_pass():
    findings = pv._compare_reels(_game([[1, 2]]), _pc([["ic://A", "ic://Z"]]), _SYMBOL_MAP)
    assert findings[0]["ok"] is None
    assert findings[0]["reason"] == "unmapped_icons" and findings[0]["unmapped"] == 1
    assert pv._verdict(findings) == "REVIEW"


def test_a_wrong_mapped_icon_is_a_fail():
    findings = pv._compare_reels(_game([[1, 2]]), _pc([["ic://B", "ic://B"]]), _SYMBOL_MAP)
    assert findings[0]["ok"] is False and findings[0]["mismatches"] == 1
    assert pv._verdict(findings) == "FAIL"


def test_dimensions_that_differ_are_a_fail_not_a_silent_partial_compare():
    findings = pv._compare_reels(_game([[1, 2], [1, 2]]), _pc([["ic://A", "ic://B"]]), _SYMBOL_MAP)
    assert findings[0]["ok"] is False and findings[0]["reason"] == "dimension_mismatch"
    assert findings[0]["expected"] == "2x2" and findings[0]["actual"] == "1x2"


def test_a_ragged_playcheck_row_is_a_dimension_mismatch():
    findings = pv._compare_reels(_game([[1, 2], [1, 2]]), _pc([["ic://A", "ic://B"], ["ic://A"]]),
                                 _SYMBOL_MAP)
    assert findings[0]["ok"] is False and findings[0]["reason"] == "dimension_mismatch"


def test_a_different_spin_count_is_reported():
    findings = pv._compare_reels(_game([[1]], "BaseGame") + _game([[2]], "LinkAndWin"),
                                 _pc([["ic://A"]]), _SYMBOL_MAP)
    assert findings[0] == {"check": "spin_count", "ok": False, "expected": 2, "actual": 1}


def test_without_a_symbol_map_the_reels_cannot_be_judged():
    findings = pv._compare_reels(_game([[1]]), _pc([["ic://A"]]), {})
    assert findings == [{"check": "reels", "ok": None, "reason": "no_symbol_map_profile"}]
    assert pv._verdict(findings) == "REVIEW"


def test_verdict_priority_fail_beats_review():
    assert pv._verdict([{"ok": None}, {"ok": False}]) == "FAIL"
    assert pv._verdict([{"ok": True}, {"ok": None}]) == "REVIEW"


# ── _compare_financials ─────────────────────────────────────────────────────────────────

def test_financials_accept_the_raw_or_divided_unit():
    findings = pv._compare_financials({"wagered": 100.0, "won": 8000.0},
                                      {"wagered": 1.0, "payout": 80.0}, 0.005, 100)
    assert all(f["ok"] for f in findings)
    assert pv._verdict(findings) == "PASS"


def test_a_missing_financial_value_fails():
    findings = pv._compare_financials({"wagered": None, "won": 1.0},
                                      {"wagered": 1.0, "payout": 1.0}, 0.005, 100)
    assert findings[0]["ok"] is False and findings[0]["reason"] == "missing_value"


# ── PlayCheck origin + symbol map ───────────────────────────────────────────────────────

@pytest.mark.parametrize("url,origin", [
    (_GAME_URL, "https://playcheck-app1-gtp601.installprogram.eu"),
    ("https://api5-rhel1-gtp603.installprogram.eu/x", None),
])
def test_playcheck_origin_is_derived_from_the_game_url(url, origin):
    assert pv._playcheck_origin_from_game_url(url) == origin


def test_symbol_map_is_empty_without_a_profile(monkeypatch):
    from server.tools.impl import symbol_profiles
    monkeypatch.setattr(symbol_profiles, "profile_for", lambda code, module: "RAW")
    monkeypatch.setattr(symbol_profiles, "get", lambda key: {"symbol_map": {"A": "SYM1"}})
    assert pv._load_symbol_map("105359") == {}


def test_symbol_map_reads_the_playcheck_icons_key(monkeypatch):
    from server.tools.impl import symbol_profiles
    monkeypatch.setattr(symbol_profiles, "profile_for", lambda code, module: "ADPC")
    monkeypatch.setattr(symbol_profiles, "get", lambda key: {"playcheck_icons": {"ic://A": 7}})
    assert pv._load_symbol_map("105359") == {"ic://A": "7"}


# ── the page-side js body must be a function, not a bare return ─────────────────────────

def test_js_fn_wraps_a_statement_body_as_an_arrow_function():
    assert playcheck._js_fn("return 1;") == "() => {\nreturn 1;\n}"
    assert playcheck._PC_GAME_DETAIL_JS.startswith("() => {")
    assert "() =>" in playcheck._PC_READY_JS and "() =>" in playcheck._PC_ROWS_JS


# ── full pipeline: verdict → tool success (H3) and harness form validation (H4) ──────────

def _ctx(tmp_path) -> HarnessContext:
    return HarnessContext(execution_id="exe_test", user_id="u", user_role="r", session_token="t",
                          work_dir=str(tmp_path / "work"))


def _game_response() -> PlayResponse:
    return PlayResponse(
        verb="Spin", trans_number=4242, stage="BaseGame", next_stage="BaseGame",
        stages=[StageResult(name="BaseGame",
                            financials={"wager": 100.0, "win": 80.0, "totalWager": 100.0, "totalWin": 80.0},
                            spins=[SlotSpin(symbols=[1, 2], width=2, height=1, seed="1,2")])],
    )


@contextmanager
def _fake_game_session():
    resp = _game_response()
    cap = Captured(seq=0, t=0.0, url="u", status=200, request_body=None, body="", play=resp)
    result = PlayResult(responses=[cap], states=[], started_at=0, ended_at=0, touches=0)
    page = SimpleNamespace(context=SimpleNamespace(storage_state=lambda **kw: None))
    yield SimpleNamespace(frame=SimpleNamespace(evaluate=lambda js: {}),
                          play=lambda label="spin": result, page=page)


@contextmanager
def _fake_sync_playwright():
    class _Browser:
        def new_context(self, **kw):
            return SimpleNamespace(new_page=lambda: object(), close=lambda: None)

        def close(self):
            pass

    yield SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kw: _Browser()))


def _install_fakes(monkeypatch, *, pc_spins, pc_fin=None):
    monkeypatch.setattr(pv, "open_session", lambda spec, **kw: _fake_game_session())
    monkeypatch.setattr(pv, "_load_symbol_map", lambda module_id: dict(_SYMBOL_MAP))
    detail = {"financials": pc_fin or {"wagered": 1.0, "payout": 80.0}, "spins": pc_spins}

    class _FakePlayCheckClient:
        def __init__(self, page, origin, timeout=60):
            self.origin = origin

        def open(self):
            pass

        def find_transaction(self, trans):
            return "sess-1", {}

        def get_game_detail(self, session_id, trans):
            return detail

    monkeypatch.setattr(pv, "PlayCheckClient", _FakePlayCheckClient)
    import playwright.sync_api as pw_api
    monkeypatch.setattr(pw_api, "sync_playwright", _fake_sync_playwright)
    return detail


def test_a_fail_verdict_is_a_result_not_a_tool_failure(monkeypatch, tmp_path):
    _install_fakes(monkeypatch, pc_spins=[{"reel_images": [["ic://B", "ic://B"]]}])
    result = pv.PlaycheckVerifierTool()._run_sync({"game_url": _GAME_URL, "module_id": "105359"},
                                                  _ctx(tmp_path))

    assert result.success is True
    assert result.content["verdict"] == "FAIL"
    assert any(f["ok"] is False for f in result.content["findings"])
    assert result.content["report_url"].startswith("/api/executions/runs/exe_test/playcheck_verifier/")
    assert any(a.endswith(f"playcheck_verification_trans{4242}.html") for a in result.artifacts)


def test_a_review_verdict_is_reported_too(monkeypatch, tmp_path):
    _install_fakes(monkeypatch, pc_spins=[{"reel_images": [["ic://A", "ic://Z"]]}])
    result = pv.PlaycheckVerifierTool()._run_sync({"game_url": _GAME_URL, "module_id": "105359"},
                                                  _ctx(tmp_path))

    assert result.success is True
    assert result.content["verdict"] == "REVIEW"


def test_everything_matching_is_a_pass(monkeypatch, tmp_path):
    _install_fakes(monkeypatch, pc_spins=[{"reel_images": [["ic://A", "ic://B"]]}])
    result = pv.PlaycheckVerifierTool()._run_sync({"game_url": _GAME_URL, "module_id": "105359"},
                                                  _ctx(tmp_path))

    assert result.success is True and result.content["verdict"] == "PASS"


def test_a_harness_url_without_form_fields_fails_before_launching(monkeypatch, tmp_path):
    monkeypatch.setattr(pv, "open_session",
                        lambda *a, **kw: pytest.fail("open_session must not run without form fields"))
    result = pv.PlaycheckVerifierTool()._run_sync({"game_url": _HARNESS_URL}, _ctx(tmp_path))

    assert result.success is False
    assert result.error.startswith("harness_form_fields_missing")
    assert "username" in result.error and "product_id" in result.error


def test_a_harness_url_with_form_fields_launches_with_them(monkeypatch, tmp_path):
    seen = {}
    _install_fakes(monkeypatch, pc_spins=[{"reel_images": [["ic://A", "ic://B"]]}])

    @contextmanager
    def capturing_session(spec, **kw):
        seen["spec"] = spec
        with _fake_game_session() as gs:
            yield gs

    monkeypatch.setattr(pv, "open_session", capturing_session)
    result = pv.PlaycheckVerifierTool()._run_sync(
        {"game_url": _HARNESS_URL, "username": "lijunt", "product_id": "5001", "client_id": "40300",
         "module_id": "105359"},
        _ctx(tmp_path))

    assert result.success, result.error
    spec = seen["spec"]
    assert spec.mode == "titan" and spec.username == "lijunt"
    assert spec.product_id == "5001" and spec.client_id == "40300" and spec.module_id == "105359"
