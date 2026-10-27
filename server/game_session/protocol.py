"""Normalize a captured /casino/play response into one flat `PlayResponse`.

Formats seen on this platform:
  - On the wire (captured live from Mega Eagle 2 / gtp603, 2026-10-21): a JSON envelope around an XML packet
        {"context": {"financials": {...}, "balances": {...}}, "packet": {"payload": "<Pkt version=\"5\">...</Pkt>"}}
    The XML is `<Pkt><Id verb=".."/><Response><Player/><Financial/><Slot stage nextStage>...` with the
    testdata seed under `<TestData>`; `<Logic><Pregen checksum>` is the opaque feature checksum, NOT a seed.
  - In the page (jftwTools.response.getLatestGameResponse()): the client's own JSON conversion
        {"id": {"verb": "Spin"}, "version": 5, "gameResponse": {player, slot, testData?, financials}}
  - Bare XML `<Pkt>...` — what the retired API verifier read.
Everything downstream (matcher, judge, report) only ever sees PlayResponse, so a new wire format is one
more parse function here, not a change to the verification logic.

Only the player-initiated `Spin` response carries `<TestData>`; feature steps (`Bonus`, `Freespin`, ...)
do not, and their `logic.pregen.checksum` cannot be mapped back to a PreGen (confirmed with the backend).
But `<TestData>` echoes the whole .testdata `<Spin>` record the server consumed — including nested
`<Feature><PreGen/></Feature>` seeds and `<Meter>`/`<Token>`/`<Random>` controls (confirmed live,
Mega Eagle 2, 2026-10-21). `testdata_pregens` / `testdata_xml` expose that echo, which is how feature
seeds are verified.
"""
from __future__ import annotations

import base64
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PlayResponse:
    verb: str                                  # Spin | Bonus | Freespin | Respin | Refresh | Error | ...
    stage: str | None = None                   # slot.stage — the stage this response played
    next_stage: str | None = None              # slot.nextStage — "BaseGame" once the play is over
    pregen: tuple[int, int] | None = None      # (batch, index) from testData.spin.preGen
    testdata_stage: str | None = None          # testData.spin.stage
    testdata_comment: str | None = None
    # Every PreGen in the echoed record, document order, with the path of its parent elements:
    # [("Spin", 140, 16), ("Spin/Feature", 8, 2587)]
    testdata_pregens: list[tuple[str, int, int]] = field(default_factory=list)
    testdata_xml: str | None = None            # the echoed <Spin> record, verbatim
    win: float | None = None                   # financials.win — this step's win
    wager: float | None = None
    total_win: float | None = None             # financials.totalWin — running total of the play
    total_wager: float | None = None
    balance: float | None = None               # player.balance after this step
    trans_number: int | None = None            # constant for a whole play (Spin + its feature steps)
    error: str | None = None
    raw: Any = field(default=None, repr=False)

    @property
    def is_error(self) -> bool:
        return self.verb == "Error" or bool(self.error)

    @property
    def ends_play(self) -> bool:
        """True once the server says the next stage is BaseGame again (or there is no next stage)."""
        return self.next_stage in (None, "", "BaseGame")

    def summary(self) -> dict[str, Any]:
        return {
            "verb": self.verb, "stage": self.stage, "nextStage": self.next_stage,
            "pregen": list(self.pregen) if self.pregen else None,
            "testdataPregens": [list(p) for p in self.testdata_pregens] or None,
            "win": self.win, "wager": self.wager, "totalWin": self.total_win,
            "balance": self.balance, "transNumber": self.trans_number, "error": self.error,
        }


def _num(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    try:
        return int(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def parse_json(data: dict[str, Any]) -> PlayResponse:
    verb = str(((data.get("id") or {}).get("verb")) or "")
    g = data.get("gameResponse") or {}
    slot = g.get("slot") or {}
    fin = g.get("financials") or {}
    player = g.get("player") or {}
    td = ((g.get("testData") or {}).get("spin")) or {}
    pg = td.get("preGen") or {}
    batch, index = _int(pg.get("batch")), _int(pg.get("index"))
    err = g.get("error") or g.get("errorMessage") or data.get("error")
    if verb == "Error" and not err:
        err = json.dumps(g)[:300] or "Error"
    pregens: list[tuple[str, int, int]] = []

    def walk(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            return
        for k, v in node.items():
            if k.lower() == "pregen" and isinstance(v, dict):
                b, i = _int(v.get("batch")), _int(v.get("index"))
                if b is not None and i is not None:
                    pregens.append((path, b, i))
            elif isinstance(v, dict):
                walk(v, f"{path}/{k[:1].upper()}{k[1:]}")

    walk(td, "Spin")
    return PlayResponse(
        verb=verb,
        stage=slot.get("stage"),
        next_stage=slot.get("nextStage"),
        pregen=(batch, index) if batch is not None and index is not None else None,
        testdata_stage=td.get("stage"),
        testdata_comment=td.get("comment"),
        testdata_pregens=pregens,
        win=_num(fin.get("win")), wager=_num(fin.get("wager")),
        total_win=_num(fin.get("totalWin")), total_wager=_num(fin.get("totalWager")),
        balance=_num(player.get("balance")),
        trans_number=_int(player.get("transNumber")),
        error=str(err) if err else None,
        raw=data,
    )


def _testdata_echo(root: ET.Element) -> tuple[ET.Element | None, list[tuple[str, int, int]], str | None]:
    """(record element, all PreGens with their parent path, record XML) under <TestData>.
    Only <TestData> is searched, so a <Logic><Pregen checksum> is never mistaken for a seed."""
    td = root.find(".//TestData")
    if td is None:
        return None, [], None
    record = next(iter(td), None)          # the echoed <Spin ...> element
    if record is None:
        return None, [], None
    pregens: list[tuple[str, int, int]] = []

    def walk(el: ET.Element, path: str) -> None:
        for child in el:
            if child.tag.lower() == "pregen":
                b, i = _int(child.get("batch")), _int(child.get("index"))
                if b is not None and i is not None:
                    pregens.append((path, b, i))
            else:
                walk(child, f"{path}/{child.tag}")

    walk(record, record.tag)
    return record, pregens, ET.tostring(record, encoding="unicode")


def parse_xml(text: str, raw: Any = None) -> PlayResponse:
    root = ET.fromstring(text)
    id_el = root.find(".//Id")
    verb = (id_el.get("verb") if id_el is not None else "") or ""
    fin = root.find(".//Response/Financial")
    if fin is None:
        fin = root.find(".//Financial")
    slot = root.find(".//Slot")
    record, pregens, record_xml = _testdata_echo(root)
    player = root.find(".//Player")
    # The record's own (top-level) PreGen is the base seed; nested ones belong to features.
    base = next((p for p in pregens if p[0] == (record.tag if record is not None else "")), None)
    batch, index = (base[1], base[2]) if base else (None, None)
    err_el = root.find(".//Error")
    if verb == "Error" and err_el is None:
        err_el = root.find(".//Response")
    return PlayResponse(
        verb=verb,
        stage=slot.get("stage") if slot is not None else None,
        next_stage=slot.get("nextStage") if slot is not None else None,
        pregen=(batch, index) if batch is not None and index is not None else None,
        testdata_stage=record.get("stage") if record is not None else None,
        testdata_comment=record.get("comment") if record is not None else None,
        testdata_pregens=pregens,
        testdata_xml=record_xml,
        win=_num(fin.get("win")) if fin is not None else None,
        wager=_num(fin.get("wager")) if fin is not None else None,
        total_win=_num(fin.get("totalWin")) if fin is not None else None,
        total_wager=_num(fin.get("totalWager")) if fin is not None else None,
        balance=_num(player.get("balance")) if player is not None else None,
        trans_number=_int(player.get("transNumber")) if player is not None else None,
        error=(err_el.get("msg") or err_el.get("code") or (err_el.text or "").strip() or ET.tostring(err_el, "unicode")[:300])
        if err_el is not None else None,
        raw=raw if raw is not None else text,
    )


def parse(body: str | bytes) -> PlayResponse:
    """Parse a raw /casino/play response body, whichever format it is in."""
    text = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    stripped = text.lstrip()
    if stripped.startswith("{"):
        data = json.loads(stripped)
        packet = data.get("packet") if isinstance(data, dict) else None
        if isinstance(packet, dict) and isinstance(packet.get("payload"), str):
            payload = packet["payload"]
            if packet.get("isBase64Encoded"):
                payload = base64.b64decode(payload).decode("utf-8", "replace")
            return parse_xml(payload, raw=data)
        return parse_json(data)
    if stripped.startswith("<"):
        return parse_xml(stripped)
    raise ValueError(f"unrecognized play response format: {stripped[:80]!r}")
