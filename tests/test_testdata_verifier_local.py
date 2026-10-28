"""testdata_verifier_local / testdata_verifier_harness: a folder verified file by file, with one
account for all of it or one Axiom keyword account per file.

The browser and Axiom are faked: the fake server keeps one active .testdata per account (the last
upload for that account replaces its queue), which is exactly why the local tool must play a file
before uploading the next one for the same account.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from server.game_session import LaunchFailed, PlayResponse, PlayResult
from server.game_session.capture import Captured
from server.tools.base import HarnessContext
from server.tools.impl import testdata_verifier_harness_tool as harness
from server.tools.impl import testdata_verifier_local_tool as local
from server.tools.impl.testdata_verify_common import (
    _extract_testdata_key, _parse_testdata, keyword_accounts, url_with_username,
)

URL = ("http://localhost:5240/launch/mgs/luckyJourneyPowerCombo?moduleId=102554&clientId=40302"
       "&productId=5001&brand=IslandParadise&username=lijunt&password=test1234%24")


def _testdata(module_id: str, login: str, seeds: list[tuple[int, int]], bom: bool = False) -> bytes:
    spins = "".join(f'<Spin stage="BaseGame"><PreGen batch="{b}" index="{i}" /></Spin>\r\n' for b, i in seeds)
    text = (f'<?xml version="1.0" encoding="UTF-8"?>\r\n<Test>\r\n  <Key moduleID="{module_id}" '
            f'loginName="{login}" />\r\n  <Slot>\r\n{spins}  </Slot>\r\n</Test>')
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")


class FakeServer:
    """One seed queue per account: an upload replaces that account's queue, a Spin pops from the
    queue of the account the current session logged in as."""

    def __init__(self):
        self.queues: dict[str, list[tuple[int, int]]] = {}
        self.uploads: list[tuple[str, bytes]] = []
        self.events: list[str] = []
        self.logins: list[str] = []
        self.unknown_accounts: set[str] = set()
        self.login = ""

    def upload(self, client, upload_host, api_key, name, content):
        assert upload_host == "axiomcore-app1-gtp603.installprogram.eu"
        self.uploads.append((name, content))
        tmp = self.tmp_dir / f"uploaded_{len(self.uploads)}.testdata"
        tmp.write_bytes(content)
        login = _extract_testdata_key(tmp)["loginName"]
        self.events.append(f"upload:{name}:{login}")
        self.queues[login] = [(r["batch"], r["index"]) for r in _parse_testdata(tmp)]
        return None

    def open(self, spec):
        # A direct URL logs in as its username param; the harness form as the spec's username.
        self.spec = spec
        q = parse_qs(urlparse(spec.url).query)
        self.login = q["username"][0] if spec.mode == "direct" else spec.username
        if self.login in self.unknown_accounts:
            raise LaunchFailed("GAME_PAGE_NOT_LOADED", f"no such account {self.login}")
        self.logins.append(self.login)

    def play(self, label="play", shots_dir=None):
        self.events.append(f"play:{label}")
        queue = self.queues.get(self.login, [])
        seed = queue.pop(0) if queue else (999, 999)
        resp = PlayResponse(verb="Spin", stage="BaseGame", pregen=seed, testdata_stage="BaseGame",
                            testdata_pregens=[("Spin", *seed)])
        cap = Captured(seq=0, t=time.time(), url="u", status=200, request_body=None, body="", play=resp)
        return PlayResult(responses=[cap], states=[], started_at=0, ended_at=0, touches=0)


@pytest.fixture
def server(monkeypatch, tmp_path):
    srv = FakeServer()
    srv.tmp_dir = tmp_path
    gs = SimpleNamespace(
        capture=SimpleNamespace(platform_hosts=["api5-rhel1-gtp603.installprogram.eu"]),
        finish_restored_play=lambda shots_dir=None: None,
        play=srv.play,
        screenshot=lambda path: None,
    )

    @contextmanager
    def fake_open_session(spec, **kwargs):
        srv.open(spec)
        yield gs

    for module in (local, harness):
        monkeypatch.setattr(module, "open_session", fake_open_session)
        monkeypatch.setattr(module, "_upload_testdata", srv.upload)
    return srv


def _run(params: dict, work_dir) -> object:
    ctx = HarnessContext(execution_id="exe_test", user_id="u", user_role="r", session_token="t",
                         work_dir=str(work_dir))
    return local.TestdataVerifierLocalTool()._run_verification_sync(
        {"game_url": URL, "axiom_api_key": "k", **params}, ctx)


def test_each_file_is_uploaded_then_played_before_the_next(server, tmp_path):
    folder = tmp_path / "td"
    folder.mkdir()
    (folder / "b.testdata").write_bytes(_testdata("102554", "automate02", [(3, 4)]))
    (folder / "A.testdata").write_bytes(_testdata("102554", "", [(1, 2), (5, 6)], bom=True))

    result = _run({"testdata_folder": str(folder)}, tmp_path / "work")

    assert result.success, result.error
    assert server.events == ["upload:A.testdata:lijunt", "play:A.testdata:spin1", "play:A.testdata:spin2",
                             "upload:b.testdata:lijunt", "play:b.testdata:spin1"]
    assert server.logins == ["lijunt"]  # one session for the whole folder
    assert result.content["passed"] == 3 and result.content["env"] == "gtp603"
    # every uploaded copy plays as the link's username; the BOM survives, the files on disk do not change
    for _, content in server.uploads:
        assert b'loginName="lijunt"' in content
    assert server.uploads[0][1].startswith(b"\xef\xbb\xbf")
    assert b'loginName=""' in (folder / "A.testdata").read_bytes()


def test_a_file_for_another_module_is_reported_not_played(server, tmp_path):
    folder = tmp_path / "td"
    folder.mkdir()
    (folder / "a.testdata").write_bytes(_testdata("104938", "lijunt", [(1, 2)]))
    (folder / "b.testdata").write_bytes(_testdata("102554", "lijunt", [(3, 4)]))

    result = _run({"testdata_folder": str(folder)}, tmp_path / "work")

    assert not result.success
    assert server.events == ["upload:b.testdata:lijunt", "play:b.testdata:spin1"]
    verdicts = [(c["source_file"], c["verdict"]) for c in result.content["cases"]]
    assert verdicts == [("a.testdata", "MODULE_MISMATCH"), ("b.testdata", "PASSED")]


def test_a_harness_url_or_a_link_without_an_account_is_refused(server, tmp_path):
    ctx_dir = tmp_path / "work"
    harness = _run({"game_url": "https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/harness/x",
                    "testdata_folder": str(tmp_path)}, ctx_dir)
    assert harness.error.startswith("local_link_is_a_harness_url")
    no_user = _run({"game_url": "http://localhost:5240/launch/mgs/x?moduleId=1", "testdata_folder": str(tmp_path)},
                   ctx_dir)
    assert no_user.error.startswith("local_link_missing_username_or_moduleId")


def test_env_is_required_when_the_traffic_does_not_name_it(server, tmp_path, monkeypatch):
    folder = tmp_path / "td"
    folder.mkdir()
    (folder / "a.testdata").write_bytes(_testdata("102554", "lijunt", [(1, 2)]))
    gs = SimpleNamespace(capture=SimpleNamespace(platform_hosts=[]), finish_restored_play=lambda d=None: None,
                         play=server.play, screenshot=lambda path: None)

    @contextmanager
    def no_traffic(spec, **kwargs):
        server.open(spec)
        yield gs

    monkeypatch.setattr(local, "open_session", no_traffic)
    assert _run({"testdata_folder": str(folder)}, tmp_path / "work").error.startswith("env_required")
    explicit = _run({"testdata_folder": str(folder), "env": "gtp603"}, tmp_path / "work2")
    assert explicit.success, explicit.error


def test_the_password_is_masked_in_the_report_url():
    assert "test1234" not in local._redact_url(URL)
    assert "username=lijunt" in local._redact_url(URL)


# ── keyword accounts (Axiom "Bulk Create Multiple Accounts": automate1, automate2, ...) ──

def _folder(tmp_path, n: int, module_id: str = "102554"):
    folder = tmp_path / "td"
    folder.mkdir()
    for i in range(1, n + 1):
        (folder / f"f{i}.testdata").write_bytes(_testdata(module_id, "", [(i, i * 10)]))
    return folder


def test_keyword_accounts_are_numbered_like_axiom():
    assert keyword_accounts("automate", 5, 3) == ["automate1", "automate2", "automate3"]
    with pytest.raises(ValueError, match="create 2 more"):
        keyword_accounts("automate", 3, 5)
    with pytest.raises(ValueError, match="account_keyword_invalid"):
        keyword_accounts("auto mate", 5, 1)


def test_url_with_username_keeps_every_other_param():
    q = parse_qs(urlparse(url_with_username(URL, "automate2")).query)
    assert q["username"] == ["automate2"] and q["password"] == ["test1234$"] and q["moduleId"] == ["102554"]


def test_local_link_gives_each_file_its_own_keyword_account(server, tmp_path):
    folder = _folder(tmp_path, 3)

    result = _run({"testdata_folder": str(folder), "account_keyword": "automate", "account_count": 5},
                  tmp_path / "work")

    assert result.success, result.error
    assert server.logins == ["automate1", "automate2", "automate3"]
    assert server.events == ["upload:f1.testdata:automate1", "play:f1.testdata:spin1",
                             "upload:f2.testdata:automate2", "play:f2.testdata:spin1",
                             "upload:f3.testdata:automate3", "play:f3.testdata:spin1"]
    assert result.content["accounts"] == [{"file": f"f{i}.testdata", "loginName": f"automate{i}"}
                                          for i in (1, 2, 3)]
    assert "login automate2" in (tmp_path / "work" / "report.html").read_text(encoding="utf-8")


def test_too_few_accounts_fails_before_anything_runs(server, tmp_path):
    folder = _folder(tmp_path, 3)
    result = _run({"testdata_folder": str(folder), "account_keyword": "automate", "account_count": 2},
                  tmp_path / "work")
    assert result.error.startswith("account_count_too_small") and server.events == []


def test_an_account_that_cannot_log_in_only_costs_its_own_file(server, tmp_path):
    folder = _folder(tmp_path, 3)
    server.unknown_accounts = {"automate2"}

    result = _run({"testdata_folder": str(folder), "account_keyword": "automate", "account_count": 3},
                  tmp_path / "work")

    verdicts = [(c["source_file"], c["verdict"]) for c in result.content["cases"]]
    assert verdicts == [("f1.testdata", "PASSED"), ("f2.testdata", "LOGIN_FAILED"), ("f3.testdata", "PASSED")]


def _run_harness(params: dict, work_dir) -> object:
    ctx = HarnessContext(execution_id="exe_test", user_id="u", user_role="r", session_token="t",
                         work_dir=str(work_dir))
    return harness.TestdataVerifierHarnessTool()._run_verification_sync(
        {"axiom_api_key": "k", "env": "gtp603", "product_id": "5001", "client_id": "40302", **params}, ctx)


def test_harness_uploads_every_file_to_its_own_account_then_plays_each_as_it(server, tmp_path):
    folder = _folder(tmp_path, 3)
    files = sorted(str(p) for p in folder.iterdir())

    result = _run_harness({"harness_url": "https://mobile-app1-gtp603.installprogram.eu/htmlGames/4.54.0/harness/x",
                           "testdata_files": files, "account_keyword": "automate", "account_count": 3},
                          tmp_path / "work")

    assert result.success, result.error
    assert server.events[:3] == ["upload:f1.testdata:automate1", "upload:f2.testdata:automate2",
                                 "upload:f3.testdata:automate3"]
    assert server.logins == ["automate1", "automate2", "automate3"]
    assert server.spec.module_id == "102554" and server.spec.client_id == "40302"


def test_harness_without_a_keyword_still_needs_one_shared_identity(server, tmp_path):
    folder = tmp_path / "td"
    folder.mkdir()
    (folder / "a.testdata").write_bytes(_testdata("102554", "automate1", [(1, 2)]))
    (folder / "b.testdata").write_bytes(_testdata("102554", "automate2", [(3, 4)]))

    result = _run_harness({"harness_url": URL, "testdata_files": [str(p) for p in folder.iterdir()]},
                          tmp_path / "work")

    assert result.error.startswith("testdata_files_have_different_identities")
