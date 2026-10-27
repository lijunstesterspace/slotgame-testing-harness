"""Plugin: portugal_plugin_fetcher — automatically fetches Portugal Plugin outcome strings from the game environment

Flow (all in one Chrome, driven by Selenium):
  1. Log into the game — either a Titan Harness launcher URL (form filled like
     testdata_verifier_harness) or a direct /launch/ URL that already carries
     username/password/moduleId/clientId in its query string (what the harness redirects to).
  2. Spin `spin_count` times (reusing the harness tool's live-confirmed jftwTools helpers) and
     record each captured game response's financials.
  3. Open the in-game "•••" menu → "Game History", which opens PlayCheck already logged in.
  4. Inside that PlayCheck tab: ListSessions → pick the login session → ListGames/{session} →
     pick the transaction(s) → call GameReport/GetReportAsync and read its `Data` field.

Why everything in step 4 runs *inside* the PlayCheck tab via the page's own JS: PlayCheck is a
small SPA (see /PlaycheckV3/Scripts/SPA) whose login is NOT a cookie. On load it redeems a
one-time token into an ASP.NET session id held only in a JS closure (getSessionId/setSessionId),
sends it on every request as the `X-SPA-ASPNET-SessionId` header, and may rotate it via the same
response header. A driver.get() / plain fetch to any PlayCheck URL therefore lands on the
unauthenticated error page — navigation must go through spaLoad() and the report request must
carry getSessionId() and store any rotated id back with setSessionId().

UNVERIFIED (written from screenshots, not a live DOM — the game login needs the QA account):
  - how the "•••" menu and "Game History" item are exposed (DOM vs canvas vs jftwTools
    component). _open_game_history() tries several strategies and reports which one worked
    plus the jftwTools component ids it saw, so the first live run tells us which to keep;
  - the PlayCheck tables are read by cell shape (session id / dates / money), not by fixed
    column selectors, for the same reason.
If raw_text is given the tool skips the browser entirely and passes it through (paste mode).
"""
from __future__ import annotations
import base64
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse, urlencode

from server.tools.base import (
    ToolPlugin, ToolInfo, ToolInputSchema, ToolParameter, ToolResult, HarnessContext,
)
from server.tools.impl.testdata_verify_common import (
    HARNESS_DEFAULT_PASSWORD,
    _INTERCEPTOR_JS, _force_kill_driver, _click_spin_by_selector,
    _fill_labeled_field, _click_button_by_text,
    _wait_for_spin_ready, _apply_time_scale, _click_spin_via_jftw,
    _enter_game_context,
)
from server.infra.logger import log

SPIN_BLOCK = re.compile(r"\d+\s*:")
MONEY = re.compile(r"-?[\d.,]*\d")

# ── JS run inside the game page ──────────────────────────────────────
_HOOK_WINDOW_OPEN_JS = """
if (!window.__ppOpenHooked) {
  window.__ppOpened = [];
  const orig = window.open;
  window.open = function (u, ...rest) { window.__ppOpened.push(String(u)); return orig.apply(this, [u, ...rest]); };
  window.__ppOpenHooked = true;
}
"""

_CLICK_TEXT_JS = """
const wanted = arguments[0].map(t => t.toLowerCase());
const els = Array.from(document.querySelectorAll('body *')).filter(el => {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().toLowerCase();
  const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
  return wanted.some(w => own === w || label.includes(w));
});
const el = els[0];
if (!el) return false;
const r = el.getBoundingClientRect();
const x = r.left + r.width / 2, y = r.top + r.height / 2;
for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {
  el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, clientX: x, clientY: y}));
}
return true;
"""

_JFTW_IDS_JS = """
try {
  const ids = window.jftwTools.common.getComponentsId();
  const out = [];
  const walk = v => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(ids);
  return out;
} catch (e) { return []; }
"""

# ── JS run inside the PlayCheck tab ──────────────────────────────────
_PC_READY_JS = """
return typeof getSessionId === 'function' && !!getSessionId() && typeof spaLoad === 'function'
  && !(document.getElementById('spa-loader') && getComputedStyle(document.getElementById('spa-loader')).display !== 'none'
       && document.getElementById('spa-loader').offsetParent !== null);
"""

# PlayCheck renders parts of its pages into shadow roots (template[shadowrootmode], see the
# comment in its spa.js) — every lookup below walks open shadow roots too.
_PC_DEEP_JS = """
const deepAll = (root, sel, out = []) => {
  root.querySelectorAll(sel).forEach(e => out.push(e));
  root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) deepAll(e.shadowRoot, sel, out); });
  return out;
};
"""

_PC_ROWS_JS = _PC_DEEP_JS + """
const text = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
const rows = deepAll(document, 'tbody tr').map(tr => Array.from(tr.querySelectorAll('td')).map(text));
const showingEl = deepAll(document, 'div,span,p,td').find(el => /^Showing\\s+\\d+\\s*-\\s*\\d+\\s+of\\s+\\d+$/i.test(text(el)));
return {path: location.pathname, rows: rows.filter(r => r.length >= 3), showing: showingEl ? text(showingEl) : ''};
"""

_PC_MAX_PAGE_SIZE_JS = _PC_DEEP_JS + """
const sel = deepAll(document, 'select')
  .find(s => Array.from(s.options).every(o => /^\\d+$/.test(o.value || o.text)));
if (!sel) return false;
const best = Array.from(sel.options).reduce((a, o) => (+o.value || +o.text) > (+a.value || +a.text) ? o : a);
if (sel.value === best.value) return false;
sel.value = best.value;
if (window.jQuery) jQuery(sel).trigger('change'); else sel.dispatchEvent(new Event('change', {bubbles: true}));
return true;
"""

_PC_SPA_LOAD_JS = "spaLoad(arguments[0], 'GET', null, HistoryOperation.PUSH); return true;"

_PC_GET_REPORT_JS = """
const url = arguments[0], done = arguments[arguments.length - 1];
jQuery.ajax({url: url, type: 'GET', headers: {'X-SPA-ASPNET-SessionId': getSessionId()}})
  .done((data, status, xhr) => {
    const sid = xhr.getResponseHeader('X-SPA-ASPNET-SessionId');
    if (sid) setSessionId(sid);
    done({ok: true, data: typeof data === 'string' ? data : JSON.stringify(data)});
  })
  .fail(xhr => done({ok: false, status: xhr.status, text: (xhr.responseText || '').slice(0, 300)}));
"""

DATE_RE = re.compile(r"\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}(:\d{2})?\s*[AP]M", re.I)


def _money(text: str) -> float | None:
    m = MONEY.search(text.replace(",", ""))
    try:
        return float(m.group(0)) if m else None
    except ValueError:
        return None


def _parse_sessions(rows: list[list[str]]) -> list[dict]:
    """Session rows: [View, <session id>, <started>, <ended or ''>] — located by cell shape."""
    out = []
    for r in rows:
        sid = next((c for c in r if re.fullmatch(r"\d+", c)), None)
        if not sid:
            continue
        dates = [c for c in r if DATE_RE.search(c)]
        out.append({"session_id": sid, "started_at": dates[0] if dates else "",
                    "ended_at": dates[1] if len(dates) > 1 else ""})
    return out


def _parse_games(rows: list[list[str]]) -> list[dict]:
    """Game rows: [icons/View, <trans>, <time>, <description>, <wagered>, <payout>]."""
    out = []
    for r in rows:
        trans = next((c for c in r if re.fullmatch(r"\d+", c)), None)
        if not trans:
            continue
        money = [c for c in r if re.fullmatch(r"[^\d\s-]{0,3}\s?-?[\d,]+\.\d{2}", c)]
        time_cell = next((c for c in r if DATE_RE.search(c)), "")
        rest = [c for c in r if c not in (trans, time_cell, *money) and c.lower() != "view" and c]
        out.append({
            "trans_number": int(trans), "time": time_cell,
            "description": max(rest, key=len) if rest else "",
            "wagered_text": money[0] if money else "", "payout_text": money[1] if len(money) > 1 else "",
            "wagered": _money(money[0]) if money else None,
            "payout": _money(money[1]) if len(money) > 1 else None,
        })
    return out


class PortugalPluginFetcherTool(ToolPlugin):
    @property
    def info(self) -> ToolInfo:
        return ToolInfo(
            name="portugal_plugin_fetcher",
            description=(
                "Logs into the game (Titan Harness URL or direct /launch/ URL), optionally spins, opens "
                "••• → Game History, locates the PlayCheck login session and transaction, and returns the "
                "GetReportAsync `Data` outcome string. Passes raw_text through unchanged when it is given."
            ),
            inputSchema=ToolInputSchema(properties=[
                ToolParameter(name="raw_text", type="string",
                              description="Already-known outcome string; when non-empty the browser is skipped"),
                ToolParameter(name="game_url", type="string",
                              description="Titan Harness launcher URL (…/harness/<game>) or direct launch URL (…/launch/mgs/<game>?…)"),
                ToolParameter(name="login_name", type="string", description="QA account; default from game_url query 'username'"),
                ToolParameter(name="harness_password", type="string", description="Default: shared QA harness password"),
                ToolParameter(name="module_id", type="string", description="Default from game_url query 'moduleId'"),
                ToolParameter(name="product_id", type="string", description="Default from game_url query 'productId'"),
                ToolParameter(name="client_id", type="string", description="Default from game_url query 'clientId'"),
                ToolParameter(name="brand", type="string", description="Default from game_url query 'brand', else IslandParadise"),
                ToolParameter(name="spin_count", type="number", default=1,
                              description="Spins to play before fetching; 0 = fetch an existing transaction"),
                ToolParameter(name="session_id", type="string", description="PlayCheck login session; default: auto-detect"),
                ToolParameter(name="trans_number", type="number", description="Transaction number; default: the last one(s)"),
                ToolParameter(name="load_timeout_sec", type="number", default=60,
                              description="Per-phase wait (game load, PlayCheck pages)"),
            ]),
            permissions=["browser:automation", "network:game_env"],
            timeout_seconds=900,
            version="1.0.0",
        )

    async def _run_impl(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        raw_text = str(params.get("raw_text") or "").strip()
        if raw_text:
            if not SPIN_BLOCK.search(raw_text):
                return ToolResult(success=False, error="raw_text_has_no_spin_blocks: expected 'N:...'")
            return ToolResult(success=True, content={"source": "pasted", "raw_text": raw_text, "outcomes": []})
        if not params.get("game_url"):
            return ToolResult(success=False, error="missing_input: paste the outcome string, or give game_url to fetch it")
        import asyncio
        return await asyncio.to_thread(self._fetch_sync, params, ctx)

    # ── browser flow ────────────────────────────────────────────────
    def _fetch_sync(self, params: dict[str, Any], ctx: HarnessContext) -> ToolResult:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from server.infra import cancellation

        game_url: str = params["game_url"].strip()
        q = {k.lower(): v[0] for k, v in parse_qs(urlparse(game_url).query).items()}
        login_name = str(params.get("login_name") or q.get("username") or "")
        module_id = str(params.get("module_id") or q.get("moduleid") or "")
        client_id = str(params.get("client_id") or q.get("clientid") or "")
        product_id = str(params.get("product_id") or q.get("productid") or "")
        brand = str(params.get("brand") or q.get("brand") or "IslandParadise")
        password = str(params.get("harness_password") or q.get("password") or HARNESS_DEFAULT_PASSWORD)
        spin_count = max(0, int(params.get("spin_count") or 0))
        timeout = int(params.get("load_timeout_sec") or 60)
        is_harness_form = "/harness/" in urlparse(game_url).path
        if not module_id or not client_id:
            return ToolResult(success=False, error="missing_module_or_client_id: add moduleId/clientId to game_url or pass them")
        if is_harness_form and not (login_name and product_id):
            return ToolResult(success=False, error="missing_harness_fields: harness URL needs login_name and product_id")

        work_dir = Path(ctx.work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)
        diag: dict[str, Any] = {"launch": "harness_form" if is_harness_form else "direct_url"}
        artifacts: list[str] = []

        opts = Options()
        for a in ("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--ignore-certificate-errors"):
            opts.add_argument(a)
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        driver = webdriver.Chrome(options=opts)
        cancellation.register(ctx.execution_id, lambda: _force_kill_driver(driver))
        driver.maximize_window()
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _INTERCEPTOR_JS})

        def fail(error: str) -> ToolResult:
            try:
                p = work_dir / f"fetch_fail_{int(time.time())}.png"
                p.write_bytes(driver.get_screenshot_as_png())
                artifacts.append(str(p))
            except Exception:
                pass
            log.warning("portugal_fetcher.fail", error=error, diag=diag)
            return ToolResult(success=False, error=error, content={"diagnostics": diag}, artifacts=artifacts)

        try:
            # 1. login + launch
            launched_at = time.time()
            if is_harness_form:
                driver.get(game_url)
                from selenium.webdriver.support.ui import WebDriverWait
                from selenium.webdriver.support import expected_conditions as EC
                from selenium.webdriver.common.by import By
                try:
                    WebDriverWait(driver, timeout).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input")))
                except Exception:
                    return fail(f"harness_page_did_not_load:{game_url}")
                for cands, val in [(["username"], login_name), (["password"], password),
                                   (["productid", "product_id", "productId"], product_id),
                                   (["moduleid", "module_id", "moduleId"], module_id),
                                   (["clientid", "client_id", "clientId"], client_id), (["brand"], brand)]:
                    if not _fill_labeled_field(driver, cands, val):
                        return fail(f"harness_form_field_not_found:{cands[0]}")
                prior = set(driver.window_handles)
                if not _click_button_by_text(driver, "LAUNCH GAME", timeout=timeout):
                    return fail("harness_launch_game_button_not_found")
                if not self._switch_to_new_window(driver, prior, timeout):
                    return fail("game_window_not_found_after_launch")
            else:
                driver.get(game_url)
            game_context = _enter_game_context(driver, timeout_sec=timeout)
            diag["game_context"] = game_context
            log.info("portugal_fetcher.launched", module_id=module_id, login_name=login_name,
                     game_context=game_context)
            if not _wait_for_spin_ready(driver, timeout_sec=max(30, timeout // 2)):
                log.warning("portugal_fetcher.spin_not_ready_after_launch")
            _apply_time_scale(driver)
            driver.execute_script("window.__gvResponses = []; window.__gvSpinCount = 0;")

            # 2. spins
            game_results: list[dict] = []
            for i in range(spin_count):
                _wait_for_spin_ready(driver, timeout_sec=30)
                before = driver.execute_script("return (window.__gvResponses || []).length;")
                if not _click_spin_via_jftw(driver):
                    _click_spin_by_selector(driver)
                resp = None
                for _ in range(60):
                    n = driver.execute_script("return (window.__gvResponses || []).length;")
                    if n > before:
                        resp = driver.execute_script(f"return window.__gvResponses[{n - 1}];")
                        break
                    time.sleep(0.5)
                fin = ((resp or {}).get("gameResponse") or {}).get("financials") or {}
                game_results.append({"spin": i + 1, "captured": resp is not None,
                                     "game_win": fin.get("win"), "game_wager": fin.get("wager")})
            if spin_count:
                # let a triggered feature (free spins / bonus) play out so PlayCheck logs the whole round
                _wait_for_spin_ready(driver, timeout_sec=180)
                time.sleep(2)
            diag["spins"] = game_results

            # 3. Game History → PlayCheck tab. The ••• menu belongs to the launch page's own
            # chrome, so look for it from the top document even if the game itself is in an iframe.
            if game_context.startswith("iframe"):
                driver.switch_to.default_content()
            if not self._open_game_history(driver, timeout, diag):
                return fail("game_history_not_opened: see diagnostics.menu_attempts / jftw_ids")
            deadline = time.time() + timeout
            while time.time() < deadline and not self._js(driver, _PC_READY_JS):
                time.sleep(0.5)
            if not self._js(driver, _PC_READY_JS):
                return fail("playcheck_session_not_ready: page did not redeem its session id")
            diag["playcheck_url"] = driver.current_url
            pc_origin = f"{urlparse(driver.current_url).scheme}://{urlparse(driver.current_url).netloc}"

            outcomes, err = self._collect_from_playcheck(
                driver, pc_origin, module_id, client_id, spin_count, game_results, params, timeout, diag)
            if err:
                return fail(err)

            last = outcomes[-1]
            return ToolResult(success=True, content={
                "source": "playcheck", "raw_text": last["data"], "outcomes": outcomes,
                "module_id": module_id, "client_id": client_id, "login_name": login_name,
                "session_id": last["session_id"], "trans_number": last["trans_number"],
                "expected_wager": last["wagered"], "expected_payout": last["payout"],
                "game_win": last["game_win"], "diagnostics": diag,
            }, artifacts=artifacts)
        finally:
            try:
                driver.quit()
            except Exception:
                pass

    def _collect_from_playcheck(self, driver, pc_origin: str, module_id: str, client_id: str,
                                spin_count: int, game_results: list[dict], params: dict[str, Any],
                                timeout: int, diag: dict) -> tuple[list[dict] | None, str]:
        """Steps 4a-4c, run inside an already-authenticated PlayCheck tab. Returns (outcomes, error)."""
        # 4a. login session
        session_id = str(params.get("session_id") or "")
        sessions: list[dict] = []
        if not session_id:
            sessions = _parse_sessions(self._load_rows(driver, "/PlaycheckV3/Home/ListSessions", "ListSessions", timeout)["rows"])
            diag["sessions"] = sessions
            if not sessions:
                return None, "no_playcheck_sessions_listed_for_today"
        candidates = [session_id] if session_id else [
            s["session_id"] for s in sorted(sessions, key=lambda s: (s["ended_at"] == "", int(s["session_id"])), reverse=True)
        ]

        # 4b. transactions — first candidate session that has enough of them
        games: list[dict] = []
        chosen = ""
        for sid in candidates:
            page = self._load_rows(driver, f"/PlaycheckV3/Home/ListGames/{sid}", f"ListGames/{sid}", timeout)
            if self._js(driver, _PC_MAX_PAGE_SIZE_JS):
                time.sleep(1)
                page = self._load_rows(driver, None, f"ListGames/{sid}", timeout)
            games = _parse_games(page["rows"])
            if games and len(games) >= max(1, spin_count):
                chosen = sid
                diag["games_showing"] = page["showing"]
                break
        if not chosen:
            return None, f"no_session_with_{max(1, spin_count)}_transactions:checked={candidates}"
        session_id = chosen
        games.sort(key=lambda g: g["trans_number"])
        if params.get("trans_number"):
            picked = [g for g in games if g["trans_number"] == int(params["trans_number"])]
            if not picked:
                return None, f"trans_number_not_found:{params['trans_number']}"
        else:
            picked = games[-max(1, spin_count):]

        # 4c. GetReportAsync for each picked transaction
        outcomes: list[dict] = []
        for idx, g in enumerate(picked):
            qs = urlencode({"sessionId": session_id, "transNumber": g["trans_number"],
                            "moduleId": module_id, "clientId": client_id})
            url = f"{pc_origin}/PlaycheckV3/GameReport/GetReportAsync?{qs}"
            driver.set_script_timeout(timeout)
            res = driver.execute_async_script(_PC_GET_REPORT_JS, url)
            if not res or not res.get("ok"):
                return None, f"get_report_failed:trans={g['trans_number']}:{res}"
            try:
                body = json.loads(res["data"])
                data = body.get("Data") if isinstance(body, dict) else str(body)
            except (ValueError, TypeError):
                data = res["data"]
            if not data or not SPIN_BLOCK.search(data):
                return None, f"report_has_no_outcome_data:trans={g['trans_number']}"
            game = game_results[len(game_results) - len(picked) + idx] if len(game_results) >= len(picked) else {}
            outcomes.append({**g, "session_id": session_id, "report_url": url, "data": data,
                             "game_win": game.get("game_win"), "game_wager": game.get("game_wager")})
        return outcomes, ""

    # ── helpers ─────────────────────────────────────────────────────
    @staticmethod
    def _js(driver, script: str, *args):
        try:
            return driver.execute_script(script, *args)
        except Exception:
            return None

    @staticmethod
    def _switch_to_new_window(driver, prior: set, timeout: int) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                handles = driver.window_handles
            except Exception:
                return False
            new = [h for h in handles if h not in prior]
            if new:
                driver.switch_to.window(new[-1])
                return True
            time.sleep(0.5)
        return False

    def _open_game_history(self, driver, timeout: int, diag: dict) -> bool:
        """Try, in order: DOM text, DOM menu toggle, jftwTools component, screen coordinates.
        Success = a new window, a captured window.open URL, or a PlayCheck iframe."""
        self._js(driver, _HOOK_WINDOW_OPEN_JS)
        prior = set(driver.window_handles)
        diag["jftw_ids"] = self._js(driver, _JFTW_IDS_JS) or []
        attempts: list[str] = []
        diag["menu_attempts"] = attempts

        def opened() -> bool:
            if self._switch_to_new_window(driver, prior, 4):
                return True
            urls = self._js(driver, "return window.__ppOpened || [];") or []
            if urls:
                driver.switch_to.new_window("tab")
                driver.get(urls[-1])
                return True
            frame = self._js(driver, "return Array.from(document.querySelectorAll('iframe')).findIndex(f => /playcheck/i.test(f.src));")
            if isinstance(frame, int) and frame >= 0:
                driver.switch_to.frame(frame)
                return True
            return False

        def history_click() -> bool:
            return bool(self._js(driver, _CLICK_TEXT_JS, ["Game History", "History", "PlayCheck"]))

        # a) menu already open / item always in DOM
        if history_click():
            attempts.append("dom_text")
            if opened():
                return True
        # b) open the ••• menu in the DOM, then the item
        if self._js(driver, _CLICK_TEXT_JS, ["•••", "...", "⋯", "…", "menu", "more"]):
            attempts.append("dom_menu")
            time.sleep(1)
            if history_click() and opened():
                return True
        # c) jftwTools components
        ids = diag["jftw_ids"]
        for pattern in (r"history|playcheck", r"menu|more|burger|hamburger"):
            for cid in [i for i in ids if re.search(pattern, i, re.I)]:
                attempts.append(f"jftw:{cid}")
                self._js(driver, "window.jftwTools.button.touch(arguments[0]);", cid)
                time.sleep(1)
                if history_click():
                    attempts.append("dom_text_after_jftw")
                if opened():
                    return True
        # d) coordinates from the screenshot (••• top-left, "Game History" second item)
        attempts.append("coordinates")
        for fx, fy in ((0.0125, 0.048), (0.05, 0.11)):
            self._js(driver, "const w=innerWidth,h=innerHeight;"
                             "if (window.jftwTools) jftwTools.common.touch({x: Math.round(w*arguments[0]), y: Math.round(h*arguments[1])});"
                             "else { const el=document.elementFromPoint(w*arguments[0], h*arguments[1]);"
                             "  if (el) ['mousedown','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:w*arguments[0],clientY:h*arguments[1]}))); }",
                     fx, fy)
            time.sleep(1)
        return opened()

    def _load_rows(self, driver, path: str | None, expect_path: str, timeout: int) -> dict:
        """spaLoad `path` (if given) inside the PlayCheck tab and wait until its table has rows."""
        if path:
            self._js(driver, _PC_SPA_LOAD_JS, path)
        deadline = time.time() + timeout
        page = {"path": "", "rows": [], "showing": ""}
        while time.time() < deadline:
            page = self._js(driver, _PC_ROWS_JS) or page
            if expect_path.lower() in (page.get("path") or "").lower() and self._js(driver, _PC_READY_JS):
                if page["rows"] or "of 0" in (page.get("showing") or ""):
                    return page
            time.sleep(0.5)
        return page
