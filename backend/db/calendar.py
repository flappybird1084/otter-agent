from __future__ import annotations

from .store import get_store


def list_events(user_id: str, start_iso: str | None = None, end_iso: str | None = None) -> list[dict]:
    rows = get_store().query(
        "calendar_events",
        where=[("user_id", "==", user_id)],
        order_by=("start", "asc"),
    )
    if start_iso:
        rows = [r for r in rows if (r.get("end") or r.get("start", "")) >= start_iso]
    if end_iso:
        rows = [r for r in rows if r.get("start", "") <= end_iso]
    return rows
