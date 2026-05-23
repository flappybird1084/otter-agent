from __future__ import annotations

from .store import get_store


def _date_prefix(s: str | None) -> str:
    """Return the YYYY-MM-DD prefix of an ISO datetime/date string, or ''."""
    return (s or "")[:10]


def list_events(user_id: str, start_iso: str | None = None, end_iso: str | None = None) -> list[dict]:
    """Filter calendar events to [start_iso, end_iso] inclusive on a day basis.

    Bounds may be date-only ("2026-05-24") or full ISO datetimes; we always
    compare on the date prefix so an event at 2026-05-24T10:00 isn't dropped
    by an end_iso of "2026-05-24" (which a naive string compare treats as
    less than "2026-05-24T10..." because "T" sorts after the empty string).
    """
    rows = get_store().query(
        "calendar_events",
        where=[("user_id", "==", user_id)],
        order_by=("start", "asc"),
    )
    if start_iso:
        lo = _date_prefix(start_iso)
        rows = [r for r in rows if _date_prefix(r.get("end") or r.get("start")) >= lo]
    if end_iso:
        hi = _date_prefix(end_iso)
        rows = [r for r in rows if _date_prefix(r.get("start")) <= hi]
    return rows
