"""Work out which platform environment (gtp600, gtp603, ...) a game session talks to.

The env slug decides where testdata is uploaded (axiomcore-app1-<env>.installprogram.eu). It used to be
read off the game URL's host, which breaks for a local client (http://localhost:5241/...): the page is
local but the game server it plays against is remote. Resolution order:
  1. an explicit `env` parameter;
  2. the game URL itself, when it is a <service>-<env>.installprogram.eu host;
  3. the host of the game's own /casino/play or /casino/user traffic, observed at runtime.
Step 3 is only available after the page has loaded, which is after upload would need it — so callers
that upload before launching must pass `env` explicitly for local URLs (see require_env_before_launch).
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

PLATFORM_DOMAIN = "installprogram.eu"
_HOST_ENV = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-(?P<env>[a-z]+\d+)\." + re.escape(PLATFORM_DOMAIN) + r"$", re.I)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


def env_from_host(host: str | None) -> str | None:
    """'api5-rhel1-gtp603.installprogram.eu' -> 'gtp603'; anything else -> None."""
    m = _HOST_ENV.match((host or "").strip().lower())
    return m.group("env").lower() if m else None


def env_from_url(url: str | None) -> str | None:
    return env_from_host(urlparse(url or "").hostname)


def is_local_url(url: str | None) -> bool:
    host = (urlparse(url or "").hostname or "").lower()
    return host in LOCAL_HOSTS or host.endswith(".localhost")


def resolve_env(explicit: str | None, game_url: str | None, observed_hosts: list[str] | None = None) -> str | None:
    if explicit and explicit.strip():
        return explicit.strip().lower()
    env = env_from_url(game_url)
    if env:
        return env
    for host in observed_hosts or []:
        env = env_from_host(host)
        if env:
            return env
    return None


def require_env_before_launch(explicit: str | None, game_url: str) -> str:
    """Env needed before the browser starts (testdata upload). Raises with an actionable message."""
    env = resolve_env(explicit, game_url)
    if not env:
        raise ValueError(
            f"env_required: cannot tell the platform environment from {urlparse(game_url).hostname!r}; "
            f"pass env explicitly (e.g. 'gtp603' — a local client's jft.manifest.json has it as axiomGTP)"
        )
    return env


def axiomcore_host(env: str) -> str:
    return f"axiomcore-app1-{env}.{PLATFORM_DOMAIN}"
