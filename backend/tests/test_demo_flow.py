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
async def test_new_tools_smoke():
    """Direct exercise of the new mutation tools."""
    from agent.tools import execute_tool
    from db import notes as notes_db
    from db import friendships as friendships_db
    from db.store import get_store

    # get_current_time
    t = await execute_tool("get_current_time", {}, actor_user_id="user_maya", conversation_id="conv_t")
    assert "iso_utc" in t and "human" in t

    # create_note
    res = await execute_tool(
        "create_note",
        {"title": "Test note", "body": "# hi\n\nbody", "tags": ["test"], "share_tier": "private"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert res.get("ok")
    note_id = res["note_id"]
    assert notes_db.read_note_body(note_id) == "# hi\n\nbody"

    # update_note
    res = await execute_tool(
        "update_note",
        {"note_id": note_id, "body": "# updated"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert res.get("ok")
    assert notes_db.read_note_body(note_id) == "# updated"

    # delete_note
    res = await execute_tool(
        "delete_note", {"note_id": note_id},
        actor_user_id="user_maya", conversation_id="conv_t",
    )
    assert res.get("ok")
    assert notes_db.get_note(note_id) is None

    # set_friend_scope
    res = await execute_tool(
        "set_friend_scope",
        {"friend_id": "user_priya", "scope": "friend"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert res.get("ok")
    assert friendships_db.get_friendship("user_maya", "user_priya")["scope"] == "friend"

    # create_calendar_event + delete
    res = await execute_tool(
        "create_calendar_event",
        {"title": "Solo focus", "start_iso": "2099-01-01T10:00:00", "end_iso": "2099-01-01T11:00:00"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert res.get("ok")
    event_id = res["event_id"]
    res = await execute_tool(
        "delete_calendar_event", {"event_id": event_id},
        actor_user_id="user_maya", conversation_id="conv_t",
    )
    assert res.get("ok")
    assert get_store().get("calendar_events", event_id) is None


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
