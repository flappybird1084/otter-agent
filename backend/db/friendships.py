from __future__ import annotations

from .store import get_store


def friendship_id(owner_id: str, friend_id: str) -> str:
    return f"{owner_id}__{friend_id}"


def get_friendship(owner_id: str, friend_id: str) -> dict | None:
    return get_store().get("friendships", friendship_id(owner_id, friend_id))


def list_friends(owner_id: str) -> list[dict]:
    return get_store().query(
        "friendships",
        where=[("owner_id", "==", owner_id)],
    )


def set_scope(owner_id: str, friend_id: str, scope: str) -> None:
    get_store().update(
        "friendships",
        friendship_id(owner_id, friend_id),
        {"scope": scope},
    )
