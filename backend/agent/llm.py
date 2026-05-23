"""LLM abstraction.

Two backends:
  - VertexLLM: real Gemini 2.0 Flash function-calling per spec.
  - MockLLM: deterministic scripted responses keyed by simple heuristics
    over the prompt. Lets the demo run offline.

Both implementations return a normalized object:
    LLMResponse(text: str | None, tool_calls: list[ToolCall])
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Iterable


@dataclass
class ToolCall:
    name: str
    args: dict


@dataclass
class LLMResponse:
    text: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass
class Turn:
    role: str  # "user" | "model" | "tool"
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_results: list[dict] = field(default_factory=list)


class LLM:
    def generate(self, *, system: str, turns: list[Turn], tool_names: list[str]) -> LLMResponse:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Vertex (real Gemini)
# ---------------------------------------------------------------------------


class VertexLLM(LLM):
    def __init__(self, model_name: str | None = None):
        import vertexai  # type: ignore
        from vertexai.generative_models import GenerativeModel, GenerationConfig  # type: ignore

        vertexai.init(
            project=os.environ["GCP_PROJECT_ID"],
            location=os.environ.get("VERTEX_LOCATION", "us-central1"),
        )
        self._model_name = model_name or os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        self._GenerativeModel = GenerativeModel
        self._GenerationConfig = GenerationConfig

    def generate(self, *, system: str, turns: list[Turn], tool_names: list[str]) -> LLMResponse:
        from vertexai.generative_models import Tool, FunctionDeclaration, Part, Content  # type: ignore
        from .tools import TOOL_SCHEMA_DICTS

        # Build FunctionDeclarations fresh each call. Constructing them via the
        # canonical class (not the dict shortcut) sets the proto's `tool_type`
        # oneof correctly, which Gemini 2.5+/3.x require.
        decls = []
        for n in tool_names:
            spec = TOOL_SCHEMA_DICTS.get(n)
            if not spec:
                continue
            decls.append(FunctionDeclaration(
                name=spec["name"],
                description=spec["description"],
                parameters=spec["parameters"],
            ))
        tool = Tool(function_declarations=decls)

        model = self._GenerativeModel(
            self._model_name,
            system_instruction=system,
            generation_config=self._GenerationConfig(
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        contents = []
        for t in turns:
            if t.role == "user" and t.content is not None:
                contents.append(Content(role="user", parts=[Part.from_text(t.content)]))
            elif t.role == "model":
                parts = []
                if t.content:
                    parts.append(Part.from_text(t.content))
                for tc in t.tool_calls:
                    parts.append(Part.from_dict({
                        "function_call": {"name": tc.name, "args": tc.args}
                    }))
                if parts:
                    contents.append(Content(role="model", parts=parts))
            elif t.role == "tool":
                parts = []
                for res in t.tool_results:
                    parts.append(Part.from_function_response(
                        name=res["name"], response={"content": res["response"]}
                    ))
                if parts:
                    contents.append(Content(role="user", parts=parts))

        # Pass tools at call time, not at model init — sidesteps a class of SDK
        # serialization bugs where the Tool oneof gets dropped during model setup.
        resp = model.generate_content(contents, tools=[tool])

        text = None
        tool_calls: list[ToolCall] = []
        for cand in resp.candidates:
            for part in cand.content.parts:
                fc = getattr(part, "function_call", None)
                if fc and fc.name:
                    tool_calls.append(ToolCall(name=fc.name, args=dict(fc.args or {})))
                else:
                    t = getattr(part, "text", None)
                    if t:
                        text = (text or "") + t

        # Diagnostic: empty responses are usually MAX_TOKENS or SAFETY. Surface
        # the finish reason so the operator can see what went wrong.
        if not text and not tool_calls:
            try:
                cand0 = resp.candidates[0] if resp.candidates else None
                finish = getattr(cand0, "finish_reason", None) if cand0 else None
                parts_count = len(cand0.content.parts) if (cand0 and getattr(cand0, "content", None)) else 0
                print(
                    f"[VertexLLM] EMPTY response — finish_reason={finish}, parts={parts_count}, "
                    f"model={self._model_name}",
                    flush=True,
                )
                pf = getattr(resp, "prompt_feedback", None)
                if pf:
                    print(f"[VertexLLM] prompt_feedback={pf}", flush=True)
            except Exception as exc:
                print(f"[VertexLLM] could not introspect empty response: {exc}", flush=True)

        return LLMResponse(text=text, tool_calls=tool_calls)


# ---------------------------------------------------------------------------
# Mock (scripted demo)
# ---------------------------------------------------------------------------


class MockLLM(LLM):
    """Heuristic scripted agent for offline demos.

    Behaviour:
      - user_chat mode (sees `message_friend` in tools): drives the canonical
        "find a time to study with X" flow — list_friends → read_calendar →
        search_notes → read_note → message_friend → propose_event → final reply.
      - agent_inbox mode (sees `reply_to_agent` in tools): read_calendar →
        reply_to_agent with proposed times.
    """

    def generate(self, *, system: str, turns: list[Turn], tool_names: list[str]) -> LLMResponse:
        inbox_mode = "reply_to_agent" in tool_names

        # Scope tool-call tracking and tool results to the CURRENT turn only —
        # everything after the most recent user message. Otherwise prior turns'
        # tool calls would make us think we'd already done the work this round.
        last_user_idx = -1
        for i in range(len(turns) - 1, -1, -1):
            if turns[i].role == "user":
                last_user_idx = i
                break
        current_segment = turns[last_user_idx + 1 :] if last_user_idx >= 0 else []

        called = {tc.name for t in current_segment if t.role == "model" for tc in t.tool_calls}
        last_tool_results: list[dict] = []
        for t in reversed(current_segment):
            if t.role == "tool":
                last_tool_results = t.tool_results
                break

        latest_user_msg = turns[last_user_idx].content if last_user_idx >= 0 else ""
        topic = _guess_topic(latest_user_msg or "", system)
        friend = _guess_friend(latest_user_msg or "", system)

        if inbox_mode:
            return self._inbox_step(called, last_tool_results, system)
        return self._user_step(called, last_tool_results, topic, friend, system, latest_user_msg or "")

    # ---- user_chat flow ----
    def _user_step(self, called, last_results, topic, friend, system, latest_user_msg: str = "") -> LLMResponse:
        msg = latest_user_msg.lower()

        # ---- time / date intent ----
        if any(kw in msg for kw in ("what time", "time is it", "current time", "what day", "what's the date", "todays date", "today's date")):
            if "get_current_time" not in called:
                return LLMResponse(text=None, tool_calls=[ToolCall("get_current_time", {})])
            for r in last_results or []:
                if r.get("name") == "get_current_time":
                    human = (r.get("response") or {}).get("human", "")
                    return LLMResponse(text=f"It's {human}.", tool_calls=[])

        if "list_friends" not in called:
            return LLMResponse(text=None, tool_calls=[ToolCall("list_friends", {})])

        if "read_calendar" not in called:
            return LLMResponse(text=None, tool_calls=[ToolCall("read_calendar", {})])

        if "search_notes" not in called:
            return LLMResponse(text=None, tool_calls=[ToolCall("search_notes", {"query": topic, "limit": 3})])

        if "read_note" not in called:
            note_id = _pick_note_id(last_results)
            if note_id:
                return LLMResponse(text=None, tool_calls=[ToolCall("read_note", {"note_id": note_id})])

        if "message_friend" not in called:
            friend_id = friend or _pick_friend_id(_friends_from_results(last_results, called))
            if not friend_id:
                friend_id = _first_friend_id(self._collect_friend_ids(_all_tool_results(_unused=None) or []))
            friend_id = friend_id or "user_priya"
            intent = (
                f"My user wants to find a 2-hour block this week to work on '{topic}' together. "
                "Please share overlapping free times from your calendar."
            )
            return LLMResponse(text=None, tool_calls=[ToolCall(
                "message_friend",
                {"friend_id": friend_id, "intent": intent, "scope_required": "friend"},
            )])

        if "propose_event" not in called:
            proposed = _first_proposed_time(last_results) or {
                "start_iso": "2026-05-27T15:00:00",
                "end_iso": "2026-05-27T17:00:00",
            }
            return LLMResponse(text=None, tool_calls=[ToolCall(
                "propose_event",
                {
                    "title": f"Study: {topic}",
                    "start_iso": proposed["start_iso"],
                    "end_iso": proposed["end_iso"],
                    "location": "Library",
                    "attendees": [friend or "user_priya"],
                },
            )])

        return LLMResponse(
            text=(
                f"I coordinated with your friend's agent on '{topic}'. "
                "I drafted a study session — check the proposed event card to confirm."
            ),
            tool_calls=[],
        )

    # ---- agent_inbox flow ----
    def _inbox_step(self, called, last_results, system) -> LLMResponse:
        if "read_calendar" not in called:
            return LLMResponse(text=None, tool_calls=[ToolCall("read_calendar", {})])

        events = last_results[0]["response"] if last_results else []
        proposed = _propose_free_blocks(events)
        summary = "I'm free " + ", ".join(
            f"{p['start_iso'][:10]} {p['start_iso'][11:16]}-{p['end_iso'][11:16]}"
            for p in proposed[:2]
        ) if proposed else "I don't see open windows this week."

        return LLMResponse(text=None, tool_calls=[ToolCall(
            "reply_to_agent",
            {"summary": summary, "data": {"proposed_times": proposed[:2]}},
        )])

    def _collect_friend_ids(self, results):
        return []


# ---------------------------------------------------------------------------
# helpers used by MockLLM
# ---------------------------------------------------------------------------


def _guess_topic(msg: str, system: str) -> str:
    m = re.search(r"(cs ?\d+|midterm|project|exam|paper|homework|assignment)", msg, re.I)
    if m:
        return m.group(0)
    return "study"


def _guess_friend(msg: str, system: str) -> str | None:
    for name, uid in [("priya", "user_priya"), ("maya", "user_maya"), ("devon", "user_devon")]:
        if re.search(rf"\b{name}\b", msg, re.I):
            return uid
    return None


def _all_tool_results(_unused=None):
    return []


def _friends_from_results(last_results, called) -> list[dict]:
    for r in last_results or []:
        if r.get("name") == "list_friends":
            data = r.get("response")
            if isinstance(data, list):
                return data
    return []


def _pick_friend_id(friends: list[dict]) -> str | None:
    for f in friends:
        if f.get("scope") in ("close_friend", "family"):
            return f.get("friend_id")
    return friends[0]["friend_id"] if friends else None


def _first_friend_id(_):
    return None


def _pick_note_id(last_results) -> str | None:
    for r in last_results or []:
        if r.get("name") == "search_notes":
            data = r.get("response")
            if isinstance(data, list) and data:
                return data[0].get("id")
    return None


def _first_proposed_time(last_results):
    for r in last_results or []:
        if r.get("name") == "message_friend":
            data = (r.get("response") or {}).get("data") or {}
            times = data.get("proposed_times") or []
            if times:
                return times[0]
    return None


def _propose_free_blocks(events: list[dict]) -> list[dict]:
    """Naive: propose two slots that don't collide with given events."""
    candidates = [
        {"start_iso": "2026-05-27T15:00:00", "end_iso": "2026-05-27T17:00:00"},
        {"start_iso": "2026-05-30T10:00:00", "end_iso": "2026-05-30T12:00:00"},
        {"start_iso": "2026-05-28T18:00:00", "end_iso": "2026-05-28T20:00:00"},
    ]
    def collides(c):
        for e in events or []:
            s, en = e.get("start"), e.get("end")
            if s and en and not (c["end_iso"] <= s or c["start_iso"] >= en):
                return True
        return False
    return [c for c in candidates if not collides(c)] or candidates[:1]


# ---------------------------------------------------------------------------
# factory
# ---------------------------------------------------------------------------


def get_llm() -> LLM:
    backend = os.environ.get("LLM_BACKEND", "mock").lower()
    if backend == "vertex":
        return VertexLLM()
    return MockLLM()
