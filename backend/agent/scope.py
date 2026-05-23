"""Trust scopes and scope-aware filtering."""
from __future__ import annotations

SCOPE_RANK = {
    "acquaintance": 1,
    "friend": 2,
    "close_friend": 3,
    "family": 4,
}


def scope_rank(scope: str | None) -> int:
    return SCOPE_RANK.get(scope or "", 0)


def can_see_calendar_titles(scope: str) -> bool:
    return scope_rank(scope) >= SCOPE_RANK["friend"]


def can_see_note_share_tier(scope: str, share_tier: str) -> bool:
    if share_tier == "private":
        return False
    if share_tier == "family":
        return scope_rank(scope) >= SCOPE_RANK["family"]
    if share_tier == "close_friends":
        return scope_rank(scope) >= SCOPE_RANK["close_friend"]
    if share_tier == "friends":
        return scope_rank(scope) >= SCOPE_RANK["friend"]
    return False


def filter_event_for_viewer(event: dict, viewer_scope: str) -> dict:
    """Return a scope-appropriate view of a calendar event."""
    base = {"start": event["start"], "end": event["end"]}
    rank = scope_rank(viewer_scope)
    visibility = event.get("visibility", "busy_only")

    if rank < SCOPE_RANK["friend"]:
        return {**base, "status": "busy"}
    if visibility == "busy_only" and rank < SCOPE_RANK["close_friend"]:
        return {**base, "status": "busy"}
    return {
        **base,
        "title": event.get("title"),
        "location": event.get("location"),
    }
