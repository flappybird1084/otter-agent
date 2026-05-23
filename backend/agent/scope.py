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


def can_see_note_share_tier(scope: str | None, share_tier: str) -> bool:
    """Returns True iff a viewer with `scope` may read a note with `share_tier`.

    Policy: 'friend' tier viewers may ONLY read public notes — they do not
    get any scoped/tagged notes (titles or bodies). Notes start at close+.

    Tiers from most-restrictive to most-open:
      private        — only the owner
      family         — only family-scoped viewers
      close_friends  — close_friend and above
      friends        — close_friend and above (alias — friend tier no longer
                       sees note content of any kind)
      public         — anyone, even non-friends (no scope required)
    """
    if share_tier == "private":
        return False
    if share_tier == "public":
        return True
    # All scoped/tagged note tiers require at least close_friend.
    if scope_rank(scope) < SCOPE_RANK["close_friend"]:
        return False
    if share_tier == "family":
        return scope_rank(scope) >= SCOPE_RANK["family"]
    # close_friends and friends both gate at close_friend now.
    if share_tier in ("close_friends", "friends"):
        return scope_rank(scope) >= SCOPE_RANK["close_friend"]
    return False


def filter_event_for_viewer(event: dict, viewer_scope: str) -> dict:
    """Return a scope-appropriate view of a calendar event.

    Policy:
      acquaintance: busy/free only
      friend:       title + times, NO location
      close+:       title + times + location
    """
    base = {"start": event["start"], "end": event["end"]}
    rank = scope_rank(viewer_scope)
    visibility = event.get("visibility", "busy_only")

    if rank < SCOPE_RANK["friend"]:
        return {**base, "status": "busy"}
    if visibility == "busy_only" and rank < SCOPE_RANK["close_friend"]:
        return {**base, "status": "busy"}
    if rank < SCOPE_RANK["close_friend"]:
        # Friend tier: title + times, no location.
        return {**base, "title": event.get("title")}
    return {
        **base,
        "title": event.get("title"),
        "location": event.get("location"),
    }
