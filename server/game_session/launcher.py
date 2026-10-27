"""Start Chrome and get to a page that is running the game.

Two launch modes:
  - direct: a /launch/mgs/<game>?moduleId=..&username=..&password=.. URL — a local client
    (http://localhost:5241/...) or a remote one. The URL itself logs in.
  - titan:  the QA-only Titan Harness launcher page (…/harness/<game>), a form whose "LAUNCH GAME"
    button opens the game in a new tab. Field strategies are ported from the retired Selenium tool
    (selenium_page_drivers._fill_labeled_field), which was confirmed against the live page.

Chrome must keep rendering while nobody looks at it: a hidden or occluded page stops animating and
the game's state machine stops advancing (seen live: stuck at PostInit until the pane was shown).
Headless avoids that entirely; headed runs get the anti-throttling flags below.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from server.game_session.capture import PlayCapture
from server.game_session.env import is_local_url
from server.game_session.session import LaunchFailed

# One shared value for every QA test account on this platform, not a per-account secret — the
# harness page pre-fills the same value itself. Overridable so a differently-provisioned
# environment does not need a code change.
TITAN_DEFAULT_PASSWORD = os.getenv("HARNESS_TESTER_PASSWORD", "test1234$")

# The LAUNCH GAME control and the form's fields, in the order the harness page wants them, each with
# the attribute strategies to try. The page's DOM is internal/VPN-only and was never inspectable
# ahead of time, so several common Angular-Material-style attributes are tried per field. This is
# the one definition of the form's shape: the Playwright launcher below and portugal_plugin_fetcher's
# Selenium driver both read it, so the two cannot drift on what to fill.
TITAN_LAUNCH_BUTTON = "LAUNCH GAME"

TITAN_FIELDS: list[tuple[str, list[str]]] = [
    ("username", ["username"]),
    ("password", ["password"]),
    ("product_id", ["productid", "product_id", "productId"]),
    ("module_id", ["moduleid", "module_id", "moduleId"]),
    ("client_id", ["clientid", "client_id", "clientId"]),
    ("brand", ["brand"]),
]

CHROME_ARGS = [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--autoplay-policy=no-user-gesture-required",
]


@dataclass
class LaunchSpec:
    url: str
    username: str = ""
    password: str = ""
    module_id: str = ""
    client_id: str = ""
    product_id: str = ""
    brand: str = ""

    @property
    def mode(self) -> str:
        return "titan" if "/harness/" in urlparse(self.url).path else "direct"

    @property
    def is_local(self) -> bool:
        return is_local_url(self.url)

    def identity(self) -> dict[str, str]:
        """The account/module this launch plays as — what a .testdata <Key> must match."""
        if self.mode == "direct":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.url).query).items()}
            return {"username": q.get("username", self.username), "moduleId": q.get("moduleId", self.module_id),
                    "clientId": q.get("clientId", self.client_id)}
        return {"username": self.username, "moduleId": self.module_id, "clientId": self.client_id}


@dataclass
class Browser:
    playwright: Any
    browser: Any
    context: Any
    trace_path: Path | None = None

    def close(self) -> None:
        try:
            if self.trace_path:
                self.context.tracing.stop(path=str(self.trace_path))
        except Exception:
            pass
        for closer in (self.context.close, self.browser.close, self.playwright.stop):
            try:
                closer()
            except Exception:
                pass


def open_browser(headless: bool = True, trace_path: Path | None = None,
                 viewport: tuple[int, int] = (1280, 720)) -> Browser:
    """Installed Chrome (channel="chrome"), so the packaged exe does not need to bundle a browser."""
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    try:
        browser = pw.chromium.launch(channel="chrome", headless=headless, args=CHROME_ARGS)
    except Exception:
        browser = pw.chromium.launch(headless=headless, args=CHROME_ARGS)  # bundled Chromium, if installed
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]},
                                  ignore_https_errors=True)
    if trace_path:
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        context.tracing.start(screenshots=True, snapshots=True)
    return Browser(playwright=pw, browser=browser, context=context, trace_path=trace_path)


def _fill_titan_field(page, candidates: list[str], value: str) -> bool:
    for name in candidates:
        for sel in (f"input[formcontrolname='{name}' i]", f"input[name='{name}' i]",
                    f"input#{name}", f"input[placeholder='{name}' i]"):
            loc = page.locator(sel)
            try:
                if loc.count() and loc.first.is_visible():
                    loc.first.fill(value)
                    return True
            except Exception:
                continue
    return False


def launch(browser: Browser, spec: LaunchSpec, capture: PlayCapture, timeout_sec: float = 90.0):
    """Return the Page running the game. `capture` is attached to the whole browser context before
    anything loads, so the Refresh response of a Titan-opened tab is not missed.

    Every way this can fail is reported as a LaunchFailed, so callers get one error shape instead of
    a mix of Playwright timeouts and RuntimeErrors. Messages name the page, never the full URL — a
    direct launch URL carries the account password in its query string.
    """
    timeout_ms = int(timeout_sec * 1000)
    page_url = spec.url.split("?")[0]
    capture.attach(browser.context)
    if spec.mode == "direct":
        page = browser.context.new_page()
        try:
            page.goto(spec.url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            raise LaunchFailed("GAME_PAGE_NOT_LOADED",
                               f"{page_url} did not load within {timeout_sec:.0f}s: {e}") from e
        return page

    form = browser.context.new_page()
    try:
        form.goto(spec.url, wait_until="domcontentloaded", timeout=timeout_ms)
        form.wait_for_selector("input", timeout=timeout_ms)
    except Exception as e:
        raise LaunchFailed("TITAN_PAGE_NOT_LOADED",
                           f"{page_url} showed no harness form within {timeout_sec:.0f}s: {e}") from e
    values = {"username": spec.username, "password": spec.password or TITAN_DEFAULT_PASSWORD,
              "product_id": spec.product_id, "module_id": spec.module_id,
              "client_id": spec.client_id, "brand": spec.brand or "IslandParadise"}
    missing = [cands[0] for key, cands in TITAN_FIELDS if not _fill_titan_field(form, cands, values[key])]
    if missing:
        raise LaunchFailed("TITAN_FORM_FIELDS_NOT_FOUND",
                           f"{missing} — check the harness page's DOM (open {page_url} manually and "
                           f"look at these fields' formcontrolname/name/id)")
    button = form.get_by_role("button", name=TITAN_LAUNCH_BUTTON)
    if not button.count():
        button = form.get_by_text(TITAN_LAUNCH_BUTTON, exact=False)
    if not button.count():
        raise LaunchFailed("LAUNCH_GAME_BUTTON_NOT_FOUND",
                           f"no {TITAN_LAUNCH_BUTTON} control on {page_url}")
    # CONFIRMED on the Selenium tool's live run: LAUNCH GAME opens the game in a new tab and closes
    # its own. expect_page() catches that tab; if the harness navigates in place instead, keep `form`.
    try:
        with browser.context.expect_page(timeout=timeout_ms) as new_page:
            button.first.click()
        page = new_page.value
    except Exception:
        page = form
    if page is not form:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            raise LaunchFailed("GAME_PAGE_NOT_LOADED",
                               f"the game tab opened by {page_url} did not load within "
                               f"{timeout_sec:.0f}s: {e}") from e
    return page
