"""Record every /casino/play response at the network layer.

Why the network layer: the retired verifier read results from console.log('responseLogger', ...),
which only exists when slot-core's optional ServerLoggerPlugin is loaded, and a page-level fetch/XHR
hook installed after load did not see /casino/play at all on Mega Eagle 2. Playwright's
`page.on("response")` sees every response of every frame regardless of how the game issues it.

Responses are kept in arrival order with a monotonically increasing `seq`, so a round can be
described as "responses seq a..b" and nothing is ever matched by counting.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlparse

from server.game_session import protocol
from server.game_session.protocol import PlayResponse

PLAY_URL = re.compile(r"/casino/play/.*/play(?:$|\?)")
PLATFORM_URL = re.compile(r"/casino/(?:play|user)/")


@dataclass
class Captured:
    seq: int
    t: float                      # time.time() when the response arrived
    url: str
    status: int
    request_body: str | None
    body: str
    play: PlayResponse | None     # None if the body could not be parsed
    parse_error: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "seq": self.seq, "t": self.t, "url": self.url, "status": self.status,
            "requestBody": self.request_body, "body": self.body,
            "play": self.play.summary() if self.play else None, "parseError": self.parse_error,
        }


@dataclass
class PlayCapture:
    """Attach with `attach(context_or_page)`; read `items` / `since(seq)` from the session's own thread."""
    items: list[Captured] = field(default_factory=list)
    platform_hosts: list[str] = field(default_factory=list)
    on_capture: Callable[[Captured], None] | None = None
    _next_seq: int = 0

    def attach(self, target) -> None:
        """A BrowserContext (preferred — covers tabs opened later) or a single Page."""
        target.on("response", self._on_response)

    def _on_response(self, response) -> None:
        url = response.url
        if PLATFORM_URL.search(url):
            host = urlparse(url).hostname or ""
            if host and host not in self.platform_hosts:
                self.platform_hosts.append(host)
        if not PLAY_URL.search(url):
            return
        try:
            body = response.text()
        except Exception as e:  # the page navigated away before the body could be read
            body = ""
            parse_error: str | None = f"body_unavailable:{type(e).__name__}"
        else:
            parse_error = None
        try:
            request_body = response.request.post_data
        except Exception:
            request_body = None
        play = None
        if body:
            try:
                play = protocol.parse(body)
            except Exception as e:
                parse_error = f"{type(e).__name__}:{e}"
        item = Captured(seq=self._next_seq, t=time.time(), url=url.split("?")[0], status=response.status,
                        request_body=request_body, body=body, play=play, parse_error=parse_error)
        self._next_seq += 1
        self.items.append(item)
        if self.on_capture:
            self.on_capture(item)

    @property
    def next_seq(self) -> int:
        return self._next_seq

    def since(self, seq: int) -> list[Captured]:
        return [c for c in self.items if c.seq >= seq]
