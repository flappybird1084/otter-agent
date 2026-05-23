"""Confluent backend — FastAPI app.

Endpoints:
  POST /chat                  — start a user agent turn
  POST /agent-to-agent        — internal: dispatch an inbox message to its recipient
  GET  /users                 — list demo users
  GET  /users/{user_id}       — get user metadata
  GET  /friends/{user_id}     — friend list with scope
  POST /friends/{user_id}/scope — change scope toward a friend
  GET  /notes/{user_id}       — list notes for a user
  GET  /notes/{user_id}/{note_id} — note metadata + body
  GET  /calendar/{user_id}    — calendar events
  GET  /events                — agent_events feed (polled by frontend in local mode)
  GET  /chat/{user_id}        — chat history
  GET  /inbox/{user_id}       — inbox messages (debug)
  POST /seed                  — re-seed demo data
  GET  /health                — health
"""
from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent.loop import run_agent_turn
from db import users as users_db
from db import friendships as friendships_db
from db import calendar as calendar_db
from db import notes as notes_db
from db import inbox as inbox_db
from db.chat import write_chat_message, list_chat_messages, list_chat_messages_for_conversation
from db.events import list_events
from db.store import new_id

app = FastAPI(title="Confluent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "store": os.environ.get("STORE_BACKEND", "local"),
        "llm": os.environ.get("LLM_BACKEND", "mock"),
    }


# ---------------------------------------------------------------------------
# Chat / agent
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    user_id: str
    content: str
    conversation_id: str | None = None


@app.post("/chat")
async def chat(req: ChatRequest) -> dict:
    if not users_db.get_user(req.user_id):
        raise HTTPException(404, "user not found")
    conv_id = req.conversation_id or new_id("conv")
    write_chat_message(req.user_id, "user", req.content, conv_id)
    reply = await run_agent_turn(req.user_id, conv_id, req.content, mode="user_chat")
    return {"reply": reply, "conversation_id": conv_id}


class A2ARequest(BaseModel):
    inbox_id: str


@app.post("/agent-to-agent")
async def agent_to_agent(req: A2ARequest) -> Any:
    msg = inbox_db.get_inbox_message(req.inbox_id)
    if not msg:
        raise HTTPException(404, "inbox message not found")
    inbox_db.update_inbox_message(req.inbox_id, {"status": "processing"})
    reply = await run_agent_turn(
        user_id=msg["recipient_user_id"],
        conversation_id=msg["conversation_id"],
        input=msg["intent"],
        mode="agent_inbox",
        inbox_msg=msg,
    )
    return reply


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@app.get("/users")
def get_users() -> list[dict]:
    return users_db.list_users()


@app.get("/users/{user_id}")
def get_user(user_id: str) -> dict:
    u = users_db.get_user(user_id)
    if not u:
        raise HTTPException(404, "user not found")
    return u


@app.get("/friendships")
def get_all_friendships() -> list[dict]:
    """All directed friendship docs (A→B), enriched with the friend's display info."""
    from db.store import get_store as _get_store
    rows = _get_store().query("friendships")
    out = []
    for r in rows:
        other = users_db.get_user(r["friend_id"]) or {}
        out.append({
            **r,
            "display_name": other.get("display_name"),
            "handle": other.get("handle"),
            "avatar_emoji": other.get("avatar_emoji"),
        })
    return out


@app.get("/friends/{user_id}")
def get_friends(user_id: str) -> list[dict]:
    rows = friendships_db.list_friends(user_id)
    out = []
    for r in rows:
        other = users_db.get_user(r["friend_id"]) or {}
        out.append({
            **r,
            "display_name": other.get("display_name"),
            "handle": other.get("handle"),
            "avatar_emoji": other.get("avatar_emoji"),
            "bio": other.get("bio"),
        })
    return out


class ScopeUpdate(BaseModel):
    friend_id: str
    scope: str


@app.post("/friends/{user_id}/scope")
def update_scope(user_id: str, body: ScopeUpdate) -> dict:
    if body.scope not in ("acquaintance", "friend", "close_friend", "family"):
        raise HTTPException(400, "invalid scope")
    friendships_db.set_scope(user_id, body.friend_id, body.scope)
    return {"ok": True}


@app.get("/notes/{user_id}")
def get_notes(user_id: str) -> list[dict]:
    return notes_db.list_notes(user_id)


@app.get("/notes/{user_id}/{note_id}")
def get_note(user_id: str, note_id: str) -> dict:
    n = notes_db.get_note(note_id)
    if not n or n.get("user_id") != user_id:
        raise HTTPException(404, "note not found")
    return {**n, "body": notes_db.read_note_body(note_id)}


@app.get("/calendar/{user_id}")
def get_calendar(user_id: str, start: str | None = None, end: str | None = None) -> list[dict]:
    return calendar_db.list_events(user_id, start, end)


@app.get("/events")
def get_events(limit: int = 50) -> list[dict]:
    return list_events(limit=limit)


@app.get("/chat/{user_id}")
def get_chat(user_id: str, limit: int = 50, conversation_id: str | None = None) -> list[dict]:
    if conversation_id:
        return list_chat_messages_for_conversation(user_id, conversation_id)
    return list_chat_messages(user_id, limit=limit)


@app.get("/inbox/{user_id}")
def get_inbox(user_id: str) -> list[dict]:
    return inbox_db.list_inbox_for_user(user_id)


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------


@app.post("/seed")
def reseed() -> dict:
    from seed.seed import run as run_seed

    run_seed()
    return {"ok": True}
