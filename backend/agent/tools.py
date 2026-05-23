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
            "The friend's agent will process the request using its own calendar/notes "
            "according to the trust scope. Include all needed context in 'intent' "
            "(e.g. your free windows). The system enforces scope_required against the "
            "scope the friend has assigned to you."
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
}


SELF_TOOLS = ["search_notes", "read_note", "read_calendar", "list_friends", "message_friend", "propose_event"]
INBOX_TOOLS = ["search_notes", "read_note", "read_calendar", "list_friends", "reply_to_agent"]


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

    if name == "reply_to_agent":
        if reply_sink is None:
            return {"error": "not_in_inbox_mode"}
        reply_sink["summary"] = args.get("summary", "")
        reply_sink["data"] = args.get("data", {})
        return {"ok": True}

    return {"error": "unknown_tool", "message": name}


def _shorten(s: str, n: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"
