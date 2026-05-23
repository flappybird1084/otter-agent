"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ToolCall { name: string; output?: unknown }
interface AgentMsg {
  fromUserId: string;
  toUserId: string;
  intent: string;
  payloadSent: unknown;
  payloadDelivered: unknown;
  reply?: unknown;
  rejected?: boolean;
  reason?: string;
  summary?: string;
}
interface Friend {
  id: string;
  displayName: string;
  myScope: string;
  theirScope: string;
}
interface Message {
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
  agentMsgs?: AgentMsg[];
  targetFriendId?: string;
}

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | {
      type: "agent_message";
      fromUserId: string;
      toUserId: string;
      intent: string;
      payloadSent: unknown;
      payloadDelivered: unknown;
      reply?: unknown;
      rejected?: boolean;
      reason?: string;
      summary?: string;
    }
  | { type: "error"; message: string }
  | { type: "done" };

function nameOr(map: Record<string, string>, id: string): string {
  return map[id] ?? id.slice(0, 6);
}

function intentLabel(intent: string): string {
  switch (intent) {
    case "ask_availability": return "asking availability";
    case "propose_meeting": return "proposing meeting";
    case "message": return "message";
    default: return intent;
  }
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function replyText(r: unknown): string | null {
  if (!r || typeof r !== "object") return null;
  const obj = r as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (Array.isArray(obj.slots) && obj.slots.length > 0) {
    return `${obj.slots.length} free slot${obj.slots.length === 1 ? "" : "s"}`;
  }
  if (typeof obj.accepted === "boolean") return obj.accepted ? "accepted" : "declined";
  return null;
}

export default function ChatPanel({
  target,
  setTarget,
}: {
  target: string;
  setTarget: (id: string) => void;
}) {
  // Per-target chat threads. "self" + each friend id maps to its own array.
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [me, setMe] = useState<{ id: string; displayName: string } | null>(null);
  // Per-message expansion state for the tool / a2a strip. Keyed by
  // `${target}:${index}` so the same index in different threads doesn't
  // collide. Default state is collapsed; the live (currently-streaming)
  // message always renders expanded regardless.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const expandKey = (i: number) => `${target}:${i}`;
  const isExpanded = (i: number) => expanded[expandKey(i)] === true;
  const toggleExpanded = (i: number) =>
    setExpanded((cur) => ({ ...cur, [expandKey(i)]: !cur[expandKey(i)] }));

  const messages = threads[target] || [];

  const names = useMemo(() => {
    const out: Record<string, string> = {};
    if (me) out[me.id] = me.displayName;
    for (const f of friends) out[f.id] = f.displayName;
    return out;
  }, [me, friends]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/friends");
        if (!r.ok) return;
        const j = (await r.json()) as { friends: Friend[]; me: { id: string; displayName: string } };
        setFriends(j.friends);
        setMe(j.me);
      } catch {
        // noop
      }
    })();
  }, []);

  // When target changes, lazily fetch that thread's history.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/chat?target=${encodeURIComponent(target)}`);
        if (!r.ok) return;
        const j = (await r.json()) as {
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            targetFriendId?: string;
          }>;
        };
        const loaded: Message[] = j.messages.map((m) => ({
          role: m.role,
          content: m.content,
          targetFriendId: m.targetFriendId,
        }));
        setThreads((all) => ({ ...all, [target]: loaded }));
      } catch {
        // noop
      }
    })();
  }, [target]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function clearThread() {
    if (busy) return;
    try {
      await fetch(`/api/chat?target=${encodeURIComponent(target)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore
    }
    setThreads((all) => ({ ...all, [target]: [] }));
  }

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    const targetFriendId = target === "self" ? undefined : target;
    // Pin the target this turn writes to. If the user switches chats mid-
    // stream the reply still lands on the originating thread.
    const sendTarget = target;
    setThreads((all) => ({
      ...all,
      [sendTarget]: [
        ...(all[sendTarget] || []),
        { role: "user", content: msg, targetFriendId },
        { role: "assistant", content: "", tools: [], agentMsgs: [], targetFriendId },
      ],
    }));
    const patchSendTarget = (updater: (cur: Message[]) => Message[]) =>
      setThreads((all) => ({ ...all, [sendTarget]: updater(all[sendTarget] || []) }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, friendId: targetFriendId }),
      });
      if (!res.ok || !res.body) {
        patchSendTarget((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: "[error]" };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(6)) as StreamEvent;
            patchSendTarget((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (!last || last.role !== "assistant") return copy;
              if (data.type === "text") {
                copy[copy.length - 1] = { ...last, content: last.content + data.delta };
              } else if (data.type === "tool_use") {
                if (
                  data.name === "create_calendar_event" ||
                  data.name === "delete_calendar_event" ||
                  data.name === "propose_event"
                ) {
                  window.dispatchEvent(new CustomEvent("confluent:calendar-changed"));
                }
                if (
                  data.name === "create_note" ||
                  data.name === "update_note" ||
                  data.name === "delete_note" ||
                  data.name === "set_friend_scope"
                ) {
                  // Includes set_friend_scope so the sidebar friend rows /
                  // social rings reflect the new scope without a reload.
                  window.dispatchEvent(new CustomEvent("confluent:notes-changed", {
                    detail: { tool: data.name, input: data.input },
                  }));
                }
                copy[copy.length - 1] = {
                  ...last,
                  tools: [...(last.tools ?? []), { name: data.name }],
                };
              } else if (data.type === "tool_result") {
                const tools = [...(last.tools ?? [])];
                const idx = tools.findLastIndex((t) => t.name === data.name && t.output === undefined);
                if (idx >= 0) tools[idx] = { ...tools[idx], output: data.output };
                copy[copy.length - 1] = { ...last, tools };
              } else if (data.type === "agent_message") {
                const a2a = [...(last.agentMsgs ?? [])];
                const i = a2a.findIndex(
                  (x) => x.fromUserId === data.fromUserId && x.toUserId === data.toUserId &&
                         x.intent === data.intent && x.reply === undefined,
                );
                const entry: AgentMsg = {
                  fromUserId: data.fromUserId,
                  toUserId: data.toUserId,
                  intent: data.intent,
                  payloadSent: data.payloadSent,
                  payloadDelivered: data.payloadDelivered,
                  reply: data.reply,
                  rejected: data.rejected,
                  reason: data.reason,
                  summary: data.summary,
                };
                if (i >= 0 && data.reply !== undefined) a2a[i] = entry;
                else a2a.push(entry);
                copy[copy.length - 1] = { ...last, agentMsgs: a2a };
              } else if (data.type === "error") {
                copy[copy.length - 1] = { ...last, content: last.content + `\n[error: ${data.message}]` };
              }
              return copy;
            });
          } catch {
            // ignore malformed
          }
        }
      }
      // Stream ended — reconcile against server history so the final agent
      // text is guaranteed to render even if the SSE text event slipped past
      // the parser. Preserves the streamed tools/agentMsgs UI.
      try {
        const histRes = await fetch(
          `/api/chat?target=${encodeURIComponent(sendTarget)}`,
        );
        if (histRes.ok) {
          const j = (await histRes.json()) as {
            messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
          };
          const lastServerAssistant = [...j.messages]
            .reverse()
            .find((m) => m.role === "assistant");
          if (lastServerAssistant?.content) {
            patchSendTarget((cur) => {
              const out = [...cur];
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].role === "assistant") {
                  if (!out[i].content || out[i].content !== lastServerAssistant.content) {
                    out[i] = { ...out[i], content: lastServerAssistant.content };
                  }
                  break;
                }
              }
              return out;
            });
          }
        }
      } catch {
        // ignore — at worst the user sees the streamed state
      }
    } finally {
      setBusy(false);
    }
  }

  const activeFriend = friends.find((f) => f.id === target) ?? null;
  const targetLabel = activeFriend ? `${activeFriend.displayName}'s agent` : "your agent";
  const placeholder = activeFriend
    ? `Message ${activeFriend.displayName}'s agent…`
    : `Ask Synapse… try "ask carol if she's free saturday"`;

  return (
    <aside className="chat">
      <div className="chat-head">
        <span>Agent</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-faint)" }}>
          → {targetLabel}
        </span>
        <button
          type="button"
          onClick={clearThread}
          disabled={busy || messages.length === 0}
          title="Clear this thread"
          style={{
            marginLeft: 10,
            background: "transparent",
            border: "1px solid var(--border, #2a2a30)",
            color: "var(--fg-mute, #999)",
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            cursor: busy || messages.length === 0 ? "not-allowed" : "pointer",
            opacity: busy || messages.length === 0 ? 0.4 : 1,
          }}
        >
          Clear
        </button>
      </div>

      <div className="chat-targets">
        <button
          className={`chat-target ${target === "self" ? "active" : ""}`}
          onClick={() => setTarget("self")}
          title="Chat with your own agent"
        >
          <span className="ct-dot" style={{ background: "var(--accent)" }} />
          you
        </button>
        {friends.map((f) => (
          <button
            key={f.id}
            className={`chat-target ${target === f.id ? "active" : ""}`}
            onClick={() => setTarget(f.id)}
            title={`Chat with ${f.displayName}'s agent (their scope for you: ${f.theirScope})`}
          >
            <span className="ct-dot" style={{ background: scopeColor(f.theirScope) }} />
            {f.displayName}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="chat-feed">
        {messages.length === 0 && (
          <div className="empty">
            {activeFriend ? (
              <>
                You&apos;re messaging <b>{activeFriend.displayName}&apos;s</b> agent.<br />
                They&apos;ve granted you scope: <code>{activeFriend.theirScope}</code>.
              </>
            ) : (
              <>
                Ask your agent anything.<br />
                Try: <span style={{ color: "var(--accent)" }}>&quot;ask bob if he&apos;s free thursday afternoon&quot;</span>
              </>
            )}
          </div>
        )}
        {messages.map((m, i) => {
          const isLive = m.role === "assistant" && i === messages.length - 1 && busy;
          const hasTools = (m.tools?.length ?? 0) > 0;
          const hasA2a = (m.agentMsgs?.length ?? 0) > 0;
          const hasDetail = hasTools || hasA2a;
          // While streaming, always show the detail (so the user watches
          // progress). Once done, collapse it under a disclosure unless the
          // user has explicitly expanded it.
          const showDetail = isLive || isExpanded(i);
          const toolCount = m.tools?.length ?? 0;
          const a2aCount = m.agentMsgs?.length ?? 0;
          return (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-meta">
              <span className="who">
                {m.role === "user" ? "you" : (m.targetFriendId ? `${nameOr(names, m.targetFriendId)}'s agent` : "Synapse")}
              </span>
            </div>
            {m.role === "assistant" ? (
              <div className="msg-bubble md">
                {m.content
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  : (busy ? <span className="dots">…</span> : null)}
              </div>
            ) : (
              <div className="msg-bubble">{m.content}</div>
            )}

            {hasDetail && !showDetail && (
              <button
                type="button"
                onClick={() => toggleExpanded(i)}
                title="Show what the agent did"
                style={{
                  marginTop: 4, alignSelf: "flex-start",
                  background: "transparent", border: "1px solid var(--border-soft)",
                  borderRadius: 4, padding: "2px 8px",
                  color: "var(--fg-faint)", fontSize: 10,
                  fontFamily: "var(--font-mono)", cursor: "pointer",
                  display: "inline-flex", gap: 6, alignItems: "center",
                }}
              >
                <span>▸</span>
                <span>
                  {[
                    toolCount > 0 && `${toolCount} tool${toolCount === 1 ? "" : "s"}`,
                    a2aCount > 0 && `${a2aCount} agent msg${a2aCount === 1 ? "" : "s"}`,
                  ].filter(Boolean).join(" · ")}
                </span>
              </button>
            )}

            {hasDetail && showDetail && !isLive && (
              <button
                type="button"
                onClick={() => toggleExpanded(i)}
                title="Hide what the agent did"
                style={{
                  marginTop: 4, alignSelf: "flex-start",
                  background: "transparent", border: "1px solid var(--border-soft)",
                  borderRadius: 4, padding: "2px 8px",
                  color: "var(--fg-faint)", fontSize: 10,
                  fontFamily: "var(--font-mono)", cursor: "pointer",
                  display: "inline-flex", gap: 6, alignItems: "center",
                }}
              >
                <span>▾</span>
                <span>hide details</span>
              </button>
            )}

            {showDetail && hasTools && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {m.tools!.map((t, j) => (
                  <div key={j} className={`tool-chip ${t.output !== undefined ? "done" : ""}`}>
                    <span className="dot"></span>
                    <span>{t.name}</span>
                    {t.output !== undefined && <span style={{ color: "var(--fg-faint)" }}>✓</span>}
                  </div>
                ))}
              </div>
            )}

            {showDetail && hasA2a && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {m.agentMsgs!.map((a, j) => {
                  const inFlight = a.reply === undefined;
                  const rText = replyText(a.reply);
                  const denied = Boolean(a.rejected);
                  return (
                    <div
                      key={j}
                      className={`a2a-strip ${inFlight ? "in-flight" : "done"}${denied ? " denied" : ""}`}
                      style={denied ? {
                        background: "oklch(0.30 0.10 25 / 0.18)",
                        border: "1px solid oklch(0.55 0.16 25 / 0.55)",
                        borderRadius: 6,
                        padding: "4px 6px",
                      } : undefined}
                    >
                      <div className="a2a-avatar from" title={`${nameOr(names, a.fromUserId)}'s agent`}>
                        {initials(nameOr(names, a.fromUserId))}
                      </div>
                      <div className="a2a-wire">
                        <div className="a2a-wire-track" style={denied ? { background: "oklch(0.55 0.16 25 / 0.7)" } : undefined} />
                        {inFlight && <div className="a2a-packet forward" />}
                        {!denied && !inFlight && <div className="a2a-packet reverse" />}
                        <div className="a2a-intent-label" style={denied ? { color: "oklch(0.80 0.16 25)", fontWeight: 600 } : undefined}>
                          {denied ? `⛔ blocked (${a.reason || "denied"})` : intentLabel(a.intent)}
                        </div>
                      </div>
                      <div className="a2a-avatar to" title={`${nameOr(names, a.toUserId)}'s agent`}>
                        {initials(nameOr(names, a.toUserId))}
                      </div>
                      {!inFlight && rText && (
                        <div
                          className="a2a-strip-reply"
                          style={denied ? { color: "oklch(0.85 0.14 25)" } : undefined}
                          title={typeof a.reply === "object" ? JSON.stringify(a.reply) : ""}
                        >
                          {rText}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>
      <div className="composer">
        <div className="composer-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={placeholder}
            rows={2}
            disabled={busy}
          />
          <div className="composer-row">
            <span className="hint">⏎ to send · Shift+⏎ newline</span>
            <button className="send" onClick={() => void send()} disabled={!input.trim() || busy}>
              Send
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function scopeColor(scope: string): string {
  switch (scope) {
    case "close": return "oklch(0.78 0.16 145)";
    case "family": return "oklch(0.78 0.14 60)";
    case "friend": return "oklch(0.78 0.14 220)";
    default: return "oklch(0.60 0.04 260)";
  }
}
