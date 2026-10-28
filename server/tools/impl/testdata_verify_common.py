"""Shared, browser-independent helpers for the TestData verifier tools: .testdata parsing,
judging a record against the server's <TestData> echo, URL/Key identity checks, and the
standalone HTML report.

These used to live in testdata_verifier_tool.py, the original Selenium verifier (real game URL +
borrowed Chrome profile + interactive Okta, testdata uploaded by clicking through the admin
panel). That tool was retired in favour of the Harness login and has been removed; only the
pieces the remaining tools share were kept here.

Nothing here touches a browser, which is the point: testdata_verifier_harness (Playwright, via
server/game_session) and testdata_verifier_api (no browser at all) both import from it, and so
does portugal_plugin_fetcher. The Selenium page-driving helpers those tools used to share are in
selenium_page_drivers.py now, so importing this module does not pull Selenium in.
"""
from __future__ import annotations
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs, parse_qsl


def _extract_url_identity(game_url: str) -> dict:
    """Pull the `username` / `moduleId` query params off the game URL.

    These are the two values the real game environment uses to decide *which* uploaded
    .testdata file's seed queue to actually read from — see _check_key_matches_url()."""
    qs = parse_qs(urlparse(game_url).query)
    return {
        "username": (qs.get("username") or [""])[0],
        "moduleId": (qs.get("moduleId") or [""])[0],
    }


def _extract_testdata_key(filepath: Path) -> dict:
    """Read just the <Key moduleID=".." loginName=".."/> identity out of a .testdata file,
    without parsing the (possibly invalid, at this point still-unvalidated) spin records."""
    key_elem = _find_key(_load_testdata_root(filepath))
    return {
        "moduleID": (_attr(key_elem, "moduleID") or "") if key_elem is not None else "",
        "loginName": (_attr(key_elem, "loginName") or "") if key_elem is not None else "",
    }


def _check_key_matches_url(testdata_key: dict, url_identity: dict) -> list[str]:
    """Verify a .testdata file's <Key> identity against the target game URL's query params.

    The real game environment silently ignores an uploaded .testdata file whenever its
    loginName/moduleID don't match the URL's username/moduleId — it just keeps serving
    whatever seed was already queued for that login instead (confirmed empirically: an
    uploaded batch/index only ever showed up in the game's response when both matched; a
    moduleId mismatch made the game return a completely unrelated seed with no error at all).
    Catching the mismatch here, before Selenium ever touches the browser, turns that silent
    wrong-seed failure into an immediate, specific error instead of a misleading PASS/FAIL
    report against data the game never actually used.
    """
    issues: list[str] = []
    if testdata_key["loginName"] != url_identity["username"]:
        issues.append(
            f"loginName mismatch: testdata Key loginName={testdata_key['loginName']!r} "
            f"!= URL username={url_identity['username']!r}"
        )
    if testdata_key["moduleID"] != url_identity["moduleId"]:
        issues.append(
            f"moduleID mismatch: testdata Key moduleID={testdata_key['moduleID']!r} "
            f"!= URL moduleId={url_identity['moduleId']!r}"
        )
    return issues


# <Key ...> with or without a loginName attribute; attribute values never contain '>'. Case-insensitive,
# like the parser, so a <key loginname=..> file is injected into rather than rejected.
_KEY_TAG = re.compile(r"<Key\b[^>]*?/?>", re.IGNORECASE)
_LOGIN_ATTR = re.compile(r"""\bloginName\s*=\s*("[^"]*"|'[^']*')""", re.IGNORECASE)


def set_login_name(xml: str, login: str) -> str:
    """Return the .testdata text with <Key loginName> set to `login`; everything else unchanged.

    Text in, text out (not an XML round-trip), so line endings, attribute order and comments stay
    byte-identical — the uploaded file differs from the original only in that one attribute."""
    m = _KEY_TAG.search(xml)
    if not m:
        raise ValueError("no <Key> element")
    tag = m.group(0)
    if _LOGIN_ATTR.search(tag):
        new_tag = _LOGIN_ATTR.sub(f'loginName="{login}"', tag, count=1)
    else:
        end = len(tag) - (2 if tag.endswith("/>") else 1)
        new_tag = f'{tag[:end].rstrip()} loginName="{login}" {tag[end:]}'
    return xml[:m.start()] + new_tag + xml[m.end():]


def testdata_bytes_with_login(path: Path, login: str) -> bytes:
    """The bytes to upload for `path`: the file with its <Key loginName> set to `login`, BOM kept."""
    raw = path.read_bytes()
    bom = b"\xef\xbb\xbf" if raw.startswith(b"\xef\xbb\xbf") else b""
    return bom + set_login_name(raw[len(bom):].decode("utf-8"), login).encode("utf-8")


def keyword_accounts(keyword: str, count: int, n_files: int) -> list[str]:
    """The accounts Axiom's "Bulk Create Multiple Accounts" made from `keyword`, one per file in order.

    Axiom appends 1..count to the keyword with no zero padding (automate1, automate2, ...), so the
    names are rebuilt the same way here rather than looked up. The tester creates them in Axiom with
    the same keyword and count; a run that needs more accounts than that fails before anything is
    uploaded, saying how many are missing.
    """
    keyword = (keyword or "").strip()
    if not keyword or any(c.isspace() for c in keyword):
        raise ValueError(f"account_keyword_invalid:{keyword!r} — one word, the Username typed into Axiom")
    if count < n_files:
        raise ValueError(
            f"account_count_too_small: {n_files} testdata file(s) but only {count} account(s) "
            f"({keyword}1..{keyword}{count}) — create {n_files - count} more in Axiom with the same keyword")
    return [f"{keyword}{n}" for n in range(1, n_files + 1)]


def url_with_username(url: str, username: str) -> str:
    """A direct launch URL that logs in as `username` instead; every other query param is kept."""
    parsed = urlparse(url)
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != "username"]
    query.append(("username", username))
    return parsed._replace(query=urlencode(query)).geturl()


class TestdataFormatError(ValueError):
    """A .testdata file the parser cannot turn into seed records. The message names the file's
    problem (which <Spin>, which attribute) so the tester can fix the file, not the harness."""


def _local_tag(el: ET.Element) -> str:
    """The element's tag without any {namespace}, lower-cased: tags are matched case-insensitively."""
    return el.tag.rsplit("}", 1)[-1].lower()


def _attr(el: ET.Element, name: str) -> str | None:
    """An attribute looked up case-insensitively (batch / Batch / BATCH), stripped."""
    name = name.lower()
    for k, v in el.attrib.items():
        if k.rsplit("}", 1)[-1].lower() == name:
            return v.strip()
    return None


def _load_testdata_root(filepath: Path) -> ET.Element:
    """Parse a .testdata file, tolerating what hand-edited files vary in: a UTF-8 BOM and blank
    lines or spaces before the <?xml?> declaration (which a strict XML parser rejects)."""
    raw = filepath.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return ET.fromstring(raw.lstrip())
    except ET.ParseError as e:
        raise TestdataFormatError(f"not well-formed XML: {e}") from None


def _find_key(root: ET.Element) -> ET.Element | None:
    return next((el for el in root.iter() if _local_tag(el) == "key"), None)


def _spin_elements(root: ET.Element) -> list[ET.Element]:
    """Every record-level <Spin>, in document order, wherever it sits: under <Test><Slot> in most
    games, directly under <Test> in others (TGPF / WG3 BigWins). A <Spin> is never searched for
    further <Spin>s — what is inside it belongs to that record."""
    found: list[ET.Element] = []

    def walk(el: ET.Element) -> None:
        for child in el:
            if _local_tag(child) == "spin":
                found.append(child)
            else:
                walk(child)

    walk(root)
    return found


def _int_attr(el: ET.Element, name: str, where: str) -> int:
    value = _attr(el, name)
    if value is None or value == "":
        raise TestdataFormatError(f"{where}: <PreGen> has no {name} attribute")
    try:
        return int(value)
    except ValueError:
        raise TestdataFormatError(f"{where}: <PreGen {name}={value!r}> is not an integer") from None


def _spin_pregens(spin: ET.Element, where: str) -> list[dict]:
    """Every <PreGen> of one record, in document order, with the path of its parent elements as
    written in the file: "Spin" for the record's own seed, "Spin/Feature" for a nested feature seed.
    The server's <TestData> echo is walked the same way (protocol._testdata_echo), so the two lists
    line up path for path."""
    pregens: list[dict] = []

    def walk(el: ET.Element, path: str) -> None:
        for child in el:
            if _local_tag(child) == "pregen":
                pregens.append({"path": path,
                                "batch": _int_attr(child, "batch", where),
                                "index": _int_attr(child, "index", where)})
            else:
                walk(child, f"{path}/{child.tag.rsplit('}', 1)[-1]}")

    walk(spin, "Spin")
    return pregens


def is_base_stage(stage: str | None) -> bool:
    """A record the player spins for. Any other stage (FreeSpin, Bonus, ...) is a feature round the
    game plays by itself after the spin that triggered it."""
    return (stage or "BaseGame").strip().lower() == "basegame"


def _parse_testdata(filepath: Path) -> list[dict]:
    """Parse a .testdata file into one record per <Spin>.

    The layouts seen across games (samples collected 2026-10-28) differ only in where the records sit
    and what sits beside the seed, and all of them carry the seed as <PreGen batch index>:

        <Test>
          <Key moduleID="..." loginName="..." />
          <Slot>                                   ← optional: some games put <Spin> right under <Test>
            <Spin stage="BaseGame" comment="..">
              <Meter .. /> <Token .. /> <Random .. />   ← controls, echoed but not seeds
              <PreGen batch="620" index="0" />           ← the record's own seed (path "Spin")
              <Feature><PreGen batch="3809" index="38"/></Feature>   ← nested feature seed
            </Spin>
            <Spin stage="FreeSpin">                ← or the feature seed as its own record
              <PreGen batch="11" index="10" />
            </Spin>
          </Slot>
        </Test>

    Tags and attribute names are matched case-insensitively and namespaces are ignored. Every
    <Spin> must have its own <PreGen> with integer batch and index; a file that does not (the
    retired reel-seed format, <B_G seed="35,4|.."/>, or a typo) raises TestdataFormatError naming
    the record, instead of yielding no records.

    Each record keeps every PreGen in `pregens` ([{path, batch, index}]); `batch`/`index` are its
    own seed and `bonusBatch`/`bonusIndex` the first nested one, for the report and the UI.
    """
    root = _load_testdata_root(filepath)
    spins = _spin_elements(root)
    if not spins:
        raise TestdataFormatError("no <Spin> record under <Test> or <Test><Slot>")

    records: list[dict] = []
    for n, spin in enumerate(spins, start=1):
        stage = _attr(spin, "stage") or "BaseGame"
        where = f"Spin #{n} (stage={stage})"
        pregens = _spin_pregens(spin, where)
        own = [p for p in pregens if p["path"] == "Spin"]
        if not own:
            if any(_attr(el, "seed") is not None for el in spin.iter()):
                raise TestdataFormatError(
                    f"{where}: reel-seed record (<.. seed=\"..\"/>) with no <PreGen> — this testdata "
                    "format is retired; every record needs <PreGen batch=\"..\" index=\"..\"/>")
            raise TestdataFormatError(f"{where}: no <PreGen batch=\"..\" index=\"..\"/> directly inside <Spin>")
        nested = [p for p in pregens if p["path"] != "Spin"]
        records.append({
            "spinIndex": n,
            "stage": stage,
            "comment": _attr(spin, "comment") or "",
            "pregens": pregens,
            "batch": own[0]["batch"],
            "index": own[0]["index"],
            "isBonus": bool(nested),
            "bonusBatch": nested[0]["batch"] if nested else None,
            "bonusIndex": nested[0]["index"] if nested else None,
        })
    return records


# ── Judging a record against the server's <TestData> echo ────────────────────────────────────
#
# The Spin response that consumed a record echoes that whole <Spin> under <TestData> (confirmed live,
# docs/p0-testdata-verification-findings.md), so every PreGen of the record — its own and the nested
# feature ones — is checked against the echo by path. `play` below is a game_session PlayResponse.

def _empty_result(source_file: str, verdict: str, issues: list[str]) -> dict:
    return {
        "passed": False, "verdict": verdict,
        "actualBatch": None, "actualIndex": None, "actualStage": "N/A",
        "actualWin": 0, "actualWager": 0,
        "issues": issues, "screenshot_b64": None, "source_file": source_file,
    }


def _seed_issues(record: dict, echoed: list[tuple[str, int, int]]) -> list[str]:
    """What differs between a record's PreGens and an echo's [(path, batch, index)]. Paths compare
    case-insensitively (the JSON echo capitalises them), and the order within a path does not matter."""
    want = sorted((p["path"].lower(), p["batch"], p["index"]) for p in record["pregens"])
    got = sorted((path.lower(), b, i) for path, b, i in echoed)
    issues: list[str] = []
    own_exp = [(b, i) for p, b, i in want if p == "spin"]
    own_act = [(b, i) for p, b, i in got if p == "spin"]
    if own_exp != own_act:
        issues.append(f"batch/index mismatch: expected={own_exp}, actual={own_act or None}")
    feat_exp = [f"{p}:({b}, {i})" for p, b, i in want if p != "spin"]
    feat_act = [f"{p}:({b}, {i})" for p, b, i in got if p != "spin"]
    if feat_exp != feat_act:
        issues.append(f"feature seed mismatch: expected={feat_exp or None}, actual={feat_act or None}")
    return issues


def _play_result(play, passed: bool, verdict: str, issues: list[str], source_file: str,
                 echoed: list[tuple[str, int, int]]) -> dict:
    own = next(((b, i) for p, b, i in echoed if p.lower() == "spin"), play.pregen)
    return {
        "passed": passed, "verdict": verdict,
        "actualBatch": own[0] if own else None,
        "actualIndex": own[1] if own else None,
        "actualStage": play.testdata_stage or play.stage or "N/A",
        "actualWin": play.win or 0, "actualWager": play.wager or 0,
        "actualPregens": [[p, b, i] for p, b, i in echoed],
        "transNumber": play.trans_number,
        "issues": issues, "screenshot_b64": None, "source_file": source_file,
    }


def compare_spin(record: dict, play, source_file: str) -> dict:
    """Judge a BaseGame record against the Spin response that consumed it."""
    if play is None:
        return _empty_result(source_file, "TIMEOUT",
                             ["No Spin response with a <TestData> echo was captured for this record"])
    echoed = list(play.testdata_pregens) or ([("Spin", *play.pregen)] if play.pregen else [])
    if play.is_error:
        return _play_result(play, False, "SEED_REJECTED", [f"Server rejected seed: {play.error}"],
                            source_file, echoed)
    if not echoed:
        return _play_result(play, False, "SEED_MISMATCH", [
            "The Spin response carried no <TestData> echo — the server did not play a testdata record "
            "(check the <Key> loginName/moduleID and that the upload reached this account)"],
            source_file, echoed)

    issues = _seed_issues(record, echoed)
    verdict = "SEED_MISMATCH" if issues else "PASSED"
    if play.testdata_stage and play.testdata_stage.lower() != record["stage"].lower():
        issues.append(f"stage mismatch: expected={record['stage']!r}, actual={play.testdata_stage!r}")
        verdict = "SEED_MISMATCH" if verdict != "PASSED" else "STAGE_MISMATCH"
    return _play_result(play, verdict == "PASSED", verdict, issues, source_file, echoed)


def compare_feature(record: dict, plays: list, source_file: str) -> dict:
    """Judge a feature-stage record (<Spin stage="FreeSpin">, ...) written as its own <Spin>.

    The game plays it by itself after the BaseGame spin that triggered it, so it is judged against
    the responses of that play (`plays`, in order). Its seed is looked for in any <TestData> echo
    of the play: one whose echoed stage is this record's stage first, else anywhere in an echo.

    UNVERIFIED against a live run: which response echoes such a record — the triggering Spin only
    echoes its own <Spin> on the one game confirmed so far. When no echo carries the seed the record
    is reported SEED_NOT_ECHOED (not PASSED), saying whether the feature stage was played at all.
    """
    if not plays:
        return _empty_result(source_file, "TIMEOUT",
                             ["No triggering BaseGame play was captured before this feature record"])
    stage = record["stage"].lower()
    for play in plays:
        if play.testdata_pregens and (play.testdata_stage or "").lower() == stage:
            issues = _seed_issues(record, play.testdata_pregens)
            return _play_result(play, not issues, "SEED_MISMATCH" if issues else "PASSED", issues,
                                source_file, play.testdata_pregens)
    want = (record["batch"], record["index"])
    for play in plays:
        if any((b, i) == want for _, b, i in play.testdata_pregens):
            return _play_result(play, True, "PASSED", [], source_file, play.testdata_pregens)

    entered = any((p.stage or "").lower() == stage or p.verb.lower() == stage for p in plays)
    result = _play_result(plays[0], False, "SEED_NOT_ECHOED", [
        f"Feature seed {want} not found in any <TestData> echo of the triggering play; the "
        f"{record['stage']} stage was {'played' if entered else 'NOT played'} — the seed itself "
        "could not be confirmed"], source_file, [])
    result["actualStage"] = record["stage"] if entered else (plays[0].stage or "N/A")
    return result


def _generate_html_report(
    records: list[dict],
    results: list[dict],
    game_url: str,
    testdata_file: str,
    output_path: Path,
    multi_file: bool = False,
    file_accounts: dict[str, str] | None = None,
) -> str:
    """Generate an HTML verification report with data comparison + screenshots.

    `file_accounts` (file name -> loginName it was played as) is shown on each file's header when
    the files were spread over several accounts."""
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    pass_rate = (passed / total * 100) if total > 0 else 0

    status_color = "#10b981" if failed == 0 else ("#f59e0b" if pass_rate >= 80 else "#ef4444")
    status_text = "ALL PASSED" if failed == 0 else f"{passed}/{total} PASSED"

    # Build per-file summary if multi-file
    file_summaries: dict[str, dict] = {}
    if multi_file:
        for rec, res in zip(records, results):
            sf = res.get("source_file", "unknown")
            if sf not in file_summaries:
                file_summaries[sf] = {"total": 0, "passed": 0, "failed": 0}
            file_summaries[sf]["total"] += 1
            if res["passed"]:
                file_summaries[sf]["passed"] += 1
            else:
                file_summaries[sf]["failed"] += 1

    # Build case rows
    case_rows = ""
    current_file = None
    for i, (rec, res) in enumerate(zip(records, results)):
        # File separator header for multi-file mode
        src_file = res.get("source_file", "")
        if multi_file and src_file != current_file:
            current_file = src_file
            fs = file_summaries.get(src_file, {})
            account = (file_accounts or {}).get(src_file)
            account_html = f" &nbsp;→&nbsp; login {account}" if account else ""
            case_rows += f"""
        <div class="file-separator">
            <span class="file-separator-title">📄 {src_file}{account_html}</span>
            <span class="file-separator-stats">{fs.get('passed', 0)}/{fs.get('total', 0)} passed</span>
        </div>"""

        badge_cls = "badge-pass" if res["passed"] else "badge-fail"
        badge_text = "PASS" if res["passed"] else "FAIL"
        issues_html = ""
        if res["issues"]:
            issues_html = '<div class="issues">' + "".join(
                f'<div class="issue-item">⚠ {iss}</div>' for iss in res["issues"]
            ) + "</div>"

        screenshot_html = ""
        if res.get("screenshot_b64"):
            screenshot_html = (
                f'<div class="screenshot-section">'
                f'<div class="screenshot-label">Game Screenshot</div>'
                f'<img src="data:image/png;base64,{res["screenshot_b64"]}" class="screenshot-img" />'
                f"</div>"
            )

        case_rows += f"""
        <div class="case-card {'case-pass' if res['passed'] else 'case-fail'}">
            <div class="case-header">
                <span class="case-title">Spin #{rec['spinIndex']}: {rec['stage']}</span>
                <span class="badge {badge_cls}">{badge_text}</span>
            </div>
            <div class="case-details">
                <div class="detail-row">
                    <span class="detail-label">Expected Seed</span>
                    <span class="detail-value">batch={rec['batch']}, index={rec['index']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Actual Seed</span>
                    <span class="detail-value">batch={res['actualBatch']}, index={res['actualIndex']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Stage</span>
                    <span class="detail-value">{res['actualStage']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Win Amount</span>
                    <span class="detail-value">{res['actualWin']}</span>
                </div>
                {''.join(f'<div class="detail-row"><span class="detail-label">Feature Seed ({p["path"]})</span><span class="detail-value">batch={p["batch"]}, index={p["index"]}</span></div>' for p in rec.get("pregens", []) if p["path"] != "Spin")}
            </div>
            {issues_html}
            {screenshot_html}
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TestData Verification Report</title>
<style>
    :root {{
        --bg: #0f172a; --surface: #1e293b; --border: #334155;
        --text: #f1f5f9; --text-muted: #94a3b8;
        --green: #10b981; --red: #ef4444; --amber: #f59e0b; --cyan: #06b6d4;
    }}
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--bg); color: var(--text); padding: 2rem;
    }}
    .container {{ max-width: 960px; margin: 0 auto; }}
    header {{
        text-align: center; margin-bottom: 2rem;
        padding-bottom: 1.5rem; border-bottom: 1px solid var(--border);
    }}
    header h1 {{ font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }}
    header .meta {{ font-size: 0.8rem; color: var(--text-muted); }}
    .summary {{
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem;
    }}
    .summary-card {{
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.2rem; text-align: center;
    }}
    .summary-card .label {{ font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }}
    .summary-card .value {{ font-size: 1.8rem; font-weight: 700; margin-top: 0.3rem; }}
    .case-card {{
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.2rem; margin-bottom: 1rem;
    }}
    .case-pass {{ border-left: 4px solid var(--green); }}
    .case-fail {{ border-left: 4px solid var(--red); }}
    .case-header {{
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 0.8rem;
    }}
    .case-title {{ font-weight: 600; font-size: 0.95rem; }}
    .badge {{
        font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem;
        border-radius: 6px; text-transform: uppercase;
    }}
    .badge-pass {{ background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }}
    .badge-fail {{ background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }}
    .case-details {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }}
    .detail-row {{ display: flex; justify-content: space-between; padding: 0.3rem 0; }}
    .detail-label {{ font-size: 0.75rem; color: var(--text-muted); }}
    .detail-value {{ font-size: 0.8rem; font-family: monospace; }}
    .issues {{ margin-top: 0.8rem; }}
    .issue-item {{
        font-size: 0.75rem; color: var(--amber);
        padding: 0.3rem 0.5rem; background: rgba(245,158,11,0.1);
        border-radius: 6px; margin-bottom: 0.3rem;
    }}
    .screenshot-section {{ margin-top: 0.8rem; }}
    .screenshot-label {{ font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.3rem; }}
    .screenshot-img {{
        max-width: 100%; border-radius: 8px; border: 1px solid var(--border);
        cursor: pointer; transition: transform 0.2s;
    }}
    .screenshot-img:hover {{ transform: scale(1.02); }}
    .file-separator {{
        background: linear-gradient(90deg, rgba(6,182,212,0.1), transparent);
        border: 1px solid rgba(6,182,212,0.3); border-radius: 10px;
        padding: 0.8rem 1.2rem; margin: 1.5rem 0 0.8rem;
        display: flex; justify-content: space-between; align-items: center;
    }}
    .file-separator-title {{ font-weight: 700; font-size: 0.9rem; color: var(--cyan); }}
    .file-separator-stats {{ font-size: 0.8rem; color: var(--text-muted); font-family: monospace; }}
    .footer {{
        text-align: center; margin-top: 2rem; padding-top: 1rem;
        border-top: 1px solid var(--border); font-size: 0.7rem; color: var(--text-muted);
    }}
</style>
</head>
<body>
<div class="container">
    <header>
        <h1>TestData Verification Report</h1>
        <div class="meta">
            <div>Game: {game_url[:80]}...</div>
            <div>TestData: {testdata_file} &nbsp;|&nbsp; Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
        </div>
    </header>

    <div class="summary">
        <div class="summary-card">
            <div class="label">Status</div>
            <div class="value" style="color:{status_color}">{status_text}</div>
        </div>
        <div class="summary-card">
            <div class="label">Total Spins</div>
            <div class="value">{total}</div>
        </div>
        <div class="summary-card">
            <div class="label" style="color:var(--green)">Passed</div>
            <div class="value" style="color:var(--green)">{passed}</div>
        </div>
        <div class="summary-card">
            <div class="label" style="color:var(--red)">Failed</div>
            <div class="value" style="color:var(--red)">{failed}</div>
        </div>
    </div>

    <h2 style="font-size:1.1rem;margin-bottom:1rem;">Spin Validation Details</h2>
    {case_rows}

    <div class="footer">
        Slot Game Testing Harness &mdash; TestData Verification Report
    </div>
</div>
</body>
</html>"""

    output_path.write_text(html, encoding="utf-8")
    return str(output_path)

