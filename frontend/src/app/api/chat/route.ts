/**
 * Chat proxy.
 *
 *   POST   {message, friendId?} -> SSE
 *     friendId set  -> direct chat with that friend's agent (POST /direct-chat)
 *     friendId nul  -> self chat with your own agent       (POST /chat)
 *   GET    ?target=self|<friendId>  -> history for that thread (camel-cased)
 *   DELETE ?target=self|<friendId>  -> clears thread + the conv-id cookie
 *
 * conversationId lives in a per-target cookie so the avitest1 ChatPanel,
 * which doesn't track it, still gets a stable thread across turns.
 */
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { api, type BackendAgentEvent, type BackendChatMessage } from "@/lib/api-server";

function convCookieName(userId: string, target: string): string {
  return `confluent_conv_${userId}_${target}`;
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
    }
  | { type: "error"; message: string }
  | { type: "done" };

function asTuple(e: BackendAgentEvent): StreamEvent | null {
  const p = (e.payload || {}) as Record<string, unknown>;
  switch (e.type) {
    case "tool_call":
      return {
        type: "tool_use",
        name: String(p["tool_name"] ?? "tool"),
        input: (p["tool_args"] as unknown) ?? null,
      };
    case "agent_message_sent":
      return {
        type: "agent_message",
        fromUserId: e.actor_user_id,
        toUserId: e.target_user_id ?? "",
        intent: "message",
        payloadSent: { summary: p["summary"] ?? "" },
        payloadDelivered: { summary: p["summary"] ?? "" },
        reply: undefined,
      };
    case "agent_message_received":
      return {
        type: "agent_message",
        fromUserId: e.actor_user_id,
        toUserId: e.target_user_id ?? "",
        intent: "message",
        payloadSent: { summary: p["summary"] ?? "" },
        payloadDelivered: { summary: p["summary"] ?? "" },
        reply: { text: String(p["summary"] ?? "") },
      };
    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST: a turn (self or direct)
// ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    friendId?: string;
    conversationId?: string | null;
  };
  const message = body.message?.trim();
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const cookieJar = await cookies();
  const target = body.friendId || "self";
  const convCookie = convCookieName(user.id, target);
  const priorConvId =
    body.conversationId || cookieJar.get(convCookie)?.value || null;

  const collected: StreamEvent[] = [];
  let convId: string | null = priorConvId;
  try {
    if (body.friendId) {
      // Direct mode — the friend's agent runs against the sender
      const r = await api.postDirectChat(
        user.id,
        body.friendId,
        message,
        priorConvId,
      );
      convId = r.conversation_id;
      // Direct chats don't emit tool_use events into the shared /events feed
      // in a way we want to surface here; just stream the final text.
      collected.push({ type: "text", delta: r.reply });
      collected.push({ type: "done" });
    } else {
      // Self mode — your own agent
      const r = await api.postChat(user.id, message, priorConvId);
      convId = r.conversation_id;
      try {
        const events = await api.getEvents(80);
        const inOrder = events
          .filter((e) => e.conversation_id === r.conversation_id)
          .sort((a, b) =>
            (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1,
          );
        for (const e of inOrder) {
          const out = asTuple(e);
          if (out) collected.push(out);
        }
      } catch {
        // not fatal
      }
      collected.push({
        type: "text",
        delta: typeof r.reply === "string" ? r.reply : String(r.reply),
      });
      collected.push({ type: "done" });
    }
  } catch (err) {
    collected.push({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    collected.push({ type: "done" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of collected) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.close();
    },
  });

  const headers = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  if (convId) {
    const oneWeek = 60 * 60 * 24 * 7;
    headers.append(
      "set-cookie",
      `${convCookie}=${encodeURIComponent(convId)}; Path=/; Max-Age=${oneWeek}; SameSite=Lax`,
    );
  }

  return new Response(stream, { headers });
}

// ──────────────────────────────────────────────────────────────────────
// GET: history for a thread
// ──────────────────────────────────────────────────────────────────────

interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  targetFriendId?: string;
  createdAt: string;
}

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response(JSON.stringify({ messages: [] }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const target = url.searchParams.get("target") || "self";
  const cookieJar = await cookies();
  const convId = cookieJar.get(convCookieName(user.id, target))?.value || null;

  let rows: BackendChatMessage[] = [];
  try {
    rows =
      target === "self"
        ? await api.getChat(user.id, convId)
        : await api.getDirectChat(user.id, target, convId);
  } catch {
    rows = [];
  }

  const messages: UiChatMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role === "user" ? "user" : "assistant",
    content: r.content,
    targetFriendId: target === "self" ? undefined : target,
    createdAt: r.created_at,
  }));

  return new Response(
    JSON.stringify({ messages, conversationId: convId, target }),
    { headers: { "content-type": "application/json" } },
  );
}

// ──────────────────────────────────────────────────────────────────────
// DELETE: clear a thread (and the cookie) for a specific target
// ──────────────────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const target = url.searchParams.get("target") || "self";
  const cookieJar = await cookies();
  const convId = cookieJar.get(convCookieName(user.id, target))?.value || null;

  try {
    if (target === "self") {
      await api.deleteChat(user.id, convId);
    } else {
      await api.deleteDirectChat(user.id, target, convId);
    }
  } catch {
    // ignore — we still drop the cookie below
  }

  cookieJar.delete(convCookieName(user.id, target));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
