"""The agent turn loop.

A single function `run_agent_turn` handles both:
  - user_chat mode (the chat panel)
  - agent_inbox mode (an incoming agent-to-agent request)

The tool loop is identical. Only the system prompt and toolset differ.
"""
from __future__ import annotations

import asyncio
from typing import Literal

from db import users as users_db
from db import inbox as inbox_db
from db.chat import write_chat_message, list_chat_messages_for_conversation
from db.events import log_event

from .llm import LLMResponse, Turn, ToolCall, get_llm
from .prompts import system_prompt_user_chat, system_prompt_agent_inbox
from .tools import SELF_TOOLS, INBOX_TOOLS, execute_tool


MAX_STEPS = 8

# Hard cap on conversation history seeded into the model. Each "turn pair"
# is one user message + one agent reply. 20 pairs keeps multi-turn context
# (~last hour of chat) without ballooning the prompt forever.
HISTORY_TURN_PAIRS = 20


async def run_agent_turn(
    user_id: str,
    conversation_id: str,
    input: str,
    *,
    mode: Literal["user_chat", "agent_inbox"] = "user_chat",
    inbox_msg: dict | None = None,
) -> str | dict:
    user = users_db.get_user(user_id)
    if not user:
        raise ValueError(f"unknown user {user_id}")

    if mode == "user_chat":
        system = system_prompt_user_chat(user)
        tool_names = SELF_TOOLS
        viewer_scope: str | None = None
        reply_sink: dict | None = None
    else:
        assert inbox_msg is not None
        sender = users_db.get_user(inbox_msg["sender_user_id"]) or {"display_name": "unknown", "handle": ""}
        system = system_prompt_agent_inbox(
            receiver=user,
            sender=sender,
            scope=inbox_msg.get("scope_required", "acquaintance"),
            intent=inbox_msg["intent"],
        )
        tool_names = INBOX_TOOLS
        viewer_scope = inbox_msg.get("scope_required", "acquaintance")
        reply_sink = {"summary": None, "data": None}

    log_event(
        type="agent_thinking",
        actor_user_id=user_id,
        conversation_id=conversation_id,
        payload={"mode": mode, "input": _shorten(input, 120)},
    )

    llm = get_llm()
    turns: list[Turn] = []
    if mode == "user_chat":
        # Seed with prior conversation so the agent has memory across turns.
        history = list_chat_messages_for_conversation(user_id, conversation_id)
        # Keep only the most recent ~HISTORY_TURN_PAIRS round-trips so very long
        # threads stay within budget. Slice on raw messages, not pairs, since
        # role ordering may not be strictly alternating after errors.
        history = history[-(HISTORY_TURN_PAIRS * 2):]
        for m in history:
            if m["role"] == "user":
                turns.append(Turn(role="user", content=m["content"]))
            elif m["role"] == "agent":
                turns.append(Turn(role="model", content=m["content"]))
    # Make sure the current user input is the trailing user turn.
    # (history may already include it if main.py persisted it first.)
    if not turns or turns[-1].role != "user" or turns[-1].content != input:
        turns.append(Turn(role="user", content=input))

    async def a2a_dispatch(inbox_id: str) -> dict:
        # In-process recursive dispatch. Same code path as POST /agent-to-agent.
        msg = inbox_db.get_inbox_message(inbox_id)
        if not msg:
            return {"error": "inbox_not_found"}
        inbox_db.update_inbox_message(inbox_id, {"status": "processing"})
        reply = await run_agent_turn(
            user_id=msg["recipient_user_id"],
            conversation_id=msg["conversation_id"],
            input=msg["intent"],
            mode="agent_inbox",
            inbox_msg=msg,
        )
        return reply if isinstance(reply, dict) else {"summary": str(reply), "data": {}}

    nudge_count = 0
    for step in range(MAX_STEPS):
        # The Vertex SDK is sync (grpc). Run it in a thread so we don't block the
        # event loop while waiting on Gemini — other HTTP requests (calendar
        # polling, events feed, etc) need to keep flowing during a chat turn.
        response: LLMResponse = await asyncio.to_thread(
            llm.generate, system=system, turns=turns, tool_names=tool_names
        )

        # If the model returns absolutely nothing (no text, no tool calls), nudge
        # and retry. Gemini does this occasionally — sometimes on the very first
        # call (empty initial output), sometimes after a tool call when it forgets
        # reply_to_agent. Cap at 2 nudges per turn so we don't loop forever.
        if (
            not response.tool_calls
            and not (response.text or "").strip()
            and nudge_count < 2
        ):
            nudge_count += 1
            had_tool_results = any(t.role == "tool" for t in turns)
            if mode == "agent_inbox":
                nudge = (
                    "You must call reply_to_agent now (this is the only way the sender hears you). "
                    "If you have proposed times, include them in `data.proposed_times` as "
                    "[{start_iso, end_iso}, ...]. If you have nothing useful, still call it with a summary explaining why."
                )
            elif had_tool_results:
                nudge = "Continue: either call another tool or produce your final answer now."
            else:
                # First call came back empty before we got anywhere — push the
                # model to actually start using tools / answering.
                nudge = (
                    "You returned no text and no tool calls. Try again: either call a tool to "
                    "gather what you need, or write a direct answer to the user's question."
                )
            turns.append(Turn(role="user", content=nudge))
            continue

        if not response.tool_calls:
            final_text = response.text or "(no reply)"
            if mode == "user_chat":
                write_chat_message(user_id, "agent", final_text, conversation_id)
                log_event(
                    type="agent_replied",
                    actor_user_id=user_id,
                    conversation_id=conversation_id,
                    payload={"summary": _shorten(final_text, 120)},
                )
                return final_text
            # agent_inbox mode: the model bailed without calling reply_to_agent.
            # Wrap its loose text into a proper reply so the sender sees something
            # useful instead of "(no reply)".
            if inbox_msg:
                inbox_db.update_inbox_message(inbox_msg["id"], {
                    "status": "complete",
                    "reply": final_text,
                    "reply_data": {},
                })
            log_event(
                type="agent_replied",
                actor_user_id=user_id,
                target_user_id=(inbox_msg or {}).get("sender_user_id"),
                conversation_id=conversation_id,
                payload={"summary": _shorten(final_text, 120), "wrapped_from_text": True},
            )
            return {"summary": final_text, "reply_data": {}}

        tool_results = []
        for call in response.tool_calls:
            log_event(
                type="tool_call",
                actor_user_id=user_id,
                conversation_id=conversation_id,
                payload={
                    "tool_name": call.name,
                    "tool_args": call.args,
                    "summary": _summarize_tool_call(call),
                },
            )
            result = await execute_tool(
                call.name,
                call.args,
                actor_user_id=user_id,
                conversation_id=conversation_id,
                viewer_scope=viewer_scope,
                a2a_dispatch=a2a_dispatch,
                reply_sink=reply_sink,
            )
            tool_results.append({"name": call.name, "response": result})

            # In inbox mode, reply_to_agent terminates the turn.
            if mode == "agent_inbox" and call.name == "reply_to_agent" and reply_sink:
                summary = reply_sink.get("summary") or "(no summary)"
                data = reply_sink.get("data") or {}
                if inbox_msg:
                    inbox_db.update_inbox_message(inbox_msg["id"], {
                        "status": "complete",
                        "reply": summary,
                        "reply_data": data,
                    })
                log_event(
                    type="agent_replied",
                    actor_user_id=user_id,
                    target_user_id=(inbox_msg or {}).get("sender_user_id"),
                    conversation_id=conversation_id,
                    payload={"summary": _shorten(summary, 120)},
                )
                return {"summary": summary, "reply_data": data}

        turns.append(Turn(role="model", tool_calls=response.tool_calls, content=response.text))
        turns.append(Turn(role="tool", tool_results=tool_results))

    fallback = "I got stuck thinking about that. Try rephrasing?"
    if mode == "user_chat":
        write_chat_message(user_id, "agent", fallback, conversation_id)
    return fallback


def _shorten(s: str, n: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


def _summarize_tool_call(call: ToolCall) -> str:
    if call.name == "message_friend":
        return f"→ {call.args.get('friend_id')}: {_shorten(call.args.get('intent',''), 60)}"
    if call.name == "search_notes":
        return f"search '{call.args.get('query','')}'"
    if call.name == "read_note":
        return f"read {call.args.get('note_id','')}"
    if call.name == "read_calendar":
        return f"calendar {call.args.get('start_date','')}..{call.args.get('end_date','')}"
    if call.name == "propose_event":
        return f"propose '{call.args.get('title','')}' @ {call.args.get('start_iso','')[:16]}"
    if call.name == "reply_to_agent":
        return _shorten(call.args.get("summary", ""), 80)
    return call.name
