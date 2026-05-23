from __future__ import annotations

from .store import get_store


def list_events(user_id: str, start_iso: str | None = None, end_iso: str | None = None) -> list[dict]:
    rows = get_store().query(
        "calendar_events",
        where=[("user_id", "==", user_id)],
        order_by=("start", "asc"),
    )
    # Stored events are full ISO timestamps ("2026-05-25T09:00:00-07:00") but
    # callers usually pass date-only strings ("2026-05-25"). Normalize the bare
    # dates so the string comparison includes events on the boundary day —
    # otherwise asking "is X free on Monday?" silently misses every Monday event.
    if end_iso and "T" not in end_iso:
        end_iso = end_iso + "T23:59:59"
    if start_iso and "T" not in start_iso:
        start_iso = start_iso + "T00:00:00"
    if start_iso:
        rows = [r for r in rows if (r.get("end") or r.get("start", "")) >= start_iso]
    if end_iso:
        rows = [r for r in rows if r.get("start", "") <= end_iso]
    return rows
