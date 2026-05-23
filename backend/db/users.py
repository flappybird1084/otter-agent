from __future__ import annotations

from .store import get_store


def get_user(user_id: str) -> dict | None:
    return get_store().get("users", user_id)


def list_users() -> list[dict]:
    return get_store().query("users", order_by=("display_name", "asc"))
