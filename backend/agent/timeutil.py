"""Centralized timezone handling.

The demo is set in Pacific time. Anything that builds 'now', 'today', or a
human-readable date should go through here so we never accidentally hand the
LLM a UTC date that's hours off from the user's actual day.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")


def now_pacific() -> datetime:
    return datetime.now(PACIFIC)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_pacific_iso() -> str:
    return now_pacific().strftime("%Y-%m-%d")


def today_pacific_human() -> str:
    """e.g. 'Saturday, May 23, 2026 (Pacific time)'"""
    return now_pacific().strftime("%A, %B %d, %Y (Pacific time)")
