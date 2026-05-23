"""Pending agent-to-user requests, awaitable from inside the tool loop.

The agent calls a tool like `ask_user` or `confirm_action`. The tool creates a
PendingRequest here and awaits its future. The Telegram bridge (or any other
front-end channel) resolves the future when the user replies, and the tool
returns the answer to the agent.

In-memory by design: pending requests are tied to a live tool-loop coroutine,
so restarts naturally cancel them.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Literal

from db.store import new_id


Kind = Literal["ask", "confirm"]


@dataclass
class PendingResult:
    answered: bool
    # For "ask": text contains the user's reply.
    text: str | None = None
    # For "confirm": approved is True (Approve), False (Deny), or None (no reply).
    approved: bool | None = None
    # Optional free-text note the user typed alongside a confirm click, or
    # whatever the bot picked up after the button press.
    note: str | None = None
    # Why the request ended without a real answer: "timeout" | "cancelled" | None.
    reason: str | None = None


@dataclass
class PendingRequest:
    id: str
    user_id: str
    kind: Kind
    prompt: str
    future: asyncio.Future = field(repr=False)
    created_at: float = field(default_factory=time.time)
    # Channel-specific identifier (e.g. telegram message_id) so the bridge can
    # later edit the original prompt to show "✅ approved" / "❌ denied".
    channel_ref: dict = field(default_factory=dict)


class _Store:
    def __init__(self) -> None:
        self._by_id: dict[str, PendingRequest] = {}
        # user_id -> most-recent-first list of request ids that are still open
        self._by_user: dict[str, list[str]] = {}
        self._lock = asyncio.Lock()

    async def create(self, user_id: str, kind: Kind, prompt: str) -> PendingRequest:
        loop = asyncio.get_running_loop()
        req = PendingRequest(
            id=new_id("ask"),
            user_id=user_id,
            kind=kind,
            prompt=prompt,
            future=loop.create_future(),
        )
        async with self._lock:
            self._by_id[req.id] = req
            self._by_user.setdefault(user_id, []).insert(0, req.id)
        return req

    async def get(self, request_id: str) -> PendingRequest | None:
        async with self._lock:
            return self._by_id.get(request_id)

    async def latest_open_for_user(self, user_id: str) -> PendingRequest | None:
        async with self._lock:
            for rid in list(self._by_user.get(user_id, [])):
                r = self._by_id.get(rid)
                if r and not r.future.done():
                    return r
            return None

    async def resolve(self, request_id: str, result: PendingResult) -> bool:
        async with self._lock:
            req = self._by_id.get(request_id)
            if not req or req.future.done():
                return False
            req.future.set_result(result)
            return True

    async def discard(self, request_id: str) -> None:
        async with self._lock:
            self._by_id.pop(request_id, None)
            for uid, rids in self._by_user.items():
                if request_id in rids:
                    rids.remove(request_id)

    async def wait(self, req: PendingRequest, timeout: float) -> PendingResult:
        try:
            result = await asyncio.wait_for(req.future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            # Mark done so a late reply doesn't try to resolve a stale future.
            if not req.future.done():
                req.future.set_result(PendingResult(answered=False, reason="timeout"))
            return PendingResult(answered=False, reason="timeout")
        finally:
            await self.discard(req.id)


_store: _Store | None = None


def get_store() -> _Store:
    global _store
    if _store is None:
        _store = _Store()
    return _store
