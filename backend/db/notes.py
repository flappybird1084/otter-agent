from __future__ import annotations

import re

from .store import get_store


def slugify(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return (s[:80]) or "untitled"


VALID_KINDS = ("note", "daily", "project", "task", "person")


def get_note_by_slug(user_id: str, slug: str) -> dict | None:
    rows = get_store().query(
        "notes",
        where=[("user_id", "==", user_id)],
    )
    for r in rows:
        if r.get("slug") == slug:
            return r
    return None


def list_notes(user_id: str) -> list[dict]:
    rows = get_store().query(
        "notes",
        where=[("user_id", "==", user_id)],
    )
    # Sort by sort_index ascending if set; otherwise fall back to updated_at desc.
    def key(r):
        si = r.get("sort_index")
        has_si = isinstance(si, (int, float))
        # primary: 0 for has-sort_index, 1 for fallback (so explicit comes first)
        # secondary: sort_index or 0; tertiary: -updated_at for desc fallback
        return (
            0 if has_si else 1,
            si if has_si else 0,
            -_iso_to_epoch(r.get("updated_at")),
        )
    return sorted(rows, key=key)


def _iso_to_epoch(s: str | None) -> float:
    if not s:
        return 0.0
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def next_sort_index(user_id: str) -> float:
    """Returns a sort_index that places a new/moved note at the end."""
    rows = list_notes(user_id)
    mx = 0.0
    for r in rows:
        si = r.get("sort_index")
        if isinstance(si, (int, float)) and si > mx:
            mx = si
    return mx + 1.0


def get_note(note_id: str) -> dict | None:
    return get_store().get("notes", note_id)


def read_note_body(note_id: str) -> str:
    note = get_note(note_id)
    if not note:
        return ""
    return get_store().read_note(note["user_id"], note["id"])


def search_notes(user_id: str, query: str, limit: int = 5) -> list[dict]:
    """Naive substring + tag search over title/tags/body."""
    store = get_store()
    all_notes = list_notes(user_id)
    q = (query or "").strip().lower()
    if not q:
        return all_notes[:limit]

    scored: list[tuple[int, dict]] = []
    terms = [t for t in q.replace(",", " ").split() if t]
    for note in all_notes:
        title = (note.get("title") or "").lower()
        tags = [t.lower() for t in note.get("tags", [])]
        score = 0
        for term in terms:
            if term in title:
                score += 3
            if any(term == tag or term in tag for tag in tags):
                score += 4
        if score == 0:
            body = store.read_note(user_id, note["id"]).lower()
            for term in terms:
                if term in body:
                    score += 1
        if score > 0:
            scored.append((score, note))

    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for _, note in scored[:limit]:
        body = store.read_note(user_id, note["id"])
        snippet = body[:240].replace("\n", " ").strip()
        out.append({
            "id": note["id"],
            "title": note.get("title"),
            "tags": note.get("tags", []),
            "snippet": snippet,
        })
    return out
