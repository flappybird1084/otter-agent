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
from agent.telegram_bridge import get_bridge as get_telegram_bridge, issue_link_code
from db import users as users_db
from db import friendships as friendships_db
from db import calendar as calendar_db
from db import notes as notes_db
from db import inbox as inbox_db
from db.chat import (
    write_chat_message,
    list_chat_messages,
    list_chat_messages_for_conversation,
    list_direct_chat_messages,
    delete_direct_chat,
    delete_self_chat,
)
from db.events import list_events
from db.store import new_id

app = FastAPI(title="Confluent")


@app.on_event("startup")
async def _telegram_startup() -> None:
    # Best-effort: if TELEGRAM_BOT_TOKEN is unset the bridge is a no-op, so
    # this is safe in every environment. Errors during start are logged and
    # don't take the API down.
    try:
        await get_telegram_bridge().start()
    except Exception as exc:
        import logging
        logging.getLogger("uvicorn.error").warning(
            "telegram bridge start failed: %s", exc,
        )


@app.on_event("shutdown")
async def _telegram_shutdown() -> None:
    try:
        await get_telegram_bridge().stop()
    except Exception:
        pass


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


@app.get("/social/{viewer_user_id}")
def get_social(viewer_user_id: str) -> dict:
    """For the social graph: each friend + the notes from that friend the
    viewer is allowed to read (after share_tier × reciprocal-scope filtering)."""
    from agent.scope import can_see_note_share_tier

    me = users_db.get_user(viewer_user_id)
    if not me:
        raise HTTPException(404, "user not found")

    # Build per-friend visible notes. For each friend, the friend's scope of
    # ME governs what I see of their notes. Public notes are visible to anyone.
    rows = friendships_db.list_friends(viewer_user_id)
    out_friends: list[dict] = []
    for f in rows:
        other = users_db.get_user(f["friend_id"]) or {}
        # How the friend scopes me — governs what I can read from them
        their_view_of_me = friendships_db.get_friendship(
            owner_id=f["friend_id"], friend_id=viewer_user_id,
        )
        their_scope = (their_view_of_me or {}).get("scope")

        friend_notes = notes_db.list_notes(f["friend_id"])
        visible = []
        for n in friend_notes:
            tier = n.get("share_tier", "private")
            if not can_see_note_share_tier(their_scope, tier):
                continue
            visible.append({
                "id": n["id"],
                "title": n.get("title"),
                "slug": n.get("slug"),
                "kind": n.get("kind", "note"),
                "share_tier": tier,
            })

        out_friends.append({
            "id": f["friend_id"],
            "display_name": other.get("display_name"),
            "handle": other.get("handle"),
            "avatar_emoji": other.get("avatar_emoji"),
            "my_scope_of_them": f.get("scope"),
            "their_scope_of_me": their_scope,
            "visible_notes": visible,
        })

    return {
        "me": {"id": me["id"], "display_name": me.get("display_name")},
        "friends": out_friends,
    }


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


@app.get("/notes/{user_id}/search")
def search_notes_endpoint(user_id: str, q: str = "") -> dict:
    """Search this user's notes; returns the shape avitest1's SearchModal expects."""
    rows = notes_db.search_notes(user_id, q, limit=30)
    # search_notes already includes id, title, tags, snippet. Add slug.
    results = []
    for r in rows:
        full = notes_db.get_note(r["id"]) or {}
        results.append({
            "id": r["id"],
            "title": r.get("title"),
            "slug": full.get("slug"),
            "kind": full.get("kind"),
            "snippet": r.get("snippet", ""),
        })
    return {"results": results}


@app.get("/notes/{user_id}/graph")
def notes_graph(user_id: str) -> dict:
    """Build a brain-map graph by parsing [[Wiki-link]] refs in each note body."""
    import re as _re

    rows = notes_db.list_notes(user_id)
    nodes = [{"id": n["id"], "title": n.get("title"), "kind": n.get("kind", "note")} for n in rows]
    by_slug = {n.get("slug"): n["id"] for n in rows if n.get("slug")}
    by_title_lc = {(n.get("title") or "").lower(): n["id"] for n in rows}

    edges: list[dict] = []
    seen: set[tuple[str, str]] = set()
    wiki_re = _re.compile(r"\[\[([^\]]+)\]\]")
    for n in rows:
        body = notes_db.read_note_body(n["id"])
        for m in wiki_re.finditer(body):
            ref = m.group(1).strip()
            target_id = by_title_lc.get(ref.lower()) or by_slug.get(notes_db.slugify(ref))
            if not target_id or target_id == n["id"]:
                continue
            key = tuple(sorted([n["id"], target_id]))
            if key in seen:
                continue
            seen.add(key)
            edges.append({"a": key[0], "b": key[1]})
    return {"nodes": nodes, "edges": edges}


@app.get("/notes/{user_id}/by-slug/{slug}")
def get_note_by_slug_endpoint(user_id: str, slug: str) -> dict:
    n = notes_db.get_note_by_slug(user_id, slug)
    if not n:
        raise HTTPException(404, "note not found")
    return {**n, "body": notes_db.read_note_body(n["id"])}


@app.get("/notes/{user_id}/{note_id}")
def get_note(user_id: str, note_id: str) -> dict:
    n = notes_db.get_note(note_id)
    if not n or n.get("user_id") != user_id:
        raise HTTPException(404, "note not found")
    return {**n, "body": notes_db.read_note_body(note_id)}


class NoteCreate(BaseModel):
    title: str | None = None
    slug: str | None = None
    body: str | None = None
    kind: str | None = None
    tags: list[str] | None = None
    share_tier: str | None = None
    status: str | None = None
    due_at: str | None = None


@app.post("/notes/{user_id}")
def create_or_get_note_by_slug(user_id: str, req: NoteCreate) -> dict:
    """Create a note; if `slug` is given and exists, return it (wiki-link autocreate)."""
    if req.slug:
        existing = notes_db.get_note_by_slug(user_id, req.slug)
        if existing:
            return {**existing, "body": notes_db.read_note_body(existing["id"])}

    from db.store import get_store as _gs, new_id as _nid
    title = req.title or (req.slug.replace("-", " ").title() if req.slug else "Untitled")
    body = req.body if req.body is not None else f"# {title}\n\n"
    slug = req.slug or notes_db.slugify(title)
    if notes_db.get_note_by_slug(user_id, slug):
        slug = f"{slug}-{_nid()[:6]}"
    note_id = "note_" + _nid()
    store = _gs()
    storage_path = store.write_note(user_id, note_id, body)
    doc = {
        "id": note_id,
        "user_id": user_id,
        "title": title,
        "slug": slug,
        "kind": req.kind or "note",
        "status": req.status,
        "due_at": req.due_at,
        "tags": req.tags or [],
        "share_tier": req.share_tier or "private",
        "sort_index": notes_db.next_sort_index(user_id),
        "storage_path": storage_path,
        "updated_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
    store.upsert("notes", note_id, doc)
    return {**doc, "body": body}


class NoteUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    kind: str | None = None
    tags: list[str] | None = None
    share_tier: str | None = None
    status: str | None = None
    due_at: str | None = None
    sort_index: float | None = None


@app.put("/notes/{user_id}/{note_id}")
def update_note_endpoint(user_id: str, note_id: str, req: NoteUpdate) -> dict:
    n = notes_db.get_note(note_id)
    if not n or n.get("user_id") != user_id:
        raise HTTPException(404, "note not found")
    from db.store import get_store as _gs
    store = _gs()
    patch: dict = {}
    if req.title is not None:
        patch["title"] = req.title
        new_slug = notes_db.slugify(req.title)
        if new_slug != n.get("slug") and not notes_db.get_note_by_slug(user_id, new_slug):
            patch["slug"] = new_slug
    if req.body is not None:
        store.write_note(user_id, note_id, req.body)
    for k in ("kind", "tags", "share_tier", "status", "due_at", "sort_index"):
        v = getattr(req, k)
        if v is not None:
            patch[k] = v
    patch["updated_at"] = __import__("datetime").datetime.utcnow().isoformat()
    store.update("notes", note_id, patch)
    updated = store.get("notes", note_id) or {}
    return {**updated, "body": store.read_note(user_id, note_id)}


@app.delete("/notes/{user_id}/{note_id}")
def delete_note_endpoint(user_id: str, note_id: str) -> dict:
    n = notes_db.get_note(note_id)
    if not n or n.get("user_id") != user_id:
        raise HTTPException(404, "note not found")
    from db.store import get_store as _gs
    _gs().delete("notes", note_id)
    return {"ok": True}


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


@app.delete("/chat/{user_id}")
def delete_chat(user_id: str, conversation_id: str | None = None) -> dict:
    n = delete_self_chat(user_id, conversation_id)
    return {"ok": True, "deleted": n}


# ---------------------------------------------------------------------------
# Direct chat: user talks straight to a friend's agent (not via their own
# agent). Scope governs what the friend's agent shares.
# ---------------------------------------------------------------------------


class DirectChatRequest(BaseModel):
    sender_user_id: str
    recipient_user_id: str
    content: str
    conversation_id: str | None = None


@app.post("/direct-chat")
async def direct_chat(req: DirectChatRequest) -> dict:
    sender = users_db.get_user(req.sender_user_id)
    recipient = users_db.get_user(req.recipient_user_id)
    if not sender or not recipient:
        raise HTTPException(404, "user not found")

    # Reciprocal scope check — does the RECIPIENT actually have the sender as
    # any kind of friend? If they're not friends at all, no chat is possible.
    friendship = friendships_db.get_friendship(
        owner_id=req.recipient_user_id, friend_id=req.sender_user_id,
    )
    if not friendship:
        raise HTTPException(
            403,
            f"{recipient.get('display_name')} hasn't added you, so their agent won't talk to you.",
        )

    conv_id = req.conversation_id or new_id("dconv")
    # Persist the sender's message under the (sender, target=recipient) thread.
    write_chat_message(
        req.sender_user_id, "user", req.content, conv_id,
        target_user_id=req.recipient_user_id,
    )
    reply = await run_agent_turn(
        user_id=req.recipient_user_id,
        conversation_id=conv_id,
        input=req.content,
        mode="agent_direct",
        sender_user_id=req.sender_user_id,
    )
    return {
        "reply": reply if isinstance(reply, str) else str(reply),
        "conversation_id": conv_id,
        "scope": friendship.get("scope"),
    }


@app.get("/direct-chat/{sender_user_id}/{recipient_user_id}")
def get_direct_chat(
    sender_user_id: str,
    recipient_user_id: str,
    conversation_id: str | None = None,
) -> list[dict]:
    return list_direct_chat_messages(
        sender_user_id, recipient_user_id, conversation_id,
    )


@app.delete("/direct-chat/{sender_user_id}/{recipient_user_id}")
def delete_direct(
    sender_user_id: str,
    recipient_user_id: str,
    conversation_id: str | None = None,
) -> dict:
    n = delete_direct_chat(sender_user_id, recipient_user_id, conversation_id)
    return {"ok": True, "deleted": n}


@app.get("/inbox/{user_id}")
def get_inbox(user_id: str) -> list[dict]:
    return inbox_db.list_inbox_for_user(user_id)


# ---------------------------------------------------------------------------
# Telegram pairing
# ---------------------------------------------------------------------------


class TelegramLinkRequest(BaseModel):
    user_id: str


@app.post("/telegram/link-code")
def telegram_issue_link_code(req: TelegramLinkRequest) -> dict:
    """Issue a one-time code the user types into the Telegram bot as
    `/link CODE` to pair their chat with this account. Valid 5 minutes."""
    if not users_db.get_user(req.user_id):
        raise HTTPException(404, "user not found")
    if not get_telegram_bridge().is_enabled():
        raise HTTPException(503, "TELEGRAM_BOT_TOKEN is not set on the server")
    code = issue_link_code(req.user_id)
    return {"code": code, "expires_in_seconds": 5 * 60}


@app.get("/telegram/status/{user_id}")
def telegram_status(user_id: str) -> dict:
    user = users_db.get_user(user_id)
    if not user:
        raise HTTPException(404, "user not found")
    return {
        "bridge_enabled": get_telegram_bridge().is_enabled(),
        "linked": bool(user.get("telegram_chat_id")),
        "chat_id": user.get("telegram_chat_id"),
    }


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------


@app.post("/seed")
def reseed() -> dict:
    from seed.seed import run as run_seed

    run_seed()
    return {"ok": True}
