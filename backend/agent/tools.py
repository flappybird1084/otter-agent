"""Tool schemas + implementations.

The schemas are exposed in two shapes:
  - TOOL_DECLARATIONS: name -> vertex `FunctionDeclaration` (lazy import)
  - TOOL_SCHEMA_DICTS: name -> plain dict (for documentation / debugging)

Implementations live alongside, dispatched by `execute_tool`.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from db import users as users_db
from db import friendships as friendships_db
from db import calendar as calendar_db
from db import notes as notes_db
from db import inbox as inbox_db
from db.events import log_event
from db.store import get_store, new_id, utcnow_iso

from .scope import SCOPE_RANK, scope_rank, filter_event_for_viewer


# ---------------------------------------------------------------------------
# Plain dict schemas (also used to build Vertex declarations lazily)
# ---------------------------------------------------------------------------

TOOL_SCHEMA_DICTS: dict[str, dict] = {
    "search_notes": {
        "name": "search_notes",
        "description": (
            "Search the current user's personal notes by keyword, tag, or topic. "
            "Returns a list of matching notes with id, title, tags, and a snippet. "
            "Use this BEFORE read_note to find relevant notes. Never invent note ids."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords, topic, or tag to search for."},
                "limit": {"type": "integer", "description": "Max results. Default 5."},
            },
            "required": ["query"],
        },
    },
    "read_note": {
        "name": "read_note",
        "description": "Fetch the full markdown of a specific note by id. Use after search_notes identifies a relevant one.",
        "parameters": {
            "type": "object",
            "properties": {"note_id": {"type": "string"}},
            "required": ["note_id"],
        },
    },
    "read_calendar": {
        "name": "read_calendar",
        "description": (
            "Read calendar events for the current user in a date range. Returns events "
            "sorted by start time. Use this to find free time or check conflicts."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "ISO date e.g. 2026-05-23. Defaults to today."},
                "end_date": {"type": "string", "description": "ISO date e.g. 2026-05-30. Defaults to today + 7 days."},
            },
        },
    },
    "list_friends": {
        "name": "list_friends",
        "description": (
            "List the current user's friends and the trust scope assigned to each. "
            "Always call this before message_friend to confirm the friend and scope."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    "message_friend": {
        "name": "message_friend",
        "description": (
            "Send a structured intent to a friend's agent and wait for their reply. "
            "FULLY SYNCHRONOUS: when this returns, the reply (or error) is in your hand — "
            "there is NO background/async path. Never say 'waiting for X to reply' in your "
            "final answer; if you don't have a reply, you didn't call this tool. "
            "For coordinating across multiple friends, prefer message_friends (parallel batch). "
            "Include all needed context in 'intent' (e.g. your free windows). The system "
            "enforces scope_required against the scope the friend has assigned to you."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "friend_id": {"type": "string", "description": "The friend's user id from list_friends."},
                "intent": {"type": "string", "description": "Natural-language request including any context the friend's agent needs."},
                "scope_required": {
                    "type": "string",
                    "enum": ["acquaintance", "friend", "close_friend", "family"],
                    "description": "Minimum scope needed. 'friend' for calendars, 'close_friend' for notes.",
                },
            },
            "required": ["friend_id", "intent", "scope_required"],
        },
    },
    "message_friends": {
        "name": "message_friends",
        "description": (
            "Send the same intent to MULTIPLE friends' agents IN PARALLEL and wait until "
            "every one has either replied or errored. Use whenever the user mentions more "
            "than one person ('A and B', 'the group', 'my study crew'). Returns one entry "
            "per friend so your summary can reflect ALL of them. FULLY SYNCHRONOUS — when "
            "this returns, every friend's reply is in your hand. Never say 'still waiting "
            "for X' in your final answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "friend_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of friend user ids from list_friends.",
                },
                "intent": {"type": "string"},
                "scope_required": {
                    "type": "string",
                    "enum": ["acquaintance", "friend", "close_friend", "family"],
                },
            },
            "required": ["friend_ids", "intent", "scope_required"],
        },
    },
    "propose_event": {
        "name": "propose_event",
        "description": (
            "Propose a calendar event for the user to confirm. Creates a pending event "
            "that surfaces as a card in the UI. Use after coordinating a time with a friend."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_iso": {"type": "string"},
                "end_iso": {"type": "string"},
                "location": {"type": "string"},
                "attendees": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "start_iso", "end_iso"],
        },
    },
    "reply_to_agent": {
        "name": "reply_to_agent",
        "description": (
            "ONLY available when responding to another user's agent. Send the final "
            "structured reply back. Include concrete data (proposed times, snippets)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "data": {"type": "object"},
            },
            "required": ["summary"],
        },
    },
    "get_current_time": {
        "name": "get_current_time",
        "description": (
            "Return the current date and time. Use for questions like 'what time is it', "
            "'what day is today', or when you need 'now' to build a timestamp."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    "create_note": {
        "name": "create_note",
        "description": (
            "Create a new note for the current user. Use when asked to save, jot down, "
            "draft, write, or record something as a note. Choose share_tier carefully — "
            "'private' is the safe default."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string", "description": "Markdown body."},
                "tags": {"type": "array", "items": {"type": "string"}},
                "share_tier": {
                    "type": "string",
                    "enum": ["private", "friends", "close_friends", "family"],
                },
            },
            "required": ["title", "body"],
        },
    },
    "update_note": {
        "name": "update_note",
        "description": (
            "Update an existing note's body, title, tags, or share_tier. Use "
            "search_notes first to find the note id. Only fields you pass change."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "note_id": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "share_tier": {
                    "type": "string",
                    "enum": ["private", "friends", "close_friends", "family"],
                },
            },
            "required": ["note_id"],
        },
    },
    "delete_note": {
        "name": "delete_note",
        "description": "Delete a note by id. Use after search_notes to find the note. Prefer to confirm with the user first.",
        "parameters": {
            "type": "object",
            "properties": {"note_id": {"type": "string"}},
            "required": ["note_id"],
        },
    },
    "set_friend_scope": {
        "name": "set_friend_scope",
        "description": (
            "Change the trust scope you have assigned to a friend. Higher scope means their "
            "agent can see more of your data when they ask. Use list_friends first to confirm "
            "the friend id. Scopes ranked low→high: acquaintance, friend, close_friend, family."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "friend_id": {"type": "string"},
                "scope": {
                    "type": "string",
                    "enum": ["acquaintance", "friend", "close_friend", "family"],
                },
            },
            "required": ["friend_id", "scope"],
        },
    },
    "create_calendar_event": {
        "name": "create_calendar_event",
        "description": (
            "Create a confirmed event on the user's own calendar. Use when asked to add, "
            "schedule, or block time. For meetings negotiated with a friend, use propose_event "
            "instead so the other side gets a confirmable card."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_iso": {"type": "string"},
                "end_iso": {"type": "string"},
                "location": {"type": "string"},
                "visibility": {
                    "type": "string",
                    "enum": ["title_and_time", "busy_only", "full"],
                },
            },
            "required": ["title", "start_iso", "end_iso"],
        },
    },
    "delete_calendar_event": {
        "name": "delete_calendar_event",
        "description": "Delete a calendar event by id. Use after read_calendar to find the event.",
        "parameters": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
        },
    },
}


SELF_TOOLS = [
    "get_current_time",
    "search_notes", "read_note", "create_note", "update_note", "delete_note",
    "read_calendar", "create_calendar_event", "delete_calendar_event",
    "list_friends", "set_friend_scope",
    "message_friend", "message_friends", "propose_event",
]
INBOX_TOOLS = [
    "get_current_time",
    "search_notes", "read_note",
    "read_calendar",
    "list_friends",
    "reply_to_agent",
]


# Lazy Vertex declarations
class _LazyDeclarations(dict):
    def __getitem__(self, key):
        if key not in self.keys():
            from vertexai.generative_models import FunctionDeclaration  # type: ignore

            d = TOOL_SCHEMA_DICTS[key]
            self[key] = FunctionDeclaration(name=d["name"], description=d["description"], parameters=d["parameters"])
        return super().__getitem__(key)


TOOL_DECLARATIONS = _LazyDeclarations()


# ---------------------------------------------------------------------------
# Implementations
# ---------------------------------------------------------------------------


def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _date_plus(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


async def execute_tool(
    name: str,
    args: dict,
    *,
    actor_user_id: str,
    conversation_id: str,
    viewer_scope: str | None = None,
    a2a_dispatch: Callable | None = None,
    reply_sink: dict | None = None,
) -> Any:
    """Dispatch a tool call.

    viewer_scope: when non-None, the actor's agent is acting in inbox mode for
                  another user with this scope — apply scope-aware filtering.
    a2a_dispatch: async fn(inbox_id) -> reply_dict, used by message_friend to
                  trigger the recipient's loop. Wired by the agent runner.
    reply_sink:   dict the inbox loop writes its reply into via reply_to_agent.
    """
    args = args or {}

    if name == "search_notes":
        return notes_db.search_notes(actor_user_id, args.get("query", ""), int(args.get("limit") or 5))

    if name == "read_note":
        note = notes_db.get_note(args.get("note_id", ""))
        if not note or note.get("user_id") != actor_user_id:
            return {"error": "not_found", "message": "Note not found or not accessible."}
        if viewer_scope is not None:
            from .scope import can_see_note_share_tier
            if not can_see_note_share_tier(viewer_scope, note.get("share_tier", "private")):
                return {"error": "scope_insufficient", "message": "Note's share tier exceeds your scope."}
        body = notes_db.read_note_body(note["id"])
        return {"id": note["id"], "title": note.get("title"), "tags": note.get("tags", []), "body": body}

    if name == "read_calendar":
        start = (args.get("start_date") or _today_iso())
        end = (args.get("end_date") or _date_plus(7))
        events = calendar_db.list_events(actor_user_id, start, end)
        if viewer_scope is None:
            return [{
                "id": e["id"],
                "title": e.get("title"),
                "start": e["start"],
                "end": e["end"],
                "location": e.get("location"),
            } for e in events]
        return [filter_event_for_viewer(e, viewer_scope) for e in events]

    if name == "list_friends":
        rows = friendships_db.list_friends(actor_user_id)
        out = []
        for f in rows:
            other = users_db.get_user(f["friend_id"])
            out.append({
                "friend_id": f["friend_id"],
                "display_name": (other or {}).get("display_name"),
                "handle": (other or {}).get("handle"),
                "scope": f.get("scope"),
            })
        return out

    if name == "propose_event":
        store = get_store()
        event_id = new_id()
        store.add("calendar_events", {
            "id": event_id,
            "user_id": actor_user_id,
            "title": args["title"],
            "start": args["start_iso"],
            "end": args["end_iso"],
            "location": args.get("location"),
            "visibility": "full",
            "status": "proposed",
            "attendees": args.get("attendees", []),
        })
        log_event(
            type="event_proposed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": f"Proposed: {args['title']} {args['start_iso'][:16]}",
                "event_id": event_id,
                "title": args["title"],
                "start_iso": args["start_iso"],
                "end_iso": args["end_iso"],
                "attendees": args.get("attendees", []),
            },
        )
        # Also write a proposed event on each attendee's calendar
        for attendee in args.get("attendees", []) or []:
            store.add("calendar_events", {
                "id": new_id(),
                "user_id": attendee,
                "title": f"(proposed) {args['title']}",
                "start": args["start_iso"],
                "end": args["end_iso"],
                "location": args.get("location"),
                "visibility": "full",
                "status": "proposed",
                "attendees": [actor_user_id] + [a for a in args.get("attendees", []) if a != attendee],
            })
        return {"ok": True, "event_id": event_id}

    if name == "message_friend":
        if a2a_dispatch is None:
            return {"error": "a2a_unavailable", "message": "Agent-to-agent dispatch not wired in this context."}
        friend_id = args["friend_id"]
        intent = args["intent"]
        scope_required = args.get("scope_required", "friend")

        # Scope is checked from the RECIPIENT's perspective.
        friendship = friendships_db.get_friendship(owner_id=friend_id, friend_id=actor_user_id)
        if not friendship:
            log_event(
                type="agent_message_sent",
                actor_user_id=actor_user_id,
                target_user_id=friend_id,
                conversation_id=conversation_id,
                payload={"summary": "Blocked: not friends", "rejected": True},
            )
            return {"error": "not_friends", "message": "You are not friends with this user."}

        if scope_rank(friendship["scope"]) < scope_rank(scope_required):
            log_event(
                type="agent_message_sent",
                actor_user_id=actor_user_id,
                target_user_id=friend_id,
                conversation_id=conversation_id,
                payload={
                    "summary": f"Blocked by scope ({friendship['scope']} < {scope_required})",
                    "rejected": True,
                    "friend_scope": friendship["scope"],
                    "scope_required": scope_required,
                },
            )
            return {
                "error": "scope_insufficient",
                "message": (
                    f"Your scope with {friend_id} is {friendship['scope']}, "
                    f"but this request requires {scope_required}."
                ),
            }

        inbox_id = inbox_db.create_inbox_message(
            recipient_user_id=friend_id,
            sender_user_id=actor_user_id,
            intent=intent,
            scope_required=scope_required,
            conversation_id=conversation_id,
        )
        log_event(
            type="agent_message_sent",
            actor_user_id=actor_user_id,
            target_user_id=friend_id,
            conversation_id=conversation_id,
            payload={
                "summary": _shorten(intent, 80),
                "intent": intent,
                "inbox_id": inbox_id,
                "scope": friendship["scope"],
                "scope_required": scope_required,
            },
        )

        reply = await a2a_dispatch(inbox_id)

        log_event(
            type="agent_message_received",
            actor_user_id=actor_user_id,
            target_user_id=friend_id,
            conversation_id=conversation_id,
            payload={"summary": (reply or {}).get("summary", ""), "inbox_id": inbox_id},
        )

        return {
            "from": friend_id,
            "summary": (reply or {}).get("summary"),
            "data": (reply or {}).get("reply_data") or (reply or {}).get("data"),
        }

    if name == "message_friends":
        if a2a_dispatch is None:
            return {"error": "a2a_unavailable", "message": "Agent-to-agent dispatch not wired."}
        friend_ids = args.get("friend_ids") or []
        intent = args.get("intent", "")
        scope_required = args.get("scope_required", "friend")
        if not friend_ids:
            return {"error": "no_friends", "message": "friend_ids is empty."}

        import asyncio as _asyncio

        async def _one(friend_id: str):
            try:
                return await execute_tool(
                    "message_friend",
                    {"friend_id": friend_id, "intent": intent, "scope_required": scope_required},
                    actor_user_id=actor_user_id,
                    conversation_id=conversation_id,
                    viewer_scope=viewer_scope,
                    a2a_dispatch=a2a_dispatch,
                    reply_sink=reply_sink,
                )
            except Exception as exc:
                return {"error": "exception", "message": str(exc)}

        results = await _asyncio.gather(*[_one(fid) for fid in friend_ids])
        return {
            "replies": [
                {"friend_id": fid, "reply": r}
                for fid, r in zip(friend_ids, results)
            ]
        }

    if name == "reply_to_agent":
        if reply_sink is None:
            return {"error": "not_in_inbox_mode"}
        reply_sink["summary"] = args.get("summary", "")
        reply_sink["data"] = args.get("data", {})
        return {"ok": True}

    if name == "get_current_time":
        now_utc = datetime.now(timezone.utc)
        now_local = datetime.now()
        return {
            "iso_utc": now_utc.isoformat(),
            "iso_local": now_local.isoformat(),
            "human": now_local.strftime("%A, %B %d, %Y at %I:%M %p"),
            "weekday": now_local.strftime("%A"),
            "date": now_local.strftime("%Y-%m-%d"),
            "time": now_local.strftime("%H:%M"),
        }

    if name == "create_note":
        store = get_store()
        note_id = "note_" + new_id()
        body = args.get("body", "")
        title = args["title"]
        tags = args.get("tags", [])
        share_tier = args.get("share_tier", "private")
        storage_path = store.write_note(actor_user_id, note_id, body)
        store.upsert("notes", note_id, {
            "id": note_id,
            "user_id": actor_user_id,
            "title": title,
            "tags": tags,
            "share_tier": share_tier,
            "storage_path": storage_path,
            "updated_at": utcnow_iso(),
        })
        log_event(
            type="note_changed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={"summary": f"Created note: {title}", "action": "create", "note_id": note_id, "title": title},
        )
        return {"ok": True, "note_id": note_id, "title": title}

    if name == "update_note":
        store = get_store()
        note_id = args.get("note_id", "")
        existing = store.get("notes", note_id)
        if not existing or existing.get("user_id") != actor_user_id:
            return {"error": "not_found", "message": "Note not found or not yours."}
        patch = {"updated_at": utcnow_iso()}
        for k in ("title", "tags", "share_tier"):
            if k in args and args[k] is not None:
                patch[k] = args[k]
        if "body" in args and args["body"] is not None:
            store.write_note(actor_user_id, note_id, args["body"])
        store.update("notes", note_id, patch)
        log_event(
            type="note_changed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": f"Updated note: {patch.get('title') or existing.get('title')}",
                "action": "update",
                "note_id": note_id,
            },
        )
        return {"ok": True, "note_id": note_id}

    if name == "delete_note":
        store = get_store()
        note_id = args.get("note_id", "")
        existing = store.get("notes", note_id)
        if not existing or existing.get("user_id") != actor_user_id:
            return {"error": "not_found", "message": "Note not found or not yours."}
        store.delete("notes", note_id)
        # best-effort filesystem cleanup for local store
        try:
            from pathlib import Path
            p = Path(os.environ.get("LOCAL_NOTES_PATH", "./seed/notes")) / actor_user_id / f"{note_id}.md"
            if p.exists():
                p.unlink()
        except Exception:
            pass
        log_event(
            type="note_changed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": f"Deleted note: {existing.get('title')}",
                "action": "delete",
                "note_id": note_id,
            },
        )
        return {"ok": True}

    if name == "set_friend_scope":
        from db import friendships as friendships_db_local
        friend_id = args.get("friend_id", "")
        scope = args.get("scope", "")
        if scope not in ("acquaintance", "friend", "close_friend", "family"):
            return {"error": "invalid_scope"}
        if not friendships_db_local.get_friendship(actor_user_id, friend_id):
            return {"error": "not_friends", "message": f"No friendship with {friend_id}."}
        friendships_db_local.set_scope(actor_user_id, friend_id, scope)
        log_event(
            type="scope_changed",
            actor_user_id=actor_user_id,
            target_user_id=friend_id,
            conversation_id=conversation_id,
            payload={"summary": f"Set scope with {friend_id} → {scope}", "scope": scope},
        )
        return {"ok": True, "friend_id": friend_id, "scope": scope}

    if name == "create_calendar_event":
        store = get_store()
        event_id = new_id()
        store.add("calendar_events", {
            "id": event_id,
            "user_id": actor_user_id,
            "title": args["title"],
            "start": args["start_iso"],
            "end": args["end_iso"],
            "location": args.get("location"),
            "visibility": args.get("visibility", "full"),
            "status": "confirmed",
        })
        log_event(
            type="calendar_changed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": f"Created event: {args['title']} @ {args['start_iso'][:16]}",
                "action": "create",
                "event_id": event_id,
                "title": args["title"],
            },
        )
        return {"ok": True, "event_id": event_id}

    if name == "delete_calendar_event":
        store = get_store()
        event_id = args.get("event_id", "")
        existing = store.get("calendar_events", event_id)
        if not existing or existing.get("user_id") != actor_user_id:
            return {"error": "not_found", "message": "Event not found or not yours."}
        store.delete("calendar_events", event_id)
        log_event(
            type="calendar_changed",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": f"Deleted event: {existing.get('title')}",
                "action": "delete",
                "event_id": event_id,
            },
        )
        return {"ok": True}

    return {"error": "unknown_tool", "message": name}


def _shorten(s: str, n: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"
