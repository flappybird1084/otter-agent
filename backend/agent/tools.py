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
from .timeutil import now_pacific, now_utc


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
    "list_notes_filtered": {
        "name": "list_notes_filtered",
        "description": (
            "List the current user's notes with structured filters. All provided "
            "filters AND together. Use this when you know exactly what you want; "
            "use search_notes when you want fuzzy ranking. Returns id, title, tags, "
            "share_tier, and a snippet for each match. In inbox mode, results are "
            "also scope-filtered so you only see what your viewer can see."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tag": {"type": "string", "description": "Exact tag match (case-insensitive)."},
                "tags_any": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Match notes that have ANY of these tags (case-insensitive).",
                },
                "name_contains": {
                    "type": "string",
                    "description": "Substring of the note title (case-insensitive).",
                },
                "body_contains": {
                    "type": "string",
                    "description": "Substring grep across the markdown body (case-insensitive).",
                },
                "share_tier": {
                    "type": "string",
                    "enum": ["private", "public", "friends", "close_friends", "family"],
                },
                "limit": {"type": "integer", "description": "Max results. Default 20."},
            },
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
            "List the current user's friends with BOTH directions of trust scope:\n"
            "  - my_scope_of_them: how YOUR USER views the friend (controls what your user "
            "    would share). The user can adjust this freely.\n"
            "  - their_scope_of_me: how the friend views YOUR USER — THIS is what governs "
            "    what the friend's agent will share back when you call message_friend. "
            "    Pick scope_required no higher than their_scope_of_me; otherwise the call "
            "    will be rejected. If their_scope_of_me is 'friend', you CANNOT get "
            "    close_friend-only data from them no matter how high your_scope_of_them is.\n"
            "Always call this before message_friend / message_friends / set_friend_scope."
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
            "Include all needed context in 'intent' (e.g. your free windows). "
            "\n\nSCOPE RULE: scope_required is bounded by THEIR scope of YOU "
            "(their_scope_of_me from list_friends), NOT your scope of them. If their "
            "scope of you is 'friend', do not pass scope_required='close_friend' — the "
            "system will reject it. Match scope_required to the data tier you actually "
            "need: 'friend' for free/busy + titled calendar, 'close_friend' for notes "
            "tagged close_friends, 'family' for family-only notes."
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
            "draft, write, or record something as a note. Choose share_tier deliberately: "
            "'private' for self-only; 'public' for visible-to-anyone (incl. strangers "
            "and on the user's social-graph node); 'friends'/'close_friends'/'family' "
            "for those tiers and above. If you're in inbox mode (acting on a friend's "
            "request) and you omit share_tier, the system picks one keyed to the "
            "requester's scope so they can see what you just made for them."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string", "description": "Markdown body."},
                "tags": {"type": "array", "items": {"type": "string"}},
                "share_tier": {
                    "type": "string",
                    "enum": ["private", "public", "friends", "close_friends", "family"],
                },
                "kind": {
                    "type": "string",
                    "enum": ["note", "daily", "project", "task", "person"],
                    "description": "Category. 'task' for todos, 'daily' for journals, 'project' for ongoing work, 'person' for who-is-X notes, 'note' for everything else (default).",
                },
                "status": {
                    "type": "string",
                    "description": "Optional status label (e.g. 'todo', 'doing', 'done'). Free-form.",
                },
                "due_at": {
                    "type": "string",
                    "description": "Optional ISO timestamp for when this is due.",
                },
            },
            "required": ["title", "body"],
        },
    },
    "update_note": {
        "name": "update_note",
        "description": (
            "Update an existing note's body, title, tags, share_tier, kind, status, "
            "or due_at. Use search_notes first to find the note id. Only fields you "
            "pass change."
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
                    "enum": ["private", "public", "friends", "close_friends", "family"],
                },
                "kind": {
                    "type": "string",
                    "enum": ["note", "daily", "project", "task", "person"],
                },
                "status": {"type": "string"},
                "due_at": {"type": "string"},
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
                "notes": {
                    "type": "string",
                    "description": "Optional freeform description shown on the event popup.",
                },
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
    "ask_user": {
        "name": "ask_user",
        "description": (
            "Ask the user an open-ended question and wait for their typed reply. "
            "Use ONLY when you genuinely cannot proceed without their input: an "
            "ambiguous date ('this Friday or next?'), a missing detail ('which "
            "midterm?'), or a choice the user must make. The question is delivered "
            "out-of-band (Telegram), so it works even during agent-to-agent flows. "
            "Returns {answered: bool, text: string|null, reason: string|null}. "
            "If answered=false, the user did not respond in time — fall back to a "
            "sensible default and tell the user what you assumed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question, phrased as one short sentence.",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Max seconds to wait. Default 120, max 300.",
                },
            },
            "required": ["question"],
        },
    },
    "confirm_action": {
        "name": "confirm_action",
        "description": (
            "Ask the user to approve or deny a specific action you're about to "
            "take. Use BEFORE any irreversible or high-stakes operation: sending "
            "a message to a friend, creating a calendar invite, deleting a note, "
            "lowering a friend's scope. The user sees an Approve/Deny button on "
            "Telegram. Returns {answered: bool, approved: bool|null, note: "
            "string|null, reason: string|null}. If answered=false, treat as "
            "denied — do NOT take the action, and tell the user you didn't hear "
            "back. Phrase `summary` as a single sentence describing exactly what "
            "you'd do (e.g. 'Send Devon: \"Free Wed 3-5pm for studying?\"')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "One sentence describing the action you want approved.",
                },
                "risk_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "How big a deal this is. high = irreversible/data loss.",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Max seconds to wait. Default 120, max 300.",
                },
            },
            "required": ["summary"],
        },
    },
}


SELF_TOOLS = [
    "get_current_time",
    "search_notes", "list_notes_filtered", "read_note",
    "create_note", "update_note", "delete_note",
    "read_calendar", "create_calendar_event", "delete_calendar_event",
    "list_friends", "set_friend_scope",
    "message_friend", "message_friends", "propose_event",
    "ask_user", "confirm_action",
]
INBOX_TOOLS = [
    "get_current_time",
    "search_notes", "list_notes_filtered", "read_note",
    "create_note", "update_note", "delete_note",
    "read_calendar", "create_calendar_event", "delete_calendar_event",
    "list_friends",
    "reply_to_agent",
    # ask_user / confirm_action ask the RECEIVER (the human whose agent is
    # currently running), not the sender — so the receiver stays in the loop
    # on anything sensitive a friend's agent is trying to do on their behalf.
    "ask_user", "confirm_action",
    # Deliberately omitted:
    #   message_friend / message_friends — prevents cascading agent loops
    #   set_friend_scope — relationship trust shouldn't be set by a remote agent
    #   propose_event — would write to the requesting agent's calendar; out of scope
]

# Direct-chat mode: a friend chats with this user's agent through their UI.
# Same as inbox tools, but the reply is free text (no reply_to_agent).
DIRECT_TOOLS = [
    "get_current_time",
    "search_notes", "list_notes_filtered", "read_note",
    "create_note", "update_note", "delete_note",
    "read_calendar", "create_calendar_event", "delete_calendar_event",
    "list_friends",
    # Deliberately omitted: same reasons as INBOX_TOOLS + no reply_to_agent
    # since the recipient produces a normal chat reply, not a structured reply.
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
    return now_pacific().strftime("%Y-%m-%d")


def _date_plus(days: int) -> str:
    return (now_pacific() + timedelta(days=days)).strftime("%Y-%m-%d")


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

    if name == "list_notes_filtered":
        from .scope import can_see_note_share_tier

        store = get_store()
        rows = notes_db.list_notes(actor_user_id)
        tag = (args.get("tag") or "").strip().lower()
        tags_any = [t.lower() for t in (args.get("tags_any") or []) if t]
        name_q = (args.get("name_contains") or "").strip().lower()
        body_q = (args.get("body_contains") or "").strip().lower()
        share_tier = args.get("share_tier")
        limit = int(args.get("limit") or 20)

        out = []
        for n in rows:
            note_tags = [t.lower() for t in (n.get("tags") or [])]
            if tag and tag not in note_tags:
                continue
            if tags_any and not any(t in note_tags for t in tags_any):
                continue
            if name_q and name_q not in (n.get("title") or "").lower():
                continue
            if share_tier and n.get("share_tier") != share_tier:
                continue
            body = store.read_note(actor_user_id, n["id"])
            if body_q and body_q not in body.lower():
                continue
            # In inbox mode, hide notes the viewer's scope can't see at all.
            if viewer_scope is not None and not can_see_note_share_tier(
                viewer_scope, n.get("share_tier", "private")
            ):
                continue
            snippet = body[:240].replace("\n", " ").strip()
            out.append({
                "id": n["id"],
                "title": n.get("title"),
                "tags": n.get("tags", []),
                "share_tier": n.get("share_tier"),
                "snippet": snippet,
            })
            if len(out) >= limit:
                break
        return out

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
            their_view = friendships_db.get_friendship(
                owner_id=f["friend_id"], friend_id=actor_user_id,
            )
            their_scope = (their_view or {}).get("scope")
            out.append({
                "friend_id": f["friend_id"],
                "display_name": (other or {}).get("display_name"),
                "handle": (other or {}).get("handle"),
                "my_scope_of_them": f.get("scope"),
                "their_scope_of_me": their_scope,
                # max scope_required you can send them through message_friend:
                "max_message_scope": their_scope,
                # legacy alias — kept so older prompts/tests keep working
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

        # Step 1: validate the friend_id actually points to a real user.
        friend_user = users_db.get_user(friend_id)
        if not friend_user:
            valid_ids = [f["friend_id"] for f in friendships_db.list_friends(actor_user_id)]
            log_event(
                type="agent_message_sent",
                actor_user_id=actor_user_id,
                target_user_id=None,
                conversation_id=conversation_id,
                payload={
                    "summary": f"Unknown friend_id '{friend_id}'",
                    "rejected": True,
                    "reason": "unknown_friend_id",
                    "attempted_id": friend_id,
                },
            )
            return {
                "error": "unknown_friend_id",
                "message": (
                    f"No user with id '{friend_id}'. Valid friend_ids from list_friends: "
                    f"{valid_ids}. Always copy friend_id verbatim from list_friends — do not invent it."
                ),
            }

        # Step 2: check there's a directed friendship from the recipient back to us
        # (i.e. they've added us as a friend at all).
        friendship = friendships_db.get_friendship(owner_id=friend_id, friend_id=actor_user_id)
        if not friendship:
            log_event(
                type="agent_message_sent",
                actor_user_id=actor_user_id,
                target_user_id=friend_id,
                conversation_id=conversation_id,
                payload={
                    "summary": f"Blocked: {friend_user.get('display_name', friend_id)} hasn't added you",
                    "rejected": True,
                    "reason": "not_friends",
                },
            )
            return {
                "error": "not_friends",
                "message": (
                    f"{friend_user.get('display_name', friend_id)} hasn't added you as a friend, "
                    f"so their agent won't respond."
                ),
            }

        # Step 3: scope check.
        if scope_rank(friendship["scope"]) < scope_rank(scope_required):
            log_event(
                type="agent_message_sent",
                actor_user_id=actor_user_id,
                target_user_id=friend_id,
                conversation_id=conversation_id,
                payload={
                    "summary": (
                        f"Blocked by scope: they have you as '{friendship['scope']}', "
                        f"you asked for '{scope_required}'"
                    ),
                    "rejected": True,
                    "reason": "scope_insufficient",
                    "their_scope_of_me": friendship["scope"],
                    "scope_required": scope_required,
                },
            )
            return {
                "error": "scope_insufficient",
                "message": (
                    f"{friend_user.get('display_name', friend_id)} has you as "
                    f"'{friendship['scope']}', which doesn't cover '{scope_required}'-tier data. "
                    f"Either retry with scope_required='{friendship['scope']}' (and accept the "
                    f"data you can get) or tell your user that {friend_user.get('display_name', friend_id)} "
                    f"hasn't granted them that level of access."
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
        u = now_utc()
        local = now_pacific()
        return {
            "iso_utc": u.isoformat(),
            "iso_local": local.isoformat(),
            "human": local.strftime("%A, %B %d, %Y at %I:%M %p Pacific time"),
            "weekday": local.strftime("%A"),
            "date": local.strftime("%Y-%m-%d"),
            "time": local.strftime("%H:%M"),
            "timezone": "America/Los_Angeles",
        }

    if name == "create_note":
        from db.notes import slugify, VALID_KINDS, get_note_by_slug
        store = get_store()
        note_id = "note_" + new_id()
        body = args.get("body", "")
        title = args["title"]
        tags = args.get("tags", [])
        share_tier = args.get("share_tier")
        if not share_tier:
            if viewer_scope:
                share_tier = _default_share_tier_for_scope(viewer_scope)
            else:
                share_tier = "private"
        kind = args.get("kind") or "note"
        if kind not in VALID_KINDS:
            kind = "note"
        status = args.get("status")
        due_at = args.get("due_at")
        slug = slugify(title)
        # Dedupe slug per user
        if get_note_by_slug(actor_user_id, slug):
            slug = f"{slug}-{new_id()[:6]}"
        storage_path = store.write_note(actor_user_id, note_id, body)
        store.upsert("notes", note_id, {
            "id": note_id,
            "user_id": actor_user_id,
            "title": title,
            "slug": slug,
            "kind": kind,
            "status": status,
            "due_at": due_at,
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
        from db.notes import VALID_KINDS, slugify, get_note_by_slug
        store = get_store()
        note_id = args.get("note_id", "")
        existing = store.get("notes", note_id)
        if not existing or existing.get("user_id") != actor_user_id:
            return {"error": "not_found", "message": "Note not found or not yours."}
        patch = {"updated_at": utcnow_iso()}
        for k in ("title", "tags", "share_tier", "status", "due_at"):
            if k in args and args[k] is not None:
                patch[k] = args[k]
        if args.get("kind") in VALID_KINDS:
            patch["kind"] = args["kind"]
        # If title changes and the slug doesn't exist or matches the OLD title,
        # regenerate slug. Don't overwrite custom slugs.
        if "title" in patch:
            new_slug = slugify(patch["title"])
            if new_slug != existing.get("slug") and not get_note_by_slug(actor_user_id, new_slug):
                patch["slug"] = new_slug
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
            "notes": args.get("notes"),
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

    if name == "ask_user":
        from .telegram_bridge import get_bridge
        from .pending import get_store as _get_pending_store

        question = (args.get("question") or "").strip()
        if not question:
            return {"error": "missing_question"}
        timeout = max(15, min(int(args.get("timeout_seconds") or 120), 300))
        bridge = get_bridge()
        req = await bridge.send_ask(actor_user_id, question)
        if req is None:
            log_event(
                type="user_prompt_skipped",
                actor_user_id=actor_user_id,
                conversation_id=conversation_id,
                payload={"summary": _shorten(question, 80), "kind": "ask", "reason": "no_telegram_link"},
            )
            return {
                "answered": False,
                "text": None,
                "reason": "no_telegram_link",
                "message": "User has no Telegram linked. Make a reasonable assumption and surface it in your reply.",
            }
        log_event(
            type="user_prompt_sent",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={"summary": _shorten(question, 80), "kind": "ask", "request_id": req.id},
        )
        result = await _get_pending_store().wait(req, timeout=timeout)
        if not result.answered and result.reason == "timeout":
            await bridge.send_notice(actor_user_id, "_(Your earlier question timed out — the agent moved on.)_")
        log_event(
            type="user_prompt_answered",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": _shorten(result.text or result.reason or "no answer", 80),
                "kind": "ask",
                "request_id": req.id,
                "answered": result.answered,
            },
        )
        return {
            "answered": result.answered,
            "text": result.text,
            "reason": result.reason,
        }

    if name == "confirm_action":
        from .telegram_bridge import get_bridge
        from .pending import get_store as _get_pending_store

        summary = (args.get("summary") or "").strip()
        if not summary:
            return {"error": "missing_summary"}
        risk = (args.get("risk_level") or "medium").lower()
        if risk not in ("low", "medium", "high"):
            risk = "medium"
        timeout = max(15, min(int(args.get("timeout_seconds") or 120), 300))
        bridge = get_bridge()
        req = await bridge.send_confirm(actor_user_id, summary, risk=risk)
        if req is None:
            log_event(
                type="user_prompt_skipped",
                actor_user_id=actor_user_id,
                conversation_id=conversation_id,
                payload={"summary": _shorten(summary, 80), "kind": "confirm", "risk": risk, "reason": "no_telegram_link"},
            )
            return {
                "answered": False,
                "approved": None,
                "note": None,
                "reason": "no_telegram_link",
                "message": "User has no Telegram linked. Treat this as 'not confirmed' — do not take the action; tell the user you couldn't reach them.",
            }
        log_event(
            type="user_prompt_sent",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={"summary": _shorten(summary, 80), "kind": "confirm", "risk": risk, "request_id": req.id},
        )
        result = await _get_pending_store().wait(req, timeout=timeout)
        if not result.answered and result.reason == "timeout":
            await bridge.send_notice(actor_user_id, "_(Your earlier confirmation timed out — treated as denied.)_")
        log_event(
            type="user_prompt_answered",
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
            payload={
                "summary": _shorten(summary, 80),
                "kind": "confirm",
                "request_id": req.id,
                "answered": result.answered,
                "approved": result.approved,
            },
        )
        return {
            "answered": result.answered,
            "approved": result.approved,
            "note": result.note,
            "reason": result.reason,
        }

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


def _default_share_tier_for_scope(scope: str) -> str:
    """Highest share_tier the given viewer scope can see, used as the inbox-mode
    default when a friend's agent creates a note on the user's behalf."""
    if scope == "family":
        return "family"
    if scope == "close_friend":
        return "close_friends"
    if scope == "friend":
        return "friends"
    # acquaintance can't see scope-tiered notes, so default to public so the
    # requester at least sees the note they asked for.
    return "public"
