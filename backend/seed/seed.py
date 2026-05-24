"""Seed Firestore (or the local JSON store) with the demo dataset.

Run via:
    python -m seed.seed
or:
    curl -X POST http://localhost:8080/seed

7 users, dense friendship graph with intentional asymmetry (every scope tier
gets exercised in both directions somewhere), ~10 calendar events per user,
~9 notes per user across all kinds + tiers. Note bodies are inline below so
we don't have to scatter 60 markdown files on disk — a per-user folder of
real bundled markdown still takes priority if present (existing files in
seed/notes/<user>/ stay authoritative).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from db.store import get_store
from db.friendships import friendship_id
from agent.timeutil import now_pacific


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
        "email": "maya@demo.local",
    },
    {
        "id": "user_priya",
        "display_name": "Priya Patel",
        "handle": "@priya",
        "avatar_emoji": "🦉",
        "bio": "Pre-med + CS minor. Has very nice notes.",
        "email": "devstar1042@gcplab.me",
    },
    {
        "id": "user_devon",
        "display_name": "Devon Kim",
        "handle": "@devon",
        "avatar_emoji": "🐻",
        "bio": "Studies whenever, wherever. Plays guitar.",
        "email": "devon@demo.local",
    },
    {
        "id": "user_aisha",
        "display_name": "Aisha Williams",
        "handle": "@aisha",
        "avatar_emoji": "🦋",
        "bio": "Bio grad student in the Levinson lab. Lives on coffee + Western blots.",
        "email": "aisha@demo.local",
    },
    {
        "id": "user_theo",
        "display_name": "Theo Romano",
        "handle": "@theo",
        "avatar_emoji": "🐙",
        "bio": "Startup eng + part-time bassist for Devon's band.",
        "email": "theo@demo.local",
    },
    {
        "id": "user_naomi",
        "display_name": "Naomi Park",
        "handle": "@naomi",
        "avatar_emoji": "🌸",
        "bio": "Design senior. Makes posters at 2am, ferments hot sauce on weekends.",
        "email": "naomi@demo.local",
    },
    {
        "id": "user_jordan",
        "display_name": "Jordan Chen",
        "handle": "@jordan",
        "avatar_emoji": "🐢",
        "bio": "Maya's little sibling. High school senior. Reluctant captain of debate club.",
        "email": "jordan@demo.local",
    },
]


# Directed edges (owner -> friend, scope). Asymmetry is intentional: pairs
# differ in how each side sees the other so the demo can show that "their
# scope of me" governs what you can read from them.
FRIENDSHIPS = [
    # Maya <-> Priya: mutual close friends (study buddies + roommates).
    ("user_maya", "user_priya", "close_friend"),
    ("user_priya", "user_maya", "close_friend"),

    # Maya <-> Devon: friend-tier on both sides (good friends, not inner circle).
    ("user_maya", "user_devon", "friend"),
    ("user_devon", "user_maya", "friend"),

    # Maya <-> Aisha: mutual friends. Maya looks up to her, Aisha mentors her.
    ("user_maya", "user_aisha", "friend"),
    ("user_aisha", "user_maya", "friend"),

    # Maya <-> Theo: mutual acquaintances (met through Devon).
    ("user_maya", "user_theo", "acquaintance"),
    ("user_theo", "user_maya", "acquaintance"),

    # Maya <-> Naomi: ASYMMETRIC. Maya sees Naomi as close_friend (overshare),
    # Naomi sees Maya as friend (more cautious). Great teaching example.
    ("user_maya", "user_naomi", "close_friend"),
    ("user_naomi", "user_maya", "friend"),

    # Maya <-> Jordan: family (sibling).
    ("user_maya", "user_jordan", "family"),
    ("user_jordan", "user_maya", "family"),

    # Priya <-> Devon: mutual acquaintances (overlap via Maya).
    ("user_priya", "user_devon", "acquaintance"),
    ("user_devon", "user_priya", "acquaintance"),

    # Priya <-> Aisha: mutual close friends (lab + study group).
    ("user_priya", "user_aisha", "close_friend"),
    ("user_aisha", "user_priya", "close_friend"),

    # Priya <-> Naomi: mutual friends (yoga classmates).
    ("user_priya", "user_naomi", "friend"),
    ("user_naomi", "user_priya", "friend"),

    # Devon <-> Theo: mutual close friends (bandmates).
    ("user_devon", "user_theo", "close_friend"),
    ("user_theo", "user_devon", "close_friend"),

    # Devon <-> Naomi: mutual friends (Naomi designs his show posters).
    ("user_devon", "user_naomi", "friend"),
    ("user_naomi", "user_devon", "friend"),

    # Theo <-> Naomi: ASYMMETRIC. Theo sees Naomi as friend, Naomi sees Theo
    # as acquaintance (one-sided crush perhaps; just met).
    ("user_theo", "user_naomi", "friend"),
    ("user_naomi", "user_theo", "acquaintance"),

    # Aisha <-> Naomi: acquaintances (met once at a yoga studio).
    ("user_aisha", "user_naomi", "acquaintance"),
    ("user_naomi", "user_aisha", "acquaintance"),

    # Jordan <-> Priya: friend (knows Priya through Maya, hangs out at home).
    ("user_jordan", "user_priya", "friend"),
    ("user_priya", "user_jordan", "friend"),
]


# ---------------------------------------------------------------------------
# calendar — anchored relative to "today" so the demo always has fresh events.
# ---------------------------------------------------------------------------

def _at(day_offset: int, hour: int, minute: int = 0) -> str:
    """Anchor at *Pacific* midnight so hour=10 means 10 AM PDT, not UTC."""
    base = now_pacific().replace(hour=0, minute=0, second=0, microsecond=0)
    return (base + timedelta(days=day_offset, hours=hour, minutes=minute)).isoformat()


# Carefully hand-placed so that:
#   - Maya & Priya have a clear shared 2h window Wed (day+4) 15-17 and Sat (day+7) 10-12.
#   - Maya & Devon don't overlap prime hours.
#   - Aisha runs a Tue/Thu/Fri lab; Priya joins on Mon evenings.
#   - Theo's startup standups are M/W/F 9am; band practice with Devon Tue 7pm.
#   - Naomi has a Thu studio crit; otherwise wide open.
#   - Jordan's high school day runs 8-3 weekdays, debate Mon/Thu after school.
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
    {"user_id": "user_priya", "title": "Orgo lab", "start": _at(1, 14), "end": _at(1, 17), "location": "Sapp 105", "visibility": "full", "notes": "Bring lab notebook + safety goggles. Synthesis week 4."},
    {"user_id": "user_priya", "title": "MCAT prep", "start": _at(2, 9), "end": _at(2, 11), "visibility": "full", "notes": "Verbal section, full-length practice."},
    {"user_id": "user_priya", "title": "CS161 Lecture", "start": _at(3, 10), "end": _at(3, 11, 30), "location": "Gates B01", "visibility": "full"},
    {"user_id": "user_priya", "title": "Volunteer (hospital)", "start": _at(3, 18), "end": _at(3, 21), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "CS161 Section", "start": _at(4, 13), "end": _at(4, 14), "location": "Gates 104", "visibility": "full"},
    {"user_id": "user_priya", "title": "Coffee chat", "start": _at(4, 16), "end": _at(4, 16, 45), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "Dinner w/ family", "start": _at(5, 18), "end": _at(5, 20), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "Brunch w/ Lila", "start": _at(7, 13), "end": _at(7, 14, 30), "visibility": "title_and_time"},
    {"user_id": "user_priya", "title": "Run", "start": _at(8, 7), "end": _at(8, 8), "visibility": "busy_only"},
    {"user_id": "user_priya", "title": "Orgo lab", "start": _at(8, 14), "end": _at(8, 17), "visibility": "full"},
    {"user_id": "user_priya", "title": "Dr. appt", "start": _at(9, 10), "end": _at(9, 11), "visibility": "busy_only"},
    {"user_id": "user_priya", "title": "CS161 Lecture", "start": _at(10, 10), "end": _at(10, 11, 30), "visibility": "full"},

    # ----- Devon -----
    {"user_id": "user_devon", "title": "Music theory", "start": _at(1, 9), "end": _at(1, 10, 30), "visibility": "full"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(2, 15), "end": _at(2, 18), "location": "Braun Hall", "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Band practice w/ Theo", "start": _at(2, 19), "end": _at(2, 21), "location": "Theo's garage", "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Open mic", "start": _at(3, 19), "end": _at(3, 22), "visibility": "full"},
    {"user_id": "user_devon", "title": "Music theory", "start": _at(4, 9), "end": _at(4, 10, 30), "visibility": "full"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(4, 15), "end": _at(4, 18), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Recording session", "start": _at(5, 14), "end": _at(5, 18), "visibility": "full"},
    {"user_id": "user_devon", "title": "Brunch", "start": _at(7, 11), "end": _at(7, 13), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Yoga", "start": _at(8, 9), "end": _at(8, 10), "visibility": "busy_only"},
    {"user_id": "user_devon", "title": "Rehearsal", "start": _at(8, 15), "end": _at(8, 18), "visibility": "title_and_time"},
    {"user_id": "user_devon", "title": "Music theory", "start": _at(10, 9), "end": _at(10, 10, 30), "visibility": "full"},

    # ----- Aisha -----
    {"user_id": "user_aisha", "title": "Lab work — Western blots", "start": _at(1, 9), "end": _at(1, 13), "location": "Bio Eng 220", "visibility": "full"},
    {"user_id": "user_aisha", "title": "Lab meeting", "start": _at(1, 14), "end": _at(1, 15, 30), "visibility": "full"},
    {"user_id": "user_aisha", "title": "Mentor Priya — orgo", "start": _at(1, 19), "end": _at(1, 20), "visibility": "title_and_time"},
    {"user_id": "user_aisha", "title": "Lab work — cell culture", "start": _at(3, 9), "end": _at(3, 12), "visibility": "full"},
    {"user_id": "user_aisha", "title": "Office hours (TA: Bio121)", "start": _at(3, 15), "end": _at(3, 16, 30), "location": "Sapp 220", "visibility": "full"},
    {"user_id": "user_aisha", "title": "Lab work", "start": _at(4, 9), "end": _at(4, 13), "visibility": "full"},
    {"user_id": "user_aisha", "title": "Journal club", "start": _at(4, 15), "end": _at(4, 16, 30), "visibility": "full"},
    {"user_id": "user_aisha", "title": "Lab work", "start": _at(5, 9), "end": _at(5, 13), "visibility": "full"},
    {"user_id": "user_aisha", "title": "Hiking w/ housemates", "start": _at(7, 9), "end": _at(7, 14), "visibility": "title_and_time"},
    {"user_id": "user_aisha", "title": "Lab catch-up", "start": _at(8, 10), "end": _at(8, 13), "visibility": "busy_only"},

    # ----- Theo -----
    {"user_id": "user_theo", "title": "Standup", "start": _at(1, 9), "end": _at(1, 9, 30), "visibility": "full"},
    {"user_id": "user_theo", "title": "Deep work — checkout flow", "start": _at(1, 10), "end": _at(1, 13), "visibility": "full"},
    {"user_id": "user_theo", "title": "Investor coffee", "start": _at(1, 16), "end": _at(1, 17), "location": "Philz Forest Ave", "visibility": "title_and_time"},
    {"user_id": "user_theo", "title": "Band practice w/ Devon", "start": _at(2, 19), "end": _at(2, 21), "visibility": "title_and_time"},
    {"user_id": "user_theo", "title": "Standup", "start": _at(3, 9), "end": _at(3, 9, 30), "visibility": "full"},
    {"user_id": "user_theo", "title": "Customer call (Acme)", "start": _at(3, 11), "end": _at(3, 12), "visibility": "title_and_time"},
    {"user_id": "user_theo", "title": "Deep work — auth refactor", "start": _at(4, 10), "end": _at(4, 13), "visibility": "full"},
    {"user_id": "user_theo", "title": "Standup", "start": _at(5, 9), "end": _at(5, 9, 30), "visibility": "full"},
    {"user_id": "user_theo", "title": "Pitch dress-rehearsal", "start": _at(5, 16), "end": _at(5, 17, 30), "visibility": "full"},
    {"user_id": "user_theo", "title": "Long run", "start": _at(7, 8), "end": _at(7, 10), "visibility": "busy_only"},

    # ----- Naomi -----
    {"user_id": "user_naomi", "title": "Studio open hours", "start": _at(1, 10), "end": _at(1, 13), "location": "Design Loft", "visibility": "full"},
    {"user_id": "user_naomi", "title": "Yoga w/ Priya", "start": _at(2, 8), "end": _at(2, 9), "visibility": "title_and_time"},
    {"user_id": "user_naomi", "title": "Client call (poster)", "start": _at(2, 14), "end": _at(2, 15), "visibility": "title_and_time"},
    {"user_id": "user_naomi", "title": "Critique session", "start": _at(4, 13), "end": _at(4, 16), "location": "Design Loft", "visibility": "full"},
    {"user_id": "user_naomi", "title": "Coffee w/ Devon", "start": _at(4, 17), "end": _at(4, 18), "visibility": "title_and_time"},
    {"user_id": "user_naomi", "title": "Pottery class", "start": _at(5, 18), "end": _at(5, 20), "visibility": "title_and_time"},
    {"user_id": "user_naomi", "title": "Farmer's market", "start": _at(7, 9), "end": _at(7, 11), "visibility": "title_and_time"},
    {"user_id": "user_naomi", "title": "Studio open hours", "start": _at(8, 10), "end": _at(8, 13), "visibility": "full"},
    {"user_id": "user_naomi", "title": "Friend's birthday", "start": _at(8, 19), "end": _at(8, 22), "visibility": "busy_only"},
    {"user_id": "user_naomi", "title": "Yoga", "start": _at(9, 8), "end": _at(9, 9), "visibility": "busy_only"},

    # ----- Jordan -----
    {"user_id": "user_jordan", "title": "School", "start": _at(1, 8), "end": _at(1, 15), "visibility": "busy_only"},
    {"user_id": "user_jordan", "title": "Debate practice", "start": _at(1, 16), "end": _at(1, 18), "location": "Lincoln HS rm 204", "visibility": "title_and_time"},
    {"user_id": "user_jordan", "title": "School", "start": _at(2, 8), "end": _at(2, 15), "visibility": "busy_only"},
    {"user_id": "user_jordan", "title": "Tutoring (calc)", "start": _at(2, 16), "end": _at(2, 17), "visibility": "title_and_time"},
    {"user_id": "user_jordan", "title": "School", "start": _at(3, 8), "end": _at(3, 15), "visibility": "busy_only"},
    {"user_id": "user_jordan", "title": "School", "start": _at(4, 8), "end": _at(4, 15), "visibility": "busy_only"},
    {"user_id": "user_jordan", "title": "Debate practice", "start": _at(4, 16), "end": _at(4, 18), "visibility": "title_and_time"},
    {"user_id": "user_jordan", "title": "Mock debate tournament", "start": _at(7, 8), "end": _at(7, 17), "location": "Berkeley HS", "visibility": "full"},
    {"user_id": "user_jordan", "title": "Movie w/ friends", "start": _at(7, 19), "end": _at(7, 22), "visibility": "title_and_time"},
    {"user_id": "user_jordan", "title": "School", "start": _at(8, 8), "end": _at(8, 15), "visibility": "busy_only"},
]


# ---------------------------------------------------------------------------
# notes — metadata; bodies live inline (BODIES dict at bottom) or in
# seed/notes/<user>/<id>.md (bundled markdown wins if present).
# ---------------------------------------------------------------------------

NOTES: list[dict] = [
    # ----- Maya (9) -----
    {"id": "note_maya_cs161_midterm", "user_id": "user_maya", "title": "CS161 Midterm Prep", "slug": "cs161-midterm-prep", "kind": "project", "tags": ["cs161", "midterm", "lecture"], "share_tier": "friends"},
    {"id": "note_maya_project_ideas", "user_id": "user_maya", "title": "Side project ideas", "slug": "side-project-ideas", "kind": "project", "tags": ["projects"], "share_tier": "close_friends"},
    {"id": "note_maya_journal", "user_id": "user_maya", "title": "Journal — this week", "slug": "journal-this-week", "kind": "daily", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_maya_todo", "user_id": "user_maya", "title": "This week's TODOs", "slug": "this-weeks-todos", "kind": "task", "status": "doing", "tags": ["todo"], "share_tier": "close_friends"},
    {"id": "note_maya_cs109_review", "user_id": "user_maya", "title": "CS109 — probability review", "slug": "cs109-probability-review", "kind": "note", "tags": ["cs109"], "share_tier": "friends"},
    {"id": "note_maya_recipe", "user_id": "user_maya", "title": "Mom's dal recipe", "slug": "moms-dal-recipe", "kind": "note", "tags": ["recipe"], "share_tier": "family"},
    {"id": "note_maya_bio", "user_id": "user_maya", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_maya_internships", "user_id": "user_maya", "title": "Internship application tracker", "slug": "internship-tracker", "kind": "project", "tags": ["career"], "share_tier": "close_friends"},
    {"id": "note_maya_apartment", "user_id": "user_maya", "title": "Apartment hunt — fall 2026", "slug": "apartment-hunt", "kind": "project", "tags": ["housing"], "share_tier": "family"},
    {"id": "note_maya_study_spots", "user_id": "user_maya", "title": "Best study spots on campus", "slug": "best-study-spots-on-campus", "kind": "note", "tags": ["campus", "study"], "share_tier": "public"},
    {"id": "note_maya_cs_resources", "user_id": "user_maya", "title": "CS resources I actually used", "slug": "cs-resources-i-actually-used", "kind": "note", "tags": ["cs", "resources"], "share_tier": "public"},

    # ----- Priya (9) -----
    {"id": "note_priya_cs161_midterm", "user_id": "user_priya", "title": "CS161 Midterm — clean notes", "slug": "cs161-midterm-clean-notes", "kind": "project", "tags": ["cs161", "midterm"], "share_tier": "close_friends"},
    {"id": "note_priya_orgo", "user_id": "user_priya", "title": "Orgo mechanisms cheat sheet", "slug": "orgo-mechanisms-cheat-sheet", "kind": "note", "tags": ["orgo"], "share_tier": "friends"},
    {"id": "note_priya_mcat", "user_id": "user_priya", "title": "MCAT plan", "slug": "mcat-plan", "kind": "project", "tags": ["mcat"], "share_tier": "close_friends"},
    {"id": "note_priya_journal", "user_id": "user_priya", "title": "Journal", "slug": "journal", "kind": "daily", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_priya_volunteer", "user_id": "user_priya", "title": "Hospital volunteer hours", "slug": "hospital-volunteer-hours", "kind": "task", "tags": ["volunteer"], "share_tier": "friends"},
    {"id": "note_priya_cs161_dp", "user_id": "user_priya", "title": "Dynamic programming — worked examples", "slug": "dynamic-programming-worked-examples", "kind": "note", "tags": ["cs161", "dp"], "share_tier": "close_friends"},
    {"id": "note_priya_bio", "user_id": "user_priya", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_priya_reading", "user_id": "user_priya", "title": "Reading list this quarter", "slug": "reading-list-this-quarter", "kind": "note", "tags": ["reading"], "share_tier": "public"},
    {"id": "note_priya_family_birthday", "user_id": "user_priya", "title": "Dadi's 80th — gift ideas", "slug": "dadis-80th-gift-ideas", "kind": "project", "tags": ["family"], "share_tier": "family"},
    {"id": "note_priya_premed_advice", "user_id": "user_priya", "title": "Pre-med advice I wish I'd gotten", "slug": "premed-advice-i-wish-id-gotten", "kind": "note", "tags": ["premed", "advice"], "share_tier": "public"},
    {"id": "note_priya_orgo_resources", "user_id": "user_priya", "title": "Orgo study resources that actually work", "slug": "orgo-resources-that-work", "kind": "note", "tags": ["orgo", "resources"], "share_tier": "public"},

    # ----- Devon (9) -----
    {"id": "note_devon_setlist", "user_id": "user_devon", "title": "Open mic setlist", "slug": "open-mic-setlist", "kind": "project", "tags": ["music"], "share_tier": "friends"},
    {"id": "note_devon_recording", "user_id": "user_devon", "title": "Recording session plan", "slug": "recording-session-plan", "kind": "project", "tags": ["music", "recording"], "share_tier": "close_friends"},
    {"id": "note_devon_lyrics", "user_id": "user_devon", "title": "Lyrics — draft", "slug": "lyrics-draft", "kind": "note", "tags": ["music", "lyrics"], "share_tier": "private"},
    {"id": "note_devon_essay", "user_id": "user_devon", "title": "Essay outline", "slug": "essay-outline", "kind": "project", "tags": ["writing"], "share_tier": "close_friends"},
    {"id": "note_devon_packing", "user_id": "user_devon", "title": "Packing list — tour", "slug": "packing-list-tour", "kind": "task", "tags": ["travel"], "share_tier": "friends"},
    {"id": "note_devon_journal", "user_id": "user_devon", "title": "Journal", "slug": "journal", "kind": "daily", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_devon_bio", "user_id": "user_devon", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_devon_shows", "user_id": "user_devon", "title": "Upcoming shows", "slug": "upcoming-shows", "kind": "note", "tags": ["music", "live"], "share_tier": "public"},
    {"id": "note_devon_gear", "user_id": "user_devon", "title": "Gear wishlist", "slug": "gear-wishlist", "kind": "note", "tags": ["music", "gear"], "share_tier": "close_friends"},
    {"id": "note_devon_album_recs", "user_id": "user_devon", "title": "Albums I keep returning to", "slug": "albums-i-keep-returning-to", "kind": "note", "tags": ["music", "recs"], "share_tier": "public"},
    {"id": "note_devon_chord_voicings", "user_id": "user_devon", "title": "Chord voicings I love", "slug": "chord-voicings-i-love", "kind": "note", "tags": ["music", "guitar"], "share_tier": "public"},

    # ----- Aisha (8) -----
    {"id": "note_aisha_thesis", "user_id": "user_aisha", "title": "PhD thesis outline", "slug": "phd-thesis-outline", "kind": "project", "tags": ["research", "thesis"], "share_tier": "close_friends"},
    {"id": "note_aisha_protocols", "user_id": "user_aisha", "title": "Lab protocols — Western blot", "slug": "lab-protocols-western-blot", "kind": "note", "tags": ["lab", "protocol"], "share_tier": "friends"},
    {"id": "note_aisha_journal", "user_id": "user_aisha", "title": "Research journal", "slug": "research-journal", "kind": "daily", "tags": ["journal", "research"], "share_tier": "private"},
    {"id": "note_aisha_papers", "user_id": "user_aisha", "title": "Papers to read", "slug": "papers-to-read", "kind": "task", "tags": ["reading", "research"], "share_tier": "friends"},
    {"id": "note_aisha_mentees", "user_id": "user_aisha", "title": "Mentee notes (Priya)", "slug": "mentee-notes-priya", "kind": "note", "tags": ["mentoring"], "share_tier": "private"},
    {"id": "note_aisha_bio", "user_id": "user_aisha", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_aisha_recipes", "user_id": "user_aisha", "title": "Family recipes", "slug": "family-recipes", "kind": "note", "tags": ["recipe", "family"], "share_tier": "family"},
    {"id": "note_aisha_postdoc", "user_id": "user_aisha", "title": "Postdoc target list", "slug": "postdoc-target-list", "kind": "project", "tags": ["career"], "share_tier": "close_friends"},
    {"id": "note_aisha_grad_school_advice", "user_id": "user_aisha", "title": "Grad school: things I'd tell first-year me", "slug": "grad-school-advice-to-myself", "kind": "note", "tags": ["grad-school", "advice"], "search_tier": "public", "share_tier": "public"},
    {"id": "note_aisha_open_protocols", "user_id": "user_aisha", "title": "Open protocols I trust", "slug": "open-protocols-i-trust", "kind": "note", "tags": ["lab", "protocols", "open-science"], "share_tier": "public"},

    # ----- Theo (8) -----
    {"id": "note_theo_roadmap", "user_id": "user_theo", "title": "Q3 product roadmap", "slug": "q3-product-roadmap", "kind": "project", "tags": ["startup", "product"], "share_tier": "close_friends"},
    {"id": "note_theo_pitch", "user_id": "user_theo", "title": "Pitch deck talking points", "slug": "pitch-deck-talking-points", "kind": "note", "tags": ["startup", "fundraising"], "share_tier": "close_friends"},
    {"id": "note_theo_journal", "user_id": "user_theo", "title": "Daily standup notes", "slug": "daily-standup-notes", "kind": "daily", "tags": ["journal", "work"], "share_tier": "private"},
    {"id": "note_theo_band", "user_id": "user_theo", "title": "Bass lines — new EP", "slug": "bass-lines-new-ep", "kind": "note", "tags": ["music"], "share_tier": "friends"},
    {"id": "note_theo_todo", "user_id": "user_theo", "title": "This week (work)", "slug": "this-week-work", "kind": "task", "tags": ["todo", "work"], "share_tier": "private"},
    {"id": "note_theo_bio", "user_id": "user_theo", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_theo_hiring", "user_id": "user_theo", "title": "Eng candidate pipeline", "slug": "eng-candidate-pipeline", "kind": "project", "tags": ["hiring"], "share_tier": "private"},
    {"id": "note_theo_blog", "user_id": "user_theo", "title": "Blog drafts", "slug": "blog-drafts", "kind": "note", "tags": ["writing"], "share_tier": "public"},
    {"id": "note_theo_stack", "user_id": "user_theo", "title": "Our (current) eng stack", "slug": "our-current-eng-stack", "kind": "note", "tags": ["startup", "stack"], "share_tier": "public"},
    {"id": "note_theo_founder_reading", "user_id": "user_theo", "title": "Founder reading list", "slug": "founder-reading-list", "kind": "note", "tags": ["startup", "reading"], "share_tier": "public"},

    # ----- Naomi (8) -----
    {"id": "note_naomi_portfolio", "user_id": "user_naomi", "title": "Senior portfolio plan", "slug": "senior-portfolio-plan", "kind": "project", "tags": ["design", "portfolio"], "share_tier": "friends"},
    {"id": "note_naomi_journal", "user_id": "user_naomi", "title": "Sketchbook journal", "slug": "sketchbook-journal", "kind": "daily", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_naomi_hot_sauce", "user_id": "user_naomi", "title": "Hot sauce recipe v3", "slug": "hot-sauce-recipe-v3", "kind": "note", "tags": ["recipe"], "share_tier": "public"},
    {"id": "note_naomi_devon_poster", "user_id": "user_naomi", "title": "Devon's poster — comps", "slug": "devons-poster-comps", "kind": "project", "tags": ["design", "music"], "share_tier": "friends"},
    {"id": "note_naomi_thrift", "user_id": "user_naomi", "title": "Thrift map — Bay Area", "slug": "thrift-map-bay-area", "kind": "note", "tags": ["fashion"], "share_tier": "friends"},
    {"id": "note_naomi_bio", "user_id": "user_naomi", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_naomi_crush", "user_id": "user_naomi", "title": "Crush thoughts (??)", "slug": "crush-thoughts", "kind": "daily", "tags": ["personal"], "share_tier": "private"},
    {"id": "note_naomi_thesis", "user_id": "user_naomi", "title": "Thesis statement drafts", "slug": "thesis-statement-drafts", "kind": "project", "tags": ["design", "thesis"], "share_tier": "close_friends"},
    {"id": "note_naomi_design_tools", "user_id": "user_naomi", "title": "Design tools I actually use", "slug": "design-tools-i-actually-use", "kind": "note", "tags": ["design", "tools"], "share_tier": "public"},
    {"id": "note_naomi_typography", "user_id": "user_naomi", "title": "Typography rabbit holes", "slug": "typography-rabbit-holes", "kind": "note", "tags": ["design", "type"], "share_tier": "public"},

    # ----- Jordan (8) -----
    {"id": "note_jordan_essay", "user_id": "user_jordan", "title": "College app — common app essay", "slug": "common-app-essay", "kind": "project", "tags": ["college"], "share_tier": "family"},
    {"id": "note_jordan_debate", "user_id": "user_jordan", "title": "Debate evidence — climate", "slug": "debate-evidence-climate", "kind": "note", "tags": ["debate"], "share_tier": "friends"},
    {"id": "note_jordan_calc", "user_id": "user_jordan", "title": "AP Calc BC — review", "slug": "ap-calc-bc-review", "kind": "note", "tags": ["calc"], "share_tier": "friends"},
    {"id": "note_jordan_journal", "user_id": "user_jordan", "title": "Diary", "slug": "diary", "kind": "daily", "tags": ["journal"], "share_tier": "private"},
    {"id": "note_jordan_apps", "user_id": "user_jordan", "title": "College list", "slug": "college-list", "kind": "project", "tags": ["college"], "share_tier": "family"},
    {"id": "note_jordan_bio", "user_id": "user_jordan", "title": "About me", "slug": "about-me", "kind": "person", "tags": ["bio"], "share_tier": "public"},
    {"id": "note_jordan_todo", "user_id": "user_jordan", "title": "School week TODO", "slug": "school-week-todo", "kind": "task", "tags": ["todo"], "share_tier": "private"},
    {"id": "note_jordan_movies", "user_id": "user_jordan", "title": "Movies to watch", "slug": "movies-to-watch", "kind": "note", "tags": ["movies"], "share_tier": "public"},
    {"id": "note_jordan_debate_tips", "user_id": "user_jordan", "title": "Debate tips for novices", "slug": "debate-tips-for-novices", "kind": "note", "tags": ["debate", "advice"], "share_tier": "public"},
    {"id": "note_jordan_high_school_apps", "user_id": "user_jordan", "title": "College app timeline (HS senior)", "slug": "college-app-timeline-hs-senior", "kind": "note", "tags": ["college", "advice"], "share_tier": "public"},
]


# ---------------------------------------------------------------------------
# Inline note bodies — keyed by note id. Adding 40+ short markdown files to
# seed/notes/ for every new persona is overkill; instead bundle bodies here.
# Bundled files on disk still take priority (see _read_body) so the existing
# Maya/Priya/Devon markdown files keep their hand-written content.
# ---------------------------------------------------------------------------

BODIES: dict[str, str] = {
    # ---- Public notes (visible to anyone, including acquaintances) ----
    "note_maya_study_spots": """# Best study spots on campus

Personal ranking, updated after sophomore year.

## A-tier
- **Lathrop courtyard tables (4th floor)** — natural light, quiet, never crowded.
- **Cubberley basement carrels** — silent. Almost too silent.
- **Coupa Green Library** — caffeine + people-watching, good for shallow work.

## B-tier
- Tresidder upstairs (loud when there's an event)
- Y2E2 atrium (decent but echo-y)

## Don't bother
- Main quad — pretty but you'll get distracted.
- Old Union — eaten alive by group projects.
""",
    "note_maya_cs_resources": """# CS resources I actually used

Filtered down to what I came back to more than twice.

## Algorithms
- CLRS chapter 15 (DP) — the chapter that finally clicked it for me
- *Algorithms by Sedgewick* (Coursera) — better than the book imo

## Systems
- Operating Systems: Three Easy Pieces (free PDF, gold standard)
- The "What every programmer should know about memory" essay

## Interview prep
- Leetcode Top 100 Liked
- Tech Interview Handbook (not the company; the open-source one)

## ML
- fast.ai practical deep learning
- Karpathy's micrograd video
""",

    "note_priya_premed_advice": """# Pre-med advice I wish I'd gotten

For anyone reading this who's pre-med-curious. Two years deep.

## Before you commit
- Shadow at least 3 doctors in 3 different specialties. The "I want to help people" version of the dream is not the day-to-day version.
- Talk to current med students about debt. Talk to *finishing* med students about debt.

## Tactically
- Take MCAT seriously a full year out. Don't believe people who say 3 months.
- GPA matters more than anyone wants to admit. Protect freshman year.
- Find a research lab early — they're how you get rec letters.

## Mentally
- The grind is real. Build a non-medicine identity (mine: CS minor + climbing).
""",
    "note_priya_orgo_resources": """# Orgo study resources that actually work

The ones I came back to. Skipping the ones everyone recommends but I never opened.

## Concept videos
- **Chad's Prep** (paid; worth it) — best mechanism intuition
- **Leah4Sci** (free) — good for SN1/SN2 if you keep mixing them up

## Practice
- ACS practice exam (do it twice — once at week 6, once at week 11)
- Klein workbook — focus on retrosynthesis problems

## Don't bother
- YouTube generic tutorials by random profs — quality is wildly inconsistent

## My personal trick
- Re-draw every mechanism by hand, even if you "get it". Muscle memory > recognition.
""",

    "note_devon_album_recs": """# Albums I keep returning to

Updated quarterly. Mostly things I had to listen to 3+ times before they hit.

## This year
- *Wide Awake!* — Parquet Courts
- *Magdalene* — FKA Twigs
- *Reflections* — Hannah Diamond (criminally underrated)

## All-time
- *Carrie & Lowell* — Sufjan
- *Hejira* — Joni Mitchell
- *Loveless* — MBV
- *Pink Moon* — Nick Drake (especially after dark)

## Currently chewing on
- The new Wednesday album. Not sure yet. Ask me in October.
""",
    "note_devon_chord_voicings": """# Chord voicings I love

Stuff I steal constantly. Most are off open strings on guitar.

## The "Sufjan Cmaj7"
- x32030 — open + ringing, sounds like sunlight
- Move shape up a fret → Dbmaj7 (x42030), beautiful

## The "Bon Iver F"
- xx3211 — fingered F up high; less doomy than barre F

## The "Mac DeMarco minor add9"
- x02430 — sounds like everything Mac plays

## A walk that always works
- C → Cmaj7 → C7 → F (over a slow tempo, half-time feel)
""",

    "note_aisha_grad_school_advice": """# Grad school: things I'd tell first-year me

Public because so much of grad school survival is undocumented.

## The actual lessons
1. **Your PI's enthusiasm = your timeline.** If they go quiet for 3 weeks, your project goes quiet for 3 weeks. Have a side project that doesn't depend on them.
2. **Pick rotations on the *people*, not the *science*.** You'll outlive the project; you have to live with the people.
3. **Imposter syndrome is universal and not informative.** Don't make it a personality trait.

## Logistics
- Use a real reference manager (Zotero or Paperpile) from day one
- Set up regular 1:1s with your PI — don't wait for them to schedule
- Find a writing accountability partner (mine is in another lab — perfect)

## Things I overthought
- Conference talks. Nobody remembers them.
- Whether to switch labs after first year. It's normal. Do it if you need to.
""",
    "note_aisha_open_protocols": """# Open protocols I trust

Sharing because grad students keep emailing me asking for these.

## Bench
- **Bio-protocol.org** — peer-reviewed; consistent quality
- **protocols.io** — broad but variable; check the citation count
- **OpenWetWare** — old but a lot of yeast/E. coli stuff still holds up

## Compute
- The Eisen lab's basic bioinformatics protocols (RNA-seq alignment, DESeq2)
- Pachterlab pipelines (kallisto + bustools)

## What I don't trust
- Random methods sections from PDFs without troubleshooting context — they always leave out the step that fails
""",

    "note_theo_stack": """# Our (current) eng stack

Public because I get this question constantly. Updated periodically.

## Backend
- **Go** for the API (HTTP + gRPC internal)
- **Postgres** as the source of truth (managed via RDS)
- **Redis** for cache + queues (Bull)
- **Temporal** for any workflow that crosses an external API

## Frontend
- **Next.js 15** on the web app, app router
- **TypeScript** everywhere, strict mode
- **TanStack Query** for server state, **Zustand** for the rest

## Infra
- **Cloudflare** in front (DDoS, caching, KV for feature flags)
- **AWS** for compute (ECS Fargate)
- **Datadog** for observability

## What we'd change if we restarted today
- Probably Bun + TypeScript on the backend, honestly
""",
    "note_theo_founder_reading": """# Founder reading list

The stuff I keep going back to (not the stuff I read once and forgot).

## Strategy / building
- *High Output Management* — Andy Grove. Old but the only management book I've reread.
- *The Mom Test* — Rob Fitzpatrick. Short, essential. Read before any customer call.
- *Crossing the Chasm* — Geoffrey Moore. The pricing chapter alone is worth it.

## Mindset
- *Hard Thing About Hard Things* — Ben Horowitz. The wartime/peacetime dichotomy stuck.

## Tactical
- **First Round Review** — actually high quality, sortable by topic.
- The YC essays. All of them. They're free.

## Skipped (overrated, in my view)
- *Zero to One* — fine, but the bits everyone quotes are the only good bits.
""",

    "note_naomi_design_tools": """# Design tools I actually use

Updated when I drop or pick up a tool. Last update: this quarter.

## Daily
- **Figma** — duh
- **Procreate** (iPad) — sketching, comps, photo studies
- **Adobe Illustrator** — only for the final vector pass

## Weekly
- **Glyphs Mini** — typography experiments
- **Cavalry** — motion comps when I can't bring myself to open After Effects

## Random but useful
- **Coolors** — palette generator (the only one I tolerate)
- **Are.na** — visual research; my mood-board lives here

## Don't use anymore
- Sketch — Figma killed it
- Notion-for-design-docs — moved everything back to Figma comments
""",
    "note_naomi_typography": """# Typography rabbit holes

The places I get nerd-sniped. Public because there's no shame in this.

## Foundries to know
- **Klim Type Foundry** — Calibre, Founders Grotesk, all bangers
- **Pangram Pangram** — generous personal licenses, sharp specimen sites
- **Grilli Type** — GT Walsheim is everywhere for a reason
- **Future Fonts** — buy in-progress fonts cheap

## The rabbit holes
- The history of Helvetica vs. Akzidenz-Grotesk
- Hoefler & Co. type specimens (just for the writing)
- Display vs. text optical sizing — the difference is bigger than you think
- Variable fonts: criminally underused, would be everywhere if Figma had better UX for them

## Personal opinion
- Display sans-serifs are over. Bring back display serifs.
""",

    "note_jordan_debate_tips": """# Debate tips for novices

For any other high schoolers stumbling into this. Captain of Lincoln HS PF.

## Before the round
- **Flow everything.** Get a real flow paper. Don't try to argue from memory.
- **Pre-write your 2nd rebuttal** for the 3-4 most likely cases you'll hit.
- **Cards beat warrants beat impacts** — but only if your cards are real.

## During the round
- Speak slow when you start cross. Speed up only when you're winning.
- If your opponent drops an argument, *say* "extend that across the flow". Don't assume the judge caught it.
- Eye contact > flowing > looking at your laptop.

## After the round
- Write down what the judge said in the RFD. Even if it sucks.
- The opponents you lose to are way more useful to study than the ones you beat.

## Mindset
- Lay judges are not stupid. They're the median voter. Speak like a normal person.
""",
    "note_jordan_high_school_apps": """# College app timeline (HS senior)

What I'm doing, when. Public because my friends keep asking me.

## Summer before senior year
- [x] Finalize college list (8–12 schools, mix of reach/match/safety)
- [x] Visit at least 2 schools in person (virtual = ok for the rest)
- [x] Draft Common App essay (5+ revisions)

## August
- [x] Open Common App account
- [x] Request rec letters from 2 teachers + 1 counselor
- [ ] Draft "Why us" supplements for top 3 schools

## September
- [ ] Take SAT/ACT one last time if score < target
- [ ] Polish essays — get 2 separate adults to read
- [ ] Confirm activities list (10 max, in order of importance)

## October
- [ ] Early Action / Early Decision submissions (deadlines vary 10/15–11/1)
- [ ] Get FAFSA submitted

## November–December
- [ ] Regular Decision rounds
- [ ] Honest break for 2 weeks before stressing about decisions
""",

    # ---- Maya ----
    "note_maya_internships": """# Internship application tracker

| Company | Stage | Next step | Notes |
|---|---|---|---|
| Anthropic | Phone screen done | Final round 2026-05-30 | Loved the system-design Q. |
| Stripe | OA submitted | Awaiting recruiter | Riya referred me. |
| Notion | Cold app | — | Submitted last week, no word. |
| Cursor | Offer (verbal) | Decide by Fri | Pay good, vibe good, scared of pace. |

Decision deadline: Friday next week. Talk to Aisha + Priya before committing.
""",
    "note_maya_apartment": """# Apartment hunt — fall 2026

Looking for a 2BR within 1.5mi of campus. Sharing with Priya. Budget $2200/mo total.

## Listings I've shortlisted
- 224 Forest Ave — sunny, 2BR/1BA, $2150. Open house Sat.
- 1414 Hamilton — newer, $2400, parking included.
- 891 Embarcadero — bigger but 25min walk.

## Open questions for Mom & Dad
- Co-sign timeline?
- First-month + deposit total ~$5k — covered or split?
""",

    # ---- Priya ----
    "note_priya_family_birthday": """# Dadi's 80th — gift ideas

Throwing a small dinner at our place. ~15 people, mostly family + her 3 closest friends from temple.

## Gift ideas
- Photo book — last 40 years (Mom can curate)
- New shawl from Pashmina place she liked in Delhi
- Custom calligraphy of her favorite Urdu poem

## TODO
- [ ] Book caterer (Tandoor House quoted $480 for 15)
- [ ] Order cake (rasmalai? mango cream?)
- [ ] Get cousins to send video messages
""",

    # ---- Devon ----
    "note_devon_gear": """# Gear wishlist

In rough priority order — buying as I save up.

1. **Fender American Pro II Tele** — $1700 — the one. Justifying once tour money lands.
2. **Strymon Iridium** — $400 — silent practice + recording amp sim.
3. **Sennheiser e835** mic — $100 — for open mics where the house mic is dead.
4. **In-ear monitors** — $200 — Theo keeps asking me to get these.

Anti-list (do NOT buy):
- Another fuzz pedal. You have four. Stop.
""",

    # ---- Aisha ----
    "note_aisha_thesis": """# PhD thesis outline

Working title: *"Compensatory mechanisms in the unfolded protein response under chronic ER stress"*

## Chapters
1. Background + literature review
2. Methods (cell lines, blot protocols, RNA-seq)
3. **Results A** — XBP1 splicing kinetics (almost done)
4. **Results B** — ATF6 compensation (current focus)
5. **Results C** — drug response (next year)
6. Discussion + future directions

Committee meeting #3: end of June. Want Results A figures locked by then.
""",
    "note_aisha_protocols": """# Lab protocols — Western blot

Standard workflow we use in the Levinson lab.

## Day 1: gel
- Cast 10% acrylamide gel (4ml resolving + 1ml stacking)
- Load 20µg protein per lane + 5µl ladder
- Run at 80V through stacking → 120V resolving (~75 min)

## Day 1 cont: transfer
- Wet transfer, 100V for 60 min on ice
- Ponceau stain to confirm transfer

## Day 2: blocking + primary
- Block 1hr in 5% milk/TBST at RT
- Primary antibody overnight at 4°C (dilutions in our shared sheet)

## Day 3: secondary + image
- Wash 3×10min TBST
- HRP-conjugated secondary 1hr RT
- ECL + image on the LiCor
""",
    "note_aisha_papers": """# Papers to read

- [ ] Walter & Ron 2011 — UPR review (re-read; cite in intro)
- [ ] Nature Cell Bio Aug 2026 — XBP1s isoform paper
- [ ] BioRxiv preprint from Dixon lab on ATF6
- [x] Hetz 2012 — done, took 4 pages of notes
- [ ] Three papers from last week's journal club
""",
    "note_aisha_mentees": """# Mentee notes (Priya)

Priya's been shadowing in the lab on Fridays. Sharp, careful with pipetting, asks the right questions.

## What she's working on
- Practicing thin-layer chromatography (organic chem related, not directly lab work)
- Helping with weekend cell-culture feedings

## What I want to teach her next
- How to design a control set (she defaults to too many conditions, too few controls)
- Reading a paper critically — what's a "well-controlled" figure

## Notes for myself
- She's stretched thin: orgo + MCAT + volunteer. Don't pile on. Quality > quantity.
""",
    "note_aisha_recipes": """# Family recipes

Mom's stuff — keeping these in one place so I don't keep texting her.

## Jollof rice
- 4 cups parboiled long-grain rice
- 6 large tomatoes + 2 red peppers, blended
- 1 onion, scotch bonnet, garlic, ginger
- Stock + bay + thyme + curry powder

## Egusi soup
- (placeholder — call mom)
""",
    "note_aisha_postdoc": """# Postdoc target list

Aiming to apply by Q4 2026. Want a lab that does UPR + neurodegeneration.

| PI | Institution | Why | Status |
|---|---|---|---|
| Ron lab | UCSF | OG UPR lab | Email warm intro from Levinson |
| Marciniak | Cambridge UK | Beautiful XBP1 work | Tour planned during conference |
| Hetz | Univ. Chile | Direct fit | Cold outreach, no reply yet |

Decision points: visa, salary floor ($65k), partner's job market.
""",

    # ---- Theo ----
    "note_theo_roadmap": """# Q3 product roadmap

Status as of this week. Reviewed with the team Monday.

## Shipping
1. Checkout flow redesign (eng: 2 wks, design: shipped Wed)
2. SAML SSO for enterprise tier (eng: 3 wks)
3. New onboarding email sequence (already live, monitoring)

## Discovery
- Embedded analytics dashboard (talking to 4 design partners)
- AI summary feature (deciding build vs OpenAI wrapper)

## Cutting
- Custom domains — not enough revenue impact this quarter
""",
    "note_theo_pitch": """# Pitch deck talking points

For the Sequoia partner meeting next Wed. Slides are in Figma; this is the verbal narrative.

## Hook
"Every B2B SaaS company in 2026 is trying to bolt AI onto a workflow. We built the workflow assuming the AI already exists."

## Numbers
- $42k MRR, growing 28% MoM for the last 4 months
- 71 paying customers, 3 logos > $1k MRR
- 4.2-month CAC payback

## Ask
$3M seed, 18-month runway to Series A milestones.
""",
    "note_theo_band": """# Bass lines — new EP

Devon wrote a draft of the title track; needs bass.

## Track 1 — "Anyway"
- Verse: walk Em → C → G → D, half notes
- Chorus: pump on root with octave jump on the &-of-3
- Bridge: try the dropped-tuning thing Devon mentioned?

## Track 2 — TBD
- Devon hasn't sent chords yet. Hassle him Wednesday.
""",
    "note_theo_todo": """# This week (work)

- [ ] Finalize Sequoia deck
- [ ] Review eng candidate take-home from Maya's friend
- [ ] 1:1s with the team (Mon Tue)
- [ ] Pricing experiment writeup
- [x] Standup notes synced to Notion
- [ ] Email investor referrals
""",
    "note_theo_hiring": """# Eng candidate pipeline

| Name | Stage | Owner | Notes |
|---|---|---|---|
| (redacted A) | Final loop | Theo | Strong systems chops; needs to meet the team. |
| (redacted B) | Take-home review | Eng manager | Submission was ok, not great. |
| (redacted C) | Sourced | Theo | LinkedIn outreach, waiting reply. |
| Maya's referral | Phone screen scheduled | Theo | Maya vouches; Friday 3pm. |

Keep this private — names off the public note.
""",
    "note_theo_blog": """# Blog drafts

## "What we got wrong in our first year of pricing"
- Hook: charged too little, scared of churn
- Body: 3 specific mistakes (free tier too generous, no annual discount, sales-led for orgs that wanted PLG)
- Lesson: price for the value you're trying to *prove*, not the value you've shipped

## "Hiring for taste in early-stage eng"
- Half-drafted. Not sure yet if this is honest or smug.
""",

    # ---- Naomi ----
    "note_naomi_portfolio": """# Senior portfolio plan

Defending in Dec. Want 5 strong pieces + a process book.

## Pieces (working)
1. *Sun protest* — Berkeley climate march poster series (typography)
2. *Soft systems* — speculative UI for grief journaling
3. *Hot sauce brand* — full identity for my fermented sauce thing
4. *Devon's EP cover* — if he picks one of my comps
5. *(TBD)* — something physical, maybe ceramic

## Process book
- Want it letterpress printed → talk to studio about availability
- Aim for 60-80pp
""",
    "note_naomi_hot_sauce": """# Hot sauce recipe v3

Fermented red jalapeño + fresno blend. Better than v2 — milder funk, more fruit.

## Ferment
- 500g chiles (mix red jalapeño + fresno 2:1)
- 12g salt (2.4% by weight)
- Pack in jar, weight under brine
- 14 days at room temp, burp daily for week 1

## Blend
- Drain (save brine), blend solids smooth
- Add brine back to taste (want pourable, not thick)
- 2 tbsp apple cider vinegar
- Optional: 1 tsp honey if it's too sharp

## v4 ideas
- Try adding a single peach during ferment
""",
    "note_naomi_devon_poster": """# Devon's poster — comps

Three directions to show Devon Thursday.

## A. Bold + minimal
Big single-color block, hand-set title, venue + date in stencil. Reads from 30ft.

## B. Photo-driven
Grainy band portrait, type overlaid in a thin sans. Riskier — depends on a great photo we don't have yet.

## C. Illustrated
My drawing of the venue's neon sign, retro-future palette. Probably his favorite, hardest for me to execute.

Pick by Friday or it won't get to the printer.
""",
    "note_naomi_thrift": """# Thrift map — Bay Area

Updated whenever I find something good.

## Top tier
- **Wasteland** (Haight, SF) — pricey but consistent quality designer
- **Castro Goodwill** — sleeper hit, dig through hard
- **Mission Thrift Town** — go on Sundays after restock

## Worth a visit
- Crossroads (multiple)
- Out of the Closet (50/50)

## Skip
- Anywhere in Palo Alto unless desperate
""",
    "note_naomi_crush": """# Crush thoughts (??)

Theo keeps inviting me to coffee. I don't know. He's so… *startup*. But he listens. And asks real questions.

Don't tell anyone. Especially not Devon.
""",
    "note_naomi_thesis": """# Thesis statement drafts

Aiming for ~150 words. Should answer: what's the through-line of my work?

## Draft 1
"My work uses graphic design as a quiet form of social commentary — taking forms typically associated with consumer marketing (posters, packaging, identity systems) and bending them to surface political or emotional truths the originals would smooth over."

## Draft 2
"I'm interested in design as a way to slow attention down. The work asks viewers to spend five extra seconds with something they'd otherwise scroll past."

Draft 2 is closer.
""",

    # ---- Jordan ----
    "note_jordan_essay": """# College app — common app essay

Stuck. Topic: the summer I worked at the auto repair shop with Uncle Wei.

## What I want to say
- I went in thinking I'd learn cars. I learned to listen.
- Specific moment: the woman who came in angry and just needed someone to take her seriously.
- That's the through-line of who I want to be.

## What needs fixing
- Don't start with the cliché "It was 8am on a Tuesday."
- Maya said cut the bit about my grades — agreed, sounds defensive.
- Mom thinks I should mention debate. I disagree; this essay isn't about debate.
""",
    "note_jordan_debate": """# Debate evidence — climate

Stuff to memorize for the upcoming tournament. Topic resolution: *"The US federal government should substantially increase its restrictions on fossil fuel production."*

## Aff key cards
- IPCC AR6 — 1.5°C requires 43% reduction in CO2 by 2030
- IEA 2024 — no new oil/gas exploration consistent with 1.5°C
- Princeton REPEAT — IRA insufficient on its own

## Neg key cards
- Energy security argument — Russia/Ukraine winter
- Jobs in petrochemical regions (Louisiana, West Texas)
- China + India outpacing US emissions cuts
""",
    "note_jordan_calc": """# AP Calc BC — review

Exam in 3 weeks. Weak areas:
- [ ] Series convergence tests (when do I use ratio vs root vs comparison?)
- [ ] Parametric arc length
- [ ] Polar area (rev integral)

Strong areas — don't waste time:
- Derivatives, related rates, optimization
- Standard antiderivative tables

## Plan
- Mon/Tue: convergence test flashcards
- Wed/Thu: 1 free response per night
- Weekend: full timed practice exam
""",
    "note_jordan_apps": """# College list

Working list. Mom + Dad want me to add 2 more safeties.

| School | Type | Major | Notes |
|---|---|---|---|
| UC Berkeley | Match | CS or stats | In-state, parents OK |
| Stanford | Reach | Stats | Family connection through Maya |
| Pomona | Reach | Math | Small + LAC fit |
| UCLA | Match | Stats | Backup to Berkeley |
| UC Davis | Safety | Stats | Solid stats dept |
| (TBD safety #2) | Safety | ? | |

Decision: by Nov 1 for early apps.
""",
    "note_jordan_todo": """# School week TODO

- [ ] Calc problem set Ch 9
- [ ] AP Lit essay draft (Things Fall Apart)
- [ ] Debate evidence cards x10
- [ ] College essay second draft
- [ ] Practice piano (lol)
- [x] Replied to college counselor
""",
    "note_jordan_movies": """# Movies to watch

Recommendations + things I keep meaning to see.

- *Past Lives* — Maya keeps insisting
- *Perfect Days* — Aisha mentioned at family dinner
- *Anatomy of a Fall*
- *Aftersun* (cried-twice recommendation from like 3 people)
- *Mulholland Drive* — needs a Saturday afternoon

Watched recently: *Materialists* (mid), *Sinners* (great).
""",
}


# Default body if no inline body and no bundled file. Used as a low-effort
# fallback for the few notes I didn't write copy for — better than the old
# "(placeholder body)" because it at least lifts the title + tags.
def _default_body(n: dict) -> str:
    title = n.get("title", "Untitled")
    tags = n.get("tags") or []
    kind = n.get("kind", "note")
    tag_line = f"_tags: {', '.join(tags)}_\n" if tags else ""
    return f"# {title}\n\n{tag_line}\n*({kind}, body TBD)*\n"


# ---------------------------------------------------------------------------


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
        body = _read_body(bundled_root, n)
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

    print(
        f"Seeded {len(USERS)} users, {len(FRIENDSHIPS)} friendship edges, "
        f"{len(CALENDAR)} events, {len(NOTES)} notes."
    )


def _read_body(bundled_root: Path, n: dict) -> str:
    """Resolution order: bundled markdown file -> inline BODIES dict -> default."""
    p = bundled_root / n["user_id"] / f"{n['id']}.md"
    if p.exists():
        return p.read_text()
    if n["id"] in BODIES:
        return BODIES[n["id"]]
    return _default_body(n)


if __name__ == "__main__":
    run()
