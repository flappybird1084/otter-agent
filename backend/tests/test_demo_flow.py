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


@pytest.mark.asyncio
async def test_conversation_memory_across_turns():
    """Multi-turn within the same conversation should retain history."""
    from agent.loop import run_agent_turn
    from db.chat import list_chat_messages_for_conversation, write_chat_message

    conv = "conv_memory_test"
    # turn 1
    write_chat_message("user_maya", "user", "What's on my calendar tomorrow?", conv)
    await run_agent_turn("user_maya", conv, "What's on my calendar tomorrow?", mode="user_chat")
    # turn 2
    write_chat_message("user_maya", "user", "Now find me a study time with Priya.", conv)
    await run_agent_turn("user_maya", conv, "Now find me a study time with Priya.", mode="user_chat")

    history = list_chat_messages_for_conversation("user_maya", conv)
    user_msgs = [m for m in history if m["role"] == "user"]
    agent_msgs = [m for m in history if m["role"] == "agent"]
    assert len(user_msgs) == 2
    assert len(agent_msgs) == 2, f"expected 2 agent replies, got {len(agent_msgs)}"
