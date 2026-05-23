from __future__ import annotations

from .store import get_store, new_id, utcnow_iso


def create_inbox_message(
    *,
    recipient_user_id: str,
    sender_user_id: str,
    intent: str,
    scope_required: str,
    conversation_id: str,
) -> str:
    return get_store().add(
        "agent_inbox",
        {
            "id": new_id(),
            "recipient_user_id": recipient_user_id,
            "sender_user_id": sender_user_id,
            "intent": intent,
            "scope_required": scope_required,
            "status": "pending",
            "conversation_id": conversation_id,
            "created_at": utcnow_iso(),
        },
    )


def get_inbox_message(inbox_id: str) -> dict | None:
    return get_store().get("agent_inbox", inbox_id)


def update_inbox_message(inbox_id: str, patch: dict) -> None:
    get_store().update("agent_inbox", inbox_id, patch)


def list_inbox_for_user(user_id: str) -> list[dict]:
    return get_store().query(
        "agent_inbox",
        where=[("recipient_user_id", "==", user_id)],
        order_by=("created_at", "desc"),
    )
