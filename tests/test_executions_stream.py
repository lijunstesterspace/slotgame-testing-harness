"""GET /api/executions/stream/{id}: a run that finished before the client subscribed still ends the
stream with `done`.

A verifier that fails its pre-flight checks returns within milliseconds — sooner than the browser
opens the SSE stream — so its `done` is published to no subscriber. The stream used to replay the
tool calls and then ping forever, leaving the UI waiting out its whole timeout.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from server.infra.storage import StorageAsync
from server.main import app, shared


@pytest.fixture()
def storage(tmp_path, monkeypatch) -> StorageAsync:
    """A throwaway database, so the test never touches server/data/harness.db."""
    store = StorageAsync(tmp_path / "harness.db")
    asyncio.run(store.init_db())
    monkeypatch.setattr(shared, "storage", store)
    return store


def _finished_execution(storage: StorageAsync, status: str) -> str:
    async def make() -> str:
        eid = await storage.new_execution(user_id="local", intent="async_tool:testdata_verifier_local",
                                          workflow_stage=0, llm_provider=None, llm_model=None)
        tc = await storage.new_tool_call(execution_id=eid, tool_name="testdata_verifier_local", params={})
        await storage.complete_tool_call(tc, success=status == "SUCCESS", result_snippet=None, artifacts=[],
                                         execution_ms=3, error_message=None if status == "SUCCESS" else "boom")
        await storage.update_execution_status(eid, status, total_ms=3)
        return eid
    return asyncio.run(make())


@pytest.mark.parametrize("status, success", [("FAILED", False), ("SUCCESS", True)])
def test_stream_of_an_already_finished_execution_ends_with_done(storage, status, success):
    eid = _finished_execution(storage, status)
    body = TestClient(app).get(f"/api/executions/stream/{eid}").text   # returns only because the stream ends
    events = [line[len("event: "):] for line in body.splitlines() if line.startswith("event: ")]
    assert events == ["harness_event", "harness_event", "done"]         # replayed call + result, then done
    assert f'"success": {"true" if success else "false"}' in body.split("event: done")[1]
    assert shared.sse_hub._subs.get(eid) is None                       # the subscription was released


def test_stream_of_an_unknown_execution_is_404(storage):
    assert TestClient(app).get("/api/executions/stream/exe_missing").status_code == 404
