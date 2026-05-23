"""Seed Firestore (or the local JSON store) with the demo dataset.

Run via:
    python -m seed.seed
or:
    curl -X POST http://localhost:8080/seed
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from db.store import get_store
from db.friendships import friendship_id


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

USERS = [
    {
        "id": "user_maya",
        "display_name": "Maya Chen",
        "handle": "@maya",
        "avatar_emoji": "🦊",
        "bio": "CS major. Always behind on problem sets.",
    },
    {
        "id": "user_priya",
        "display_name": "Priya Patel",
        "handle": "@priya",
        "avatar_emoji": "🦉",
        "bio": "Pre-med + CS minor. Has very nice notes.",
    },
    {
        "id": "user_devon",
        "display_name": "Devon Kim",
        "handle": "@devon",
        "avatar_emoji": "🐻",
        "bio": "Studies whenever, wherever.",
    },
]


FRIENDSHIPS = [
    ("user_maya", "user_priya", "close_friend"),
    ("user_priya", "user_maya", "close_friend"),
    ("user_maya", "user_devon", "friend"),
    ("user_devon", "user_maya", "friend"),
    ("user_priya", "user_devon", "acquaintance"),
    ("user_devon", "user_priya", "acquaintance"),
]


# ---------------------------------------------------------------------------
# calendar — anchored relative to "today" so the demo always has fresh events.
# ---------------------------------------------------------------------------

def _at(day_offset: int, hour: int, minute: int = 0) -> str:
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return (base + timedelta(days=day_offset, hours=hour, minutes=minute)).isoformat()


# Carefully hand-placed so that:
#   - Maya & Priya have a clear shared 2h window Wed (day+4) 15-17 and Sat (day+7) 10-12.
#   - Maya & Devon don't overlap prime hours.
CALENDAR: list[dict] = [
    # ----- Maya -----
    {"user_id": "user_maya", "title": "CS161 Lecture", "start": _at(1, 10), "end": _at(1, 11, 30), "location": "Gates B01", "visibility": "full"},
    {"user_id": "user_maya", "title": "Lunch w/ Devon", "start": _at(1, 12, 30), "end": _at(1, 13, 30), "location": "Tresidder", "visibility": "title_and_time"},
    {"user_id": "user_maya", "title": "Office hours", "start": _at(2, 14), "end": _at(2, 15), "visibility": "full"},
    {"user_id": "user_maya", "title": "CS161 Lecture", "start": _at(3, 10), "end": _at(3, 11, 30), "location": "Gates B01", "visibility": "full"},
    {"user_id": "user_maya", "title": "Gym", "start": _at(3, 17), "end": _at(3, 18, 30), "visibility": "busy_only"},
    {"user_id": "user_maya", "title": "Therapy", "start": _at(4, 9), "end": _at(4, 10), "visibility": "busy_only"},
    {"user_id": "user_maya", "title": "CS161 Section", "start": _at(4, 13), "end": _at(4, 14), "location": "Gates 104", "visibility": "full"},
    {"user_id": "user_maya", "title": "Dinner w/ family", "start": _at(5, 19), "end": _at(5, 21), "visibility": "title_and_time"},
    {"user_id": "user_maya", "title": "Brunch", "start": _at(7, 12), "end": _at(7, 13, 30), "visibility": "title_and_time"},
    {"user_id": "user_maya", "title": "Run", "start": _at(8, 7), "end": _at(8, 8), "visibility": "busy_only"},
    {"user_id": "user_maya", "title": "Dentist", "start": _at(9, 11), "end": _at(9, 12), "visibility": "busy_only"},
    {"user_id": "user_maya", "title": "CS161 Lecture", "start": _at(10, 10), "end": _at(10, 11, 30), "visibility": "full"},

    # ----- Priya -----
    {"user_id": "user_priya", "title": "Orgo lab", "start": _at(1, 14), "end": _at(1, 17), "location": "Sapp 105", "visibility": "full"},
    {"user_id": "user_priya", "title": "MCAT prep", "start": _at(2, 9), "end": _at(2, 11), "visibility": "full"},
    {"user_id": "user_priya", "title": "CS161 Lecture", "start": _at(3, 10), "end": _at(3, 11, 30), "location": "Gates B01", "visibility": "full"},
    {"user_id": "user_priya", "title": "Volunteer (hospital)", "start": _at(3, 18), "end": _at(3, 21), "visibility": "title_and_time"},
    # Wed 15-17 → free, matches a Maya free window
    {"user_id": "user_priya", "title": "CS161 Section", "start": _at(4, 13), "end": _at(4, 14), "location": "Gates 104", "visibility": "full"},
    {"user_id": "user_priya", "title": "Coffee chat", "start": _at(4, 16), "end": _at(4, 16, 45), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "Dinner w/ family", "start": _at(5, 18), "end": _at(5, 20), "visibility": "title_and_time"},
    # Sat 10-12 → free, matches a Maya free window
    {"user_id": "user_priya", "title": "Brunch w/ Lila", "start": _at(7, 13), "end": _at(7, 14, 30), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "Run", "start": _at(8, 7), "end": _at(8, 8), "visibility": "busy_only"},
    {"user_id": "user_priya", "title": "Orgo lab", "start": _at(8, 14), "end": _at(8, 17), "visibility": "full"},
    {"user_id": "user_priya", "title": "Dr. appt", "start": _at(9, 10), "end": _at(9, 11), "visibility": "busy_only"},
    {"user_id": "user_priya", "title": "CS161 Lecture", "start": _at(10, 10), "end": _at(10, 11, 30), "visibility": "full"},

    # ----- Devon -----
    {"user_id": "user_devon", "title": "Music theory", "start": _at(1, 9), "end": _at(1, 10, 30), "visibility": "full"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(2, 15), "end": _at(2, 18), "location": "Braun Hall", "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Open mic", "start": _at(3, 19), "end": _at(3, 22), "visibility": "full"},
    {"user_id": "user_devon", "title": "Music theory", "start": _at(4, 9), "end": _at(4, 10, 30), "visibility": "full"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(4, 15), "end": _at(4, 18), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Recording session", "start": _at(5, 14), "end": _at(5, 18), "visibility": "full"},
    {"user_id": "user_devon", "title": "Brunch", "start": _at(7, 11), "end": _at(7, 13), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Yoga", "start": _at(8, 9), "end": _at(8, 10), "visibility": "busy_only"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(8, 15), "end": _at(8, 18), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Music theory", "start": _at(10, 9), "end": _at(10, 10, 30), "visibility": "full"},
]


# ---------------------------------------------------------------------------
# notes — metadata; markdown bodies live in seed/notes/<user>/<id>.md
# ---------------------------------------------------------------------------

NOTES: list[dict] = [
    # ----- Maya -----
    {"id": "note_maya_cs161_midterm", "user_id": "user_maya", "title": "CS161 Midterm Prep", "tags": ["cs161", "midterm", "lecture"], "share_tier": "friends"},
    {"id": "note_maya_project_ideas", "user_id": "user_maya", "title": "Side project ideas", "tags": ["projects"], "share_tier": "close_friends"},
    {"id": "note_maya_journal", "user_id": "user_maya", "title": "Journal — this week", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_maya_todo", "user_id": "user_maya", "title": "This week's TODOs", "tags": ["todo"], "share_tier": "close_friends"},
    {"id": "note_maya_cs109_review", "user_id": "user_maya", "title": "CS109 — probability review", "tags": ["cs109"], "share_tier": "friends"},
    {"id": "note_maya_recipe", "user_id": "user_maya", "title": "Mom's dal recipe", "tags": ["recipe"], "share_tier": "family"},

    # ----- Priya -----
    {"id": "note_priya_cs161_midterm", "user_id": "user_priya", "title": "CS161 Midterm — clean notes", "tags": ["cs161", "midterm"], "share_tier": "close_friends"},
    {"id": "note_priya_orgo", "user_id": "user_priya", "title": "Orgo mechanisms cheat sheet", "tags": ["orgo"], "share_tier": "friends"},
    {"id": "note_priya_mcat", "user_id": "user_priya", "title": "MCAT plan", "tags": ["mcat"], "share_tier": "close_friends"},
    {"id": "note_priya_journal", "user_id": "user_priya", "title": "Journal", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_priya_volunteer", "user_id": "user_priya", "title": "Hospital volunteer hours", "tags": ["volunteer"], "share_tier": "friends"},
    {"id": "note_priya_cs161_dp", "user_id": "user_priya", "title": "Dynamic programming — worked examples", "tags": ["cs161", "dp"], "share_tier": "close_friends"},

    # ----- Devon -----
    {"id": "note_devon_setlist", "user_id": "user_devon", "title": "Open mic setlist", "tags": ["music"], "share_tier": "friends"},
    {"id": "note_devon_recording", "user_id": "user_devon", "title": "Recording session plan", "tags": ["music", "recording"], "share_tier": "close_friends"},
    {"id": "note_devon_lyrics", "user_id": "user_devon", "title": "Lyrics — draft", "tags": ["music", "lyrics"], "share_tier": "private"},
    {"id": "note_devon_essay", "user_id": "user_devon", "title": "Essay outline", "tags": ["writing"], "share_tier": "close_friends"},
    {"id": "note_devon_packing", "user_id": "user_devon", "title": "Packing list — tour", "tags": ["travel"], "share_tier": "friends"},
    {"id": "note_devon_journal", "user_id": "user_devon", "title": "Journal", "tags": ["journal"], "share_tier": "private"},
]


def run() -> None:
    store = get_store()
    store.wipe()

    for u in USERS:
        store.upsert("users", u["id"], u)

    for owner, friend, scope in FRIENDSHIPS:
        fid = friendship_id(owner, friend)
        store.upsert("friendships", fid, {
            "id": fid, "owner_id": owner, "friend_id": friend, "scope": scope,
        })

    for ev in CALENDAR:
        store.add("calendar_events", {**ev, "status": "confirmed"})

    notes_root = Path(os.environ.get("LOCAL_NOTES_PATH", "./seed/notes")).resolve()
    bundled_root = Path(__file__).parent / "notes"

    for n in NOTES:
        body = _read_bundled_markdown(bundled_root, n["user_id"], n["id"])
        if os.environ.get("STORE_BACKEND", "local").lower() == "firestore":
            # Push to Cloud Storage
            storage_path = store.write_note(n["user_id"], n["id"], body)
        else:
            # In local mode, copy into the notes root so reads find them.
            target = notes_root / n["user_id"] / f"{n['id']}.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body)
            storage_path = f"local://{target}"
        store.upsert("notes", n["id"], {
            **n,
            "storage_path": storage_path,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    print(f"Seeded {len(USERS)} users, {len(FRIENDSHIPS)} friendships, "
          f"{len(CALENDAR)} events, {len(NOTES)} notes.")


def _read_bundled_markdown(root: Path, user_id: str, note_id: str) -> str:
    p = root / user_id / f"{note_id}.md"
    if p.exists():
        return p.read_text()
    return f"# {note_id}\n\n(placeholder body)\n"


if __name__ == "__main__":
    run()
