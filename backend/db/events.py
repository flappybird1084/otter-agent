"""Agent event feed — drives the live visualization."""
from __future__ import annotations

from typing import Any

from .store import get_store, new_id, utcnow_iso


def log_event(
    *,
    type: str,
    actor_user_id: str,
    conversation_id: str,
    target_user_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> str:
    store = get_store()
    return store.add(
        "agent_events",
        {
            "id": new_id(),
            "type": type,
            "actor_user_id": actor_user_id,
            "target_user_id": target_user_id,
            "payload": payload or {},
            "conversation_id": conversation_id,
            "created_at": utcnow_iso(),
        },
    )


def list_events(limit: int = 50) -> list[dict]:
    store = get_store()
    return store.query(
        "agent_events",
        order_by=("created_at", "desc"),
        limit=limit,
    )
