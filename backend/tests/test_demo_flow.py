"""End-to-end smoke test for the killer demo flow.

Runs in local-store + mock-LLM mode. No GCP required.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch):
    tmpdir = tempfile.mkdtemp()
    monkeypatch.setenv("STORE_BACKEND", "local")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    monkeypatch.setenv("LOCAL_STORE_PATH", str(Path(tmpdir) / "store.json"))
    monkeypatch.setenv("LOCAL_NOTES_PATH", str(Path(tmpdir) / "notes"))
    # reset the store singleton
    import db.store as store_mod
    store_mod._singleton = None
    from seed.seed import run
    run()
    yield


@pytest.mark.asyncio
async def test_maya_to_priya_study_flow():
    from agent.loop import run_agent_turn
    from db.events import list_events

    reply = await run_agent_turn(
        user_id="user_maya",
        conversation_id="conv_test",
        input="Find a time to study for the CS161 midterm with Priya this week.",
        mode="user_chat",
    )
    assert isinstance(reply, str)
    events = list_events(limit=100)
    types = [e["type"] for e in events]
    assert "agent_message_sent" in types
    assert "agent_message_received" in types
    assert "agent_replied" in types
    assert "event_proposed" in types
