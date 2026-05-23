"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage, User } from "@/lib/types";

const DEMO_PROMPTS_FOR: Record<string, string[]> = {
  user_maya: [
    "Find a time to study for the CS161 midterm with Priya this week.",
    "What's on my calendar tomorrow?",
    "Do I have notes on dynamic programming?",
  ],
  user_priya: [
    "Anything in my inbox from other agents?",
    "Find a time to grab coffee with Maya this week.",
    "When am I free Saturday?",
  ],
  user_devon: [
    "Ask Maya if she wants to come to the open mic.",
    "What's my rehearsal schedule this week?",
    "Find a study window with Priya for orgo.",
  ],
};

export function ChatPanel({
  userId,
  user,
  demoMode,
  onToggleDemoMode,
}: {
  userId: string;
  user: User | null;
  demoMode: boolean;
  onToggleDemoMode: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const ms = await api.getChat(userId);
      setMessages(ms);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    setMessages((m) => [
      ...m,
      {
        id: `local-${Date.now()}`,
        user_id: userId,
        role: "user",
        content: text,
        conversation_id: conversationId || "pending",
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      const res = await api.postChat(userId, text, conversationId);
      setConversationId(res.conversation_id);
      await refresh();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          user_id: userId,
          role: "agent",
          content: `Backend error: ${String(e)}`,
          conversation_id: "err",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = DEMO_PROMPTS_FOR[userId] || [];

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{user?.avatar_emoji ?? "•"}</span>
          <div>
            <div className="text-sm text-zinc-200 font-medium">
              {user?.display_name ?? userId}
            </div>
            <div className="text-[11px] text-zinc-500">Your agent</div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={demoMode}
            onChange={onToggleDemoMode}
            className="accent-emerald-500"
          />
          Demo mode
        </label>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <div className="text-zinc-600 text-sm">
            Say hi to your agent. Try one of the suggestions below.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              "max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed " +
              (m.role === "user"
                ? "ml-auto bg-emerald-700/30 text-emerald-50 border border-emerald-800/60"
                : "bg-zinc-900 text-zinc-100 border border-zinc-800")
            }
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 inline-block">
            <span className="inline-block animate-pulse">thinking…</span>
          </div>
        )}
      </div>

      {demoMode && suggestions.length > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-1.5 border-t border-zinc-900">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded-md border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 text-zinc-300 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-zinc-900 p-3"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your agent…"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
