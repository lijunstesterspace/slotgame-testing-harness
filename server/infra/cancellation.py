from __future__ import annotations
from typing import Callable

"""Lightweight cancellation registry.

A tool that runs long, blocking, cancellable work (the browser-driven tools'
Selenium sessions) registers a zero-arg callback for its execution_id right after acquiring whatever
resource needs tearing down (e.g. a WebDriver). The executions API can then call request_cancel()
to trigger that teardown from the main event loop, without the tool itself needing to know
anything about HTTP routes or the execution queue.
"""

_cancel_fns: dict[str, Callable[[], None]] = {}


def register(execution_id: str, cancel_fn: Callable[[], None]) -> None:
    _cancel_fns[execution_id] = cancel_fn


def unregister(execution_id: str) -> None:
    _cancel_fns.pop(execution_id, None)


def request_cancel(execution_id: str) -> bool:
    """Returns True if a cancellable task was found and its teardown was invoked."""
    fn = _cancel_fns.get(execution_id)
    if fn is None:
        return False
    try:
        fn()
    except Exception:
        pass
    return True
