"""Manual smoke run: launch a game, finish any restored play, spin N plays, dump everything.

    python -m server.game_session.smoke --url "http://localhost:5241/launch/mgs/<game>?..." --plays 2 --out out/smoke

Every spin is a real transaction on the game's backend environment — use a test account.
Writes <out>/plays.json (states + raw responses per play), screenshots and a Playwright trace
(open with `playwright show-trace <out>/trace.zip`). The plays.json files double as fixtures for tests.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from server.game_session import LaunchSpec, SessionConfig, open_session
from server.game_session.env import resolve_env


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--plays", type=int, default=1)
    ap.add_argument("--out", default="out/smoke")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--time-scale", type=int, default=400)
    args = ap.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "screenshots"

    def log(event, **kw):
        print(f"{time.strftime('%H:%M:%S')} {event} {kw}", flush=True)

    plays = []
    with open_session(LaunchSpec(url=args.url), headless=not args.headed, trace_path=out / "trace.zip",
                      config=SessionConfig(time_scale=args.time_scale), log=log) as gs:
        restored = gs.finish_restored_play(shots)
        if restored:
            plays.append({"label": "restored", **restored.to_json()})
            log("restored_play", responses=len(restored.responses), error=restored.error and restored.error.code)
        for i in range(args.plays):
            r = gs.play(f"play{i + 1}", shots)
            plays.append({"label": f"play{i + 1}", **r.to_json()})
            for c in r.responses:
                log("  response", seq=c.seq, **(c.play.summary() if c.play else {"parseError": c.parse_error}))
            log("  states", path=" > ".join(dict.fromkeys(r.state_names)))
            if r.error:
                log("  ERROR", code=r.error.code, message=r.error.message)
                break
        env = resolve_env(None, args.url, gs.capture.platform_hosts)
    (out / "plays.json").write_text(json.dumps({"url": args.url.split("?")[0], "env": env, "plays": plays},
                                               indent=1, ensure_ascii=False), encoding="utf-8")
    log("done", out=str(out), env=env)
    return 0 if all(not p.get("error") for p in plays) else 1


if __name__ == "__main__":
    sys.exit(main())
