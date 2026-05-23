from __future__ import annotations

from .store import get_store, new_id, utcnow_iso


def write_chat_message(user_id: str, role: str, content: str, conversation_id: str) -> str:
    return get_store().add(
        "chat_messages",
        {
            "id": new_id(),
            "user_id": user_id,
            "role": role,
            "content": content,
            "conversation_id": conversation_id,
            "created_at": utcnow_iso(),
        },
    )


def list_chat_messages(user_id: str, limit: int = 50) -> list[dict]:
    rows = get_store().query(
        "chat_messages",
        where=[("user_id", "==", user_id)],
        order_by=("created_at", "asc"),
    )
    return rows[-limit:]
