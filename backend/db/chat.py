from __future__ import annotations

from .store import get_store, new_id, utcnow_iso


def write_chat_message(
    user_id: str,
    role: str,
    content: str,
    conversation_id: str,
    *,
    target_user_id: str | None = None,
) -> str:
    """Persist a chat message.

    target_user_id distinguishes:
      - None  → self-chat (you talking to your own agent)
      - <id>  → direct-chat thread between user_id (sender) and target_user_id
                (whose agent is replying). Both sides of the thread live here.
    """
    return get_store().add(
        "chat_messages",
        {
            "id": new_id(),
            "user_id": user_id,
            "target_user_id": target_user_id,
            "role": role,
            "content": content,
            "conversation_id": conversation_id,
            "created_at": utcnow_iso(),
        },
    )


def list_chat_messages(user_id: str, limit: int = 50) -> list[dict]:
    """All self-chat messages for a user (target_user_id is null)."""
    rows = get_store().query(
        "chat_messages",
        where=[("user_id", "==", user_id)],
        order_by=("created_at", "asc"),
    )
    rows = [r for r in rows if r.get("target_user_id") in (None, "")]
    return rows[-limit:]


def list_chat_messages_for_conversation(user_id: str, conversation_id: str) -> list[dict]:
    rows = get_store().query(
        "chat_messages",
        where=[("user_id", "==", user_id)],
        order_by=("created_at", "asc"),
    )
    return [
        r for r in rows
        if r.get("conversation_id") == conversation_id
        and r.get("target_user_id") in (None, "")
    ]


def list_direct_chat_messages(
    sender_user_id: str,
    recipient_user_id: str,
    conversation_id: str | None = None,
) -> list[dict]:
    rows = get_store().query(
        "chat_messages",
        where=[("user_id", "==", sender_user_id)],
        order_by=("created_at", "asc"),
    )
    rows = [r for r in rows if r.get("target_user_id") == recipient_user_id]
    if conversation_id:
        rows = [r for r in rows if r.get("conversation_id") == conversation_id]
    return rows


def delete_direct_chat(
    sender_user_id: str,
    recipient_user_id: str,
    conversation_id: str | None = None,
) -> int:
    store = get_store()
    rows = store.query(
        "chat_messages",
        where=[("user_id", "==", sender_user_id)],
    )
    n = 0
    for r in rows:
        if r.get("target_user_id") != recipient_user_id:
            continue
        if conversation_id and r.get("conversation_id") != conversation_id:
            continue
        store.delete("chat_messages", r["id"])
        n += 1
    return n


def delete_self_chat(user_id: str, conversation_id: str | None = None) -> int:
    store = get_store()
    rows = store.query("chat_messages", where=[("user_id", "==", user_id)])
    n = 0
    for r in rows:
        if r.get("target_user_id") not in (None, ""):
            continue
        if conversation_id and r.get("conversation_id") != conversation_id:
            continue
        store.delete("chat_messages", r["id"])
        n += 1
    return n
