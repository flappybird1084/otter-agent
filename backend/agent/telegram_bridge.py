"""Telegram bridge — relays agent prompts to the user and routes replies back.

Two responsibilities:

1. SEND: when the agent calls `ask_user` or `confirm_action`, we push a prompt
   to the linked Telegram chat (plain text for ask, text+inline buttons for
   confirm). The tool blocks on a PendingRequest future that this bridge
   resolves when the user replies.

2. RECEIVE: a single long-polling loop calls Telegram's `getUpdates`. Incoming
   updates are dispatched to:
     - command handlers (`/start`, `/link <code>`, `/whoami`, `/help`)
     - the pending-request store (text reply or button click resolves a future)
     - the chat agent (any other free text is treated as a fresh user message
       to the linked user's own agent — the same code path as the web chat UI)

Idempotent: `start()` is safe to call twice; the second call is a no-op.
Token-less: if TELEGRAM_BOT_TOKEN is unset, `start()` returns immediately and
`is_enabled()` stays False. Tools that need it then synthesize a graceful
"no telegram link" result so the agent loop doesn't deadlock.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import string
import time
from dataclasses import dataclass
from typing import Any

import httpx

from db import users as users_db
from db.store import get_store as _get_store
from .pending import PendingRequest, PendingResult, get_store as get_pending_store


log = logging.getLogger("telegram_bridge")
log.setLevel(logging.INFO)
# Force a stderr handler so messages show up under uvicorn's default config
# (which only configures the `uvicorn.*` loggers).
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s"))
    log.addHandler(_h)
    log.propagate = False

API_BASE = "https://api.telegram.org"
LONG_POLL_TIMEOUT = 25  # seconds — Telegram caps at 50
LINK_CODE_TTL = 5 * 60  # 5 minutes


# ---------------------------------------------------------------------------
# Link codes (in-memory; consumed by `/link CODE`)
# ---------------------------------------------------------------------------


@dataclass
class _LinkCode:
    code: str
    user_id: str
    expires_at: float


_link_codes: dict[str, _LinkCode] = {}


def issue_link_code(user_id: str) -> str:
    """Generate a short, single-use code that pairs `user_id` to whatever
    Telegram chat sends `/link <code>` next."""
    _gc_link_codes()
    alphabet = string.ascii_uppercase + string.digits
    # avoid 0/O/1/I to keep it copyable
    alphabet = alphabet.translate(str.maketrans("", "", "0O1I"))
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    _link_codes[code] = _LinkCode(code=code, user_id=user_id, expires_at=time.time() + LINK_CODE_TTL)
    return code


def _gc_link_codes() -> None:
    now = time.time()
    for k in list(_link_codes.keys()):
        if _link_codes[k].expires_at < now:
            _link_codes.pop(k, None)


def _consume_link_code(code: str) -> str | None:
    _gc_link_codes()
    entry = _link_codes.pop(code, None)
    if not entry:
        return None
    return entry.user_id


# ---------------------------------------------------------------------------
# Bot service
# ---------------------------------------------------------------------------


class _TelegramBridge:
    def __init__(self) -> None:
        self._token: str | None = None
        self._client: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event = asyncio.Event()
        self._offset: int = 0
        self._started = False

    # ---- lifecycle ----

    def is_enabled(self) -> bool:
        return bool(self._token)

    async def start(self) -> None:
        if self._started:
            return
        token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
        if not token:
            log.info("TELEGRAM_BOT_TOKEN unset — telegram bridge disabled")
            return
        self._token = token
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(LONG_POLL_TIMEOUT + 10))
        self._stop_event = asyncio.Event()
        # Drop any backlog from past runs so we don't replay /link codes etc.
        self._offset = await self._initial_offset()
        self._poll_task = asyncio.create_task(self._poll_loop(), name="telegram-poll")
        self._started = True
        me = await self._call("getMe")
        log.info("telegram bridge online as @%s", (me or {}).get("username"))

    async def stop(self) -> None:
        if not self._started:
            return
        self._stop_event.set()
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._client:
            await self._client.aclose()
        self._started = False
        self._client = None
        self._poll_task = None

    # ---- outbound (used by tools) ----

    async def send_ask(self, user_id: str, prompt: str) -> PendingRequest | None:
        """Post an open-ended question to the user. Returns the PendingRequest
        the caller should await, or None if the user has no Telegram link."""
        chat_id = _chat_id_for(user_id)
        if not chat_id or not self.is_enabled():
            return None
        pending = await get_pending_store().create(user_id=user_id, kind="ask", prompt=prompt)
        text = f"🤖 *Your agent asks:*\n{_md_escape(prompt)}\n\n_Reply to this message._"
        resp = await self._call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        })
        if resp and resp.get("message_id"):
            pending.channel_ref = {"chat_id": chat_id, "message_id": resp["message_id"]}
        return pending

    async def send_confirm(self, user_id: str, summary: str, risk: str = "medium") -> PendingRequest | None:
        """Post a yes/no confirmation with inline buttons. Returns the PendingRequest
        the caller should await, or None if the user has no Telegram link."""
        chat_id = _chat_id_for(user_id)
        if not chat_id or not self.is_enabled():
            return None
        pending = await get_pending_store().create(user_id=user_id, kind="confirm", prompt=summary)
        badge = {"low": "🟢", "medium": "🟡", "high": "🔴"}.get(risk, "🟡")
        text = (
            f"{badge} *Your agent wants to confirm:*\n"
            f"{_md_escape(summary)}\n\n"
            f"_Risk: {risk}. Tap a button or reply yes/no._"
        )
        keyboard = {
            "inline_keyboard": [[
                {"text": "✅ Approve", "callback_data": f"ok:{pending.id}"},
                {"text": "❌ Deny", "callback_data": f"no:{pending.id}"},
            ]],
        }
        resp = await self._call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "reply_markup": keyboard,
        })
        if resp and resp.get("message_id"):
            pending.channel_ref = {"chat_id": chat_id, "message_id": resp["message_id"]}
        return pending

    async def send_notice(self, user_id: str, text: str) -> None:
        """Push an unsolicited message to the user (e.g. 'request timed out')."""
        chat_id = _chat_id_for(user_id)
        if not chat_id or not self.is_enabled():
            return
        await self._call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        })

    # ---- inbound (poll loop) ----

    async def _initial_offset(self) -> int:
        """Skip past any updates that piled up while the server was offline so
        we don't accidentally honor a `/link` from yesterday."""
        try:
            resp = await self._http_post("getUpdates", {"timeout": 0, "limit": 1, "offset": -1})
            if resp and resp.get("ok") and resp.get("result"):
                last = resp["result"][-1]
                return int(last["update_id"]) + 1
        except Exception as exc:
            log.debug("could not bootstrap offset: %s", exc)
        return 0

    async def _poll_loop(self) -> None:
        backoff = 1
        while not self._stop_event.is_set():
            try:
                resp = await self._http_post("getUpdates", {
                    "timeout": LONG_POLL_TIMEOUT,
                    "offset": self._offset,
                    "allowed_updates": ["message", "callback_query"],
                })
                if not resp or not resp.get("ok"):
                    raise RuntimeError(f"getUpdates failed: {resp}")
                backoff = 1
                for upd in resp.get("result", []):
                    self._offset = max(self._offset, int(upd["update_id"]) + 1)
                    try:
                        await self._handle_update(upd)
                    except Exception:
                        log.exception("error handling update %s", upd.get("update_id"))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("poll loop error (will retry in %ss): %s", backoff, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _handle_update(self, upd: dict) -> None:
        if "callback_query" in upd:
            await self._handle_callback_query(upd["callback_query"])
            return
        if "message" in upd:
            await self._handle_message(upd["message"])
            return

    async def _handle_message(self, msg: dict) -> None:
        chat_id = msg.get("chat", {}).get("id")
        text = (msg.get("text") or "").strip()
        from_user = msg.get("from", {})
        log.info(
            "RECV chat_id=%s from=@%s (%s %s, lang=%s) text=%r",
            chat_id,
            from_user.get("username"),
            from_user.get("first_name"),
            from_user.get("last_name"),
            from_user.get("language_code"),
            text[:120],
        )
        if not chat_id or not text:
            return

        # commands first
        if text.startswith("/"):
            await self._handle_command(chat_id, text)
            return

        user_id = _user_id_for_chat(chat_id)
        if not user_id:
            await self._send(chat_id,
                "Not linked yet. From the web UI, generate a link code and send `/link <code>` here.")
            return

        # If there's a pending request from the user's own agent, route to it.
        pending = await get_pending_store().latest_open_for_user(user_id)
        if pending and pending.kind == "ask":
            await get_pending_store().resolve(pending.id, PendingResult(answered=True, text=text))
            await self._send(chat_id, "✓ delivered to your agent.")
            return
        if pending and pending.kind == "confirm":
            lowered = text.lower()
            if lowered in ("y", "yes", "ok", "approve", "approved", "go", "👍"):
                await get_pending_store().resolve(pending.id, PendingResult(answered=True, approved=True, note=text))
                await self._send(chat_id, "✓ approved.")
                return
            if lowered in ("n", "no", "deny", "denied", "stop", "cancel", "👎"):
                await get_pending_store().resolve(pending.id, PendingResult(answered=True, approved=False, note=text))
                await self._send(chat_id, "✓ denied.")
                return
            # Anything else: treat as a clarification note alongside the still-open confirm.
            await self._send(chat_id, "I need a yes/no (or tap a button). You can also reply with the words 'approve' or 'deny'.")
            return

        # No pending — treat as a fresh chat to the user's own agent.
        await self._run_chat_for_user(chat_id, user_id, text)

    async def _handle_callback_query(self, cb: dict) -> None:
        data = cb.get("data") or ""
        cb_id = cb.get("id")
        chat_id = cb.get("message", {}).get("chat", {}).get("id")
        message_id = cb.get("message", {}).get("message_id")
        if not data or not chat_id:
            return
        if ":" not in data:
            await self._call("answerCallbackQuery", {"callback_query_id": cb_id})
            return
        choice, req_id = data.split(":", 1)
        approved = choice == "ok"
        ok = await get_pending_store().resolve(req_id, PendingResult(answered=True, approved=approved))
        if not ok:
            await self._call("answerCallbackQuery", {"callback_query_id": cb_id, "text": "Already answered."})
            return
        # Visually freeze the original prompt so it's clear which one was answered.
        try:
            await self._call("editMessageReplyMarkup", {
                "chat_id": chat_id,
                "message_id": message_id,
                "reply_markup": {"inline_keyboard": [[{"text": "✅ Approved" if approved else "❌ Denied", "callback_data": "done"}]]},
            })
        except Exception:
            pass
        await self._call("answerCallbackQuery", {"callback_query_id": cb_id, "text": "Approved" if approved else "Denied"})

    # ---- commands ----

    async def _handle_command(self, chat_id: int, text: str) -> None:
        parts = text.split(maxsplit=1)
        cmd = parts[0].split("@", 1)[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd == "/start":
            await self._send(chat_id,
                "👋 Hi! I'm your *Confluent* personal agent bridge.\n\n"
                "To pair this chat with your account:\n"
                "1. Open the web app and click *Link Telegram* on your profile.\n"
                "2. Send me `/link CODE` with the 6-character code it shows.\n\n"
                "Once linked, I'll forward questions from your agent here, and you can chat with your agent right from Telegram.")
            return

        if cmd == "/link":
            if not arg:
                await self._send(chat_id, "Usage: `/link ABC123` (the code from the web UI).")
                return
            code = arg.split()[0].upper()
            user_id = _consume_link_code(code)
            if not user_id:
                await self._send(chat_id, "That code is invalid or expired. Generate a new one from the web UI.")
                return
            user = users_db.get_user(user_id)
            if not user:
                await self._send(chat_id, f"That code points to unknown user `{user_id}`.")
                return
            _get_store().update("users", user_id, {"telegram_chat_id": int(chat_id)})
            await self._send(chat_id, f"✅ Linked! You're now paired with *{user.get('display_name', user_id)}*. Anything you send here goes to your agent.")
            return

        if cmd == "/unlink":
            user_id = _user_id_for_chat(chat_id)
            if not user_id:
                await self._send(chat_id, "This chat isn't linked.")
                return
            _get_store().update("users", user_id, {"telegram_chat_id": None})
            await self._send(chat_id, "Unlinked. You'll stop getting agent prompts here.")
            return

        if cmd == "/reset":
            _reset_telegram_conv(chat_id)
            await self._send(chat_id, "🧹 Conversation cleared. Next message starts a fresh thread.")
            return

        if cmd == "/whoami":
            user_id = _user_id_for_chat(chat_id)
            if not user_id:
                await self._send(chat_id, "Not linked.")
                return
            user = users_db.get_user(user_id) or {}
            await self._send(chat_id, f"Linked to *{user.get('display_name','?')}* (`{user_id}`).")
            return

        if cmd == "/help":
            await self._send(chat_id,
                "Commands:\n"
                "`/start` — intro\n"
                "`/link CODE` — pair this chat with a web account\n"
                "`/unlink` — break the pairing\n"
                "`/reset` — start a fresh conversation (clears memory of prior turns)\n"
                "`/whoami` — show current pairing\n\n"
                "Anything else you type goes to your agent.")
            return

        await self._send(chat_id, f"Unknown command `{cmd}`. Try /help.")

    async def _run_chat_for_user(self, chat_id: int, user_id: str, text: str) -> None:
        # Local import: avoid circular (loop -> tools -> telegram_bridge).
        from db.chat import write_chat_message
        from .loop import run_agent_turn

        # Reuse a single conversation_id per Telegram chat so each message
        # builds on the prior turn's context ("when is she free today" →
        # "what about tomorrow"). /reset starts a fresh thread.
        conv_id = _telegram_conv_id(chat_id)
        write_chat_message(user_id, "user", text, conv_id)
        try:
            reply = await run_agent_turn(user_id, conv_id, text, mode="user_chat")
        except Exception as exc:
            log.exception("agent turn from telegram failed")
            await self._send(chat_id, f"⚠️ Your agent errored: `{exc}`")
            return
        reply_text = reply if isinstance(reply, str) else str(reply)
        await self._send(chat_id, reply_text)

    # ---- low-level ----

    async def _send(self, chat_id: int, text: str) -> None:
        log.info("SEND chat_id=%s text=%r", chat_id, text[:200])
        await self._call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})

    async def _call(self, method: str, payload: dict | None = None) -> dict | None:
        resp = await self._http_post(method, payload or {})
        if not resp:
            return None
        if not resp.get("ok"):
            log.warning("telegram %s failed: %s", method, resp)
            return None
        return resp.get("result")

    async def _http_post(self, method: str, payload: dict) -> dict | None:
        if not self._client or not self._token:
            return None
        url = f"{API_BASE}/bot{self._token}/{method}"
        r = await self._client.post(url, json=payload)
        try:
            return r.json()
        except Exception:
            return None


# ---------------------------------------------------------------------------
# helpers (module-level so tools.py can use them without holding a bridge ref)
# ---------------------------------------------------------------------------


def _chat_id_for(user_id: str) -> int | None:
    u = users_db.get_user(user_id) or {}
    cid = u.get("telegram_chat_id")
    return int(cid) if cid is not None else None


def _user_id_for_chat(chat_id: int) -> str | None:
    # LocalStore is small; linear scan is fine for the demo.
    for u in users_db.list_users():
        if u.get("telegram_chat_id") and int(u["telegram_chat_id"]) == int(chat_id):
            return u["id"]
    return None


def _telegram_conv_id(chat_id: int) -> str:
    """Stable conversation id per Telegram chat.

    Stored in the user record (telegram_conv_id) so that /reset can roll it
    forward without losing the chat_id pairing. Falls back to a chat-derived
    default the first time we see a chat.
    """
    user_id = _user_id_for_chat(chat_id)
    if not user_id:
        return f"conv_tg_{chat_id}"
    u = users_db.get_user(user_id) or {}
    cid = u.get("telegram_conv_id")
    if cid:
        return cid
    cid = f"conv_tg_{chat_id}"
    _get_store().update("users", user_id, {"telegram_conv_id": cid})
    return cid


def _reset_telegram_conv(chat_id: int) -> str:
    """Roll the conversation id forward so the next agent turn starts blank."""
    user_id = _user_id_for_chat(chat_id)
    new_cid = f"conv_tg_{chat_id}_{int(time.time())}"
    if user_id:
        _get_store().update("users", user_id, {"telegram_conv_id": new_cid})
    return new_cid


def _md_escape(s: str) -> str:
    # Markdown (legacy) escape set — leaves @ # etc alone but escapes the
    # characters that would otherwise break formatting.
    out = []
    for ch in s or "":
        if ch in "_*`[":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


# ---------------------------------------------------------------------------
# singleton
# ---------------------------------------------------------------------------


_bridge: _TelegramBridge | None = None


def get_bridge() -> _TelegramBridge:
    global _bridge
    if _bridge is None:
        _bridge = _TelegramBridge()
    return _bridge
