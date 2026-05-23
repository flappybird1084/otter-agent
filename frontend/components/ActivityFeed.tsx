"use client";

import type { AgentEvent, User } from "@/lib/types";

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 5) return "now";
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

function avatarFor(uid: string | null | undefined, users: User[]) {
  if (!uid) return "•";
  return users.find((u) => u.id === uid)?.avatar_emoji ?? "•";
}

function rowLabel(e: AgentEvent, users: User[]) {
  const a = avatarFor(e.actor_user_id, users);
  const b = avatarFor(e.target_user_id, users);
  const aName =
    users.find((u) => u.id === e.actor_user_id)?.display_name?.split(" ")[0] ??
    e.actor_user_id;
  const bName =
    users.find((u) => u.id === e.target_user_id)?.display_name?.split(" ")[0] ??
    e.target_user_id;

  switch (e.type) {
    case "agent_thinking":
      return { glyph: `${a} ◇`, text: `${aName}'s agent thinking…` };
    case "tool_call":
      return {
        glyph: `${a} ⚙`,
        text: `${aName}'s agent: ${e.payload?.summary || e.payload?.tool_name}`,
      };
    case "agent_message_sent":
      return {
        glyph: `${a} → ${b}`,
        text: `${aName}'s agent → ${bName}'s agent: ${
          e.payload?.summary || "(message)"
        }${e.payload?.rejected ? "  [BLOCKED]" : ""}`,
      };
    case "agent_message_received":
      return {
        glyph: `${a} ← ${b}`,
        text: `${aName}'s agent received reply: ${e.payload?.summary || ""}`,
      };
    case "agent_replied":
      return {
        glyph: `${a} ✓`,
        text: `${aName}'s agent replied: ${e.payload?.summary || ""}`,
      };
    case "event_proposed":
      return {
        glyph: `${a} 📅`,
        text: `${aName}'s agent proposed: ${e.payload?.summary || ""}`,
      };
    case "note_changed":
      return {
        glyph: `${a} 📝`,
        text: `${aName}'s agent: ${e.payload?.summary || "note changed"}`,
      };
    case "scope_changed":
      return {
        glyph: `${a} 🔒 ${b}`,
        text: `${aName}'s agent: ${e.payload?.summary || "scope changed"}`,
      };
    case "calendar_changed":
      return {
        glyph: `${a} 📆`,
        text: `${aName}'s agent: ${e.payload?.summary || "calendar changed"}`,
      };
    default:
      return { glyph: a, text: e.type };
  }
}

export function ActivityFeed({
  events,
  users,
}: {
  events: AgentEvent[];
  users: User[];
}) {
  const rows = events.slice(0, 30);
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
        Activity
      </div>
      <ul className="flex-1 overflow-y-auto text-sm">
        {rows.length === 0 && (
          <li className="px-4 py-3 text-zinc-600 text-xs">
            No agent activity yet. Try one of the suggested prompts.
          </li>
        )}
        {rows.map((e) => {
          const { glyph, text } = rowLabel(e, users);
          const rejected = e.payload?.rejected;
          return (
            <li
              key={e.id}
              className={
                "px-4 py-1.5 border-b border-zinc-900/60 flex items-start gap-3 " +
                (rejected ? "text-red-300" : "text-zinc-300")
              }
            >
              <span className="font-mono text-xs whitespace-nowrap w-20 shrink-0 text-zinc-500">
                {glyph}
              </span>
              <span className="text-xs flex-1 leading-relaxed">{text}</span>
              <span className="text-[10px] text-zinc-600 shrink-0">
                {timeAgo(e.created_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
