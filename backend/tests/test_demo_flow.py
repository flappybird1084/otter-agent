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
async def test_create_note_inbox_default_share_tier():
    """Notes created in inbox mode should default to a share_tier the requester can see."""
    from agent.tools import execute_tool
    from db import notes as notes_db

    # close_friend scope → close_friends tier
    res = await execute_tool(
        "create_note",
        {"title": "Todo from Maya", "body": "buy milk"},
        actor_user_id="user_priya",
        conversation_id="conv_t",
        viewer_scope="close_friend",
    )
    note = notes_db.get_note(res["note_id"])
    assert note["share_tier"] == "close_friends"

    # friend scope → friends tier
    res = await execute_tool(
        "create_note",
        {"title": "From friend", "body": "."},
        actor_user_id="user_priya",
        conversation_id="conv_t",
        viewer_scope="friend",
    )
    assert notes_db.get_note(res["note_id"])["share_tier"] == "friends"

    # self mode (no viewer_scope) keeps the private default
    res = await execute_tool(
        "create_note",
        {"title": "Self note", "body": "."},
        actor_user_id="user_priya",
        conversation_id="conv_t",
    )
    assert notes_db.get_note(res["note_id"])["share_tier"] == "private"

    # explicit share_tier overrides the inbox default
    res = await execute_tool(
        "create_note",
        {"title": "Explicit", "body": ".", "share_tier": "family"},
        actor_user_id="user_priya",
        conversation_id="conv_t",
        viewer_scope="close_friend",
    )
    assert notes_db.get_note(res["note_id"])["share_tier"] == "family"


@pytest.mark.asyncio
async def test_list_notes_filtered():
    from agent.tools import execute_tool

    # Tag filter
    res = await execute_tool(
        "list_notes_filtered",
        {"tag": "cs161"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert isinstance(res, list)
    assert any("cs161" in n["tags"] for n in res)
    assert all("cs161" in [t.lower() for t in n["tags"]] for n in res)

    # share_tier filter
    res = await execute_tool(
        "list_notes_filtered",
        {"share_tier": "private"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert all(n["share_tier"] == "private" for n in res)

    # body grep
    res = await execute_tool(
        "list_notes_filtered",
        {"body_contains": "midterm"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert len(res) > 0

    # name filter combined with tag
    res = await execute_tool(
        "list_notes_filtered",
        {"name_contains": "Midterm", "tag": "cs161"},
        actor_user_id="user_maya",
        conversation_id="conv_t",
    )
    assert all("midterm" in n["title"].lower() for n in res)

    # In inbox mode (acquaintance), private/close_friend notes are filtered out
    res = await execute_tool(
        "list_notes_filtered",
        {},
        actor_user_id="user_maya",
        conversation_id="conv_t",
        viewer_scope="acquaintance",
    )
    assert all(n["share_tier"] not in ("private", "close_friends", "family") for n in res)


@pytest.mark.asyncio
async def test_message_friends_parallel_fanout():
    """message_friends should dispatch to all friends and return all replies in one call."""
    from agent.tools import execute_tool
    from agent.loop import run_agent_turn  # to reuse a real a2a_dispatch
    from db import inbox as inbox_db
    from db.events import list_events

    # Stand up an a2a_dispatch identical to the one inside run_agent_turn.
    async def a2a_dispatch(inbox_id: str):
        msg = inbox_db.get_inbox_message(inbox_id)
        inbox_db.update_inbox_message(inbox_id, {"status": "processing"})
        return await run_agent_turn(
            user_id=msg["recipient_user_id"],
            conversation_id=msg["conversation_id"],
            input=msg["intent"],
            mode="agent_inbox",
            inbox_msg=msg,
        )

    res = await execute_tool(
        "message_friends",
        {
            "friend_ids": ["user_priya", "user_devon"],
            "intent": "Find a 2h window this week. Share your free times.",
            "scope_required": "friend",
        },
        actor_user_id="user_maya",
        conversation_id="conv_group",
        a2a_dispatch=a2a_dispatch,
    )
    assert "replies" in res
    fids = [r["friend_id"] for r in res["replies"]]
    assert "user_priya" in fids and "user_devon" in fids
    # Each reply has either a summary or an error
    for r in res["replies"]:
        rep = r["reply"]
        assert ("summary" in rep) or ("error" in rep)

    types = [e["type"] for e in list_events(limit=100)]
    # Two sends, two receives
    assert types.count("agent_message_sent") >= 2
    assert types.count("agent_message_received") >= 2


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
