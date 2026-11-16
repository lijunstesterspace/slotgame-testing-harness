"""PlayCheck access layer (Playwright).

PlayCheck is a small SPA served from a per-env origin like
``https://playcheck-app1-gtp601.installprogram.eu``. Its authentication is the
Axiom login cookie, so any browser context that has logged into the game can
open PlayCheck directly — no separate credentials and no in-game Game History
menu needed.

Navigation inside PlayCheck must go through ``spaLoad()`` (a plain
``driver.get()`` / fetch lands on the unauthenticated error page because the
SPA session id is held only in a JS closure). This module wraps the SPA
navigation plus the page reads the verifier needs:

  - list login sessions      (ListSessions)
  - list transactions        (ListGames/{sessionId})
  - read one transaction     (GameDetail?sessionId=&transactionId=)
    * financial summary (Total Wagered / Total Payout / Closing Balance)
    * every Spin block's Reel Positions (the <img> src per cell)

All JS here walks open shadow roots too — PlayCheck renders parts of its pages
into shadow roots (template[shadowrootmode]).

Ported from portugal_plugin_fetcher_tool.py (which used Selenium); the table
parsing JS and the session/game row shape are reused byte-for-byte so a fix in
either place stays consistent.
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlencode

from server.infra.logger import log

MONEY = re.compile(r"-?[\d.,]*\d")
DATE_RE = re.compile(r"\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}(:\d{2})?\s*[AP]M", re.I)

# ── JS run inside the PlayCheck page ─────────────────────────────────
#
# Every script is handed to Playwright's page.evaluate, which accepts a function or a single
# expression — never a bare statement list with `return` (that raises "Illegal return statement").
# Each one is therefore wrapped in an arrow function; the shadow-DOM helper is a shared prefix.


def _js_fn(body: str) -> str:
    """Wrap a statement body in an arrow function so page.evaluate runs it as a function."""
    return "() => {\n" + body + "\n}"


_PC_READY_JS = _js_fn("""
return typeof getSessionId === 'function' && !!getSessionId() && typeof spaLoad === 'function'
  && !(document.getElementById('spa-loader') && getComputedStyle(document.getElementById('spa-loader')).display !== 'none'
       && document.getElementById('spa-loader').offsetParent !== null);
""")

# Walk open shadow roots as well as the light DOM.
_PC_DEEP_JS = """
const deepAll = (root, sel, out = []) => {
  root.querySelectorAll(sel).forEach(e => out.push(e));
  root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) deepAll(e.shadowRoot, sel, out); });
  return out;
};
"""

_PC_ROWS_JS = _js_fn(_PC_DEEP_JS + """
const text = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
const rows = deepAll(document, 'tbody tr').map(tr => Array.from(tr.querySelectorAll('td')).map(text));
const showingEl = deepAll(document, 'div,span,p,td').find(el => /^Showing\\s+\\d+\\s*-\\s*\\d+\\s+of\\s+\\d+$/i.test(text(el)));
return {path: location.pathname, rows: rows.filter(r => r.length >= 3), showing: showingEl ? text(showingEl) : ''};
""")

_PC_MAX_PAGE_SIZE_JS = _js_fn(_PC_DEEP_JS + """
const sel = deepAll(document, 'select')
  .find(s => Array.from(s.options).every(o => /^\\d+$/.test(o.value || o.text)));
if (!sel) return false;
const best = Array.from(sel.options).reduce((a, o) => (+o.value || +o.text) > (+a.value || +a.text) ? o : a);
if (sel.value === best.value) return false;
sel.value = best.value;
if (window.jQuery) jQuery(sel).trigger('change'); else sel.dispatchEvent(new Event('change', {bubbles: true}));
return true;
""")

# Takes the route as its argument (page.evaluate passes its 2nd arg in as the parameter).
_PC_SPA_LOAD_JS = "(path) => { spaLoad(path, 'GET', null, HistoryOperation.PUSH); return true; }"

# GameDetail: extract the financial summary + every Spin block's reel images.
# Returns {financials: {wagered, payout, closingBalance}, spins: [{title, reel_images: [[src,...]]}]}.
# reel_images is row-major: one inner list per visible reel row, one src per column.
_PC_GAME_DETAIL_JS = _js_fn(_PC_DEEP_JS + """
const text = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
const moneyOf = s => { const m = (s || '').replace(/,/g, '').match(/-?\\d+(?:\\.\\d+)?/); return m ? parseFloat(m[0]) : null; };

// Financial Summary — a table whose rows have a label cell and a value cell.
let wagered = null, payout = null, closingBalance = null;
for (const tbl of deepAll(document, 'table')) {
  for (const tr of tbl.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('td,th')).map(text);
    if (cells.length < 2) continue;
    const label = cells[0].toLowerCase();
    const val = moneyOf(cells[cells.length - 1]);
    if (/total\\s*wagered/.test(label)) wagered = val;
    else if (/total\\s*payout/.test(label)) payout = val;
    else if (/closing\\s*balance/.test(label)) closingBalance = val;
  }
}

// Spin blocks: each "Spin: N" heading starts a block; its "Reel Positions" table holds the
// reel images (one <img> per cell). Only tables *after* a heading belong to its block.
const spins = [];
const tables = Array.from(deepAll(document, 'table'));
for (const h of deepAll(document, 'h1,h2,h3,h4,h5,h6,div,span,p')
     .filter(el => /^spin\\s*:?\\s*\\d+/i.test(text(el)))) {
  const after = tables.filter(t => h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  const table = after.find(t => /reel\\s*positions/i.test(
      text(t.querySelector('caption') || t.previousElementSibling || ''))) || after[0] || null;
  const reel_images = [];
  if (table) {
    for (const tr of table.querySelectorAll('tr')) {
      const imgs = Array.from(tr.querySelectorAll('img')).map(img => img.src || img.getAttribute('src') || '');
      if (imgs.length) reel_images.push(imgs);
    }
  }
  spins.push({title: text(h), reel_images});
}
return {financials: {wagered, payout, closingBalance}, spins};
""")


def _money(text: str) -> float | None:
    m = MONEY.search((text or "").replace(",", ""))
    try:
        return float(m.group(0)) if m else None
    except ValueError:
        return None


def parse_sessions(rows: list[list[str]]) -> list[dict]:
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


def parse_games(rows: list[list[str]]) -> list[dict]:
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


# ── Playwright driver ────────────────────────────────────────────────

class PlayCheckError(Exception):
    pass


class PlayCheckClient:
    """Thin Playwright wrapper around the PlayCheck SPA.

    Constructed with a Playwright ``page`` that is already on an authenticated
    PlayCheck origin (the caller logs into Axiom / the game first, then opens
    PlayCheck in the same context).
    """

    def __init__(self, page: Any, origin: str, timeout: int = 30):
        self.page = page
        self.origin = origin.rstrip("/")
        self.timeout = timeout

    # ── low-level ────────────────────────────────────────────────
    def _js(self, script: str, *args: Any) -> Any:
        try:
            return self.page.evaluate(script, *args)
        except Exception as e:
            log.debug("playcheck js failed: %s", e)
            return None

    def _spa_load(self, path: str) -> None:
        """Navigate inside the SPA via spaLoad() — never page.goto() for routes."""
        self._js(_PC_SPA_LOAD_JS, path)

    def _wait_ready(self, expect_path: str) -> dict:
        deadline = time.time() + self.timeout
        page = {"path": "", "rows": [], "showing": ""}
        while time.time() < deadline:
            page = self._js(_PC_ROWS_JS) or page
            if expect_path.lower() in (page.get("path") or "").lower() and self._js(_PC_READY_JS):
                if page["rows"] or "of 0" in (page.get("showing") or ""):
                    return page
            time.sleep(0.5)
        return page

    def open(self) -> None:
        """Navigate to PlayCheck's ListSessions page in the current context."""
        # First load via goto() so the SPA bootstraps; subsequent navigation
        # inside the app uses _spa_load().
        self.page.goto(f"{self.origin}/PlaycheckV3/Home/ListSessions", wait_until="networkidle")
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self._js(_PC_READY_JS):
                return
            time.sleep(0.5)
        raise PlayCheckError("playcheck_not_ready_timeout")

    # ── high-level reads ──────────────────────────────────────────
    def list_sessions(self) -> list[dict]:
        self._spa_load("/PlaycheckV3/Home/ListSessions")
        page = self._wait_ready("ListSessions")
        return parse_sessions(page["rows"])

    def list_games(self, session_id: str) -> list[dict]:
        path = f"/PlaycheckV3/Home/ListGames/{session_id}"
        self._spa_load(path)
        # Try to bump the page size so all transactions load at once.
        if self._js(_PC_MAX_PAGE_SIZE_JS):
            time.sleep(1)
        page = self._wait_ready(f"ListGames/{session_id}")
        return parse_games(page["rows"])

    def get_game_detail(self, session_id: str, transaction_id: int | str) -> dict:
        """Read one transaction's GameDetail page.

        Returns {financials: {wagered, payout, closingBalance},
                 spins: [{title, reel_images: [[src,...]]}]}.
        """
        qs = urlencode({"sessionId": session_id, "transactionId": transaction_id})
        path = f"/PlaycheckV3/Home/GameDetail?{qs}"
        self._spa_load(path)
        deadline = time.time() + self.timeout
        detail: dict = {"financials": {}, "spins": []}
        while time.time() < deadline:
            if self._js(_PC_READY_JS):
                detail = self._js(_PC_GAME_DETAIL_JS) or detail
                if detail.get("spins") or detail.get("financials"):
                    return detail
            time.sleep(0.5)
        return detail

    def find_transaction(self, trans_number: int) -> tuple[str, dict] | None:
        """Locate a transaction by number across today's sessions.

        Returns (session_id, game_row) or None.
        """
        sessions = self.list_sessions()
        if not sessions:
            return None
        # Most-recent-first: sessions with no end time are still open.
        sessions.sort(key=lambda s: (s["ended_at"] == "", int(s["session_id"])), reverse=True)
        for s in sessions:
            games = self.list_games(s["session_id"])
            for g in games:
                if g["trans_number"] == trans_number:
                    return s["session_id"], g
        return None
