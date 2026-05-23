/**
 * Synchronous-chat → fake-SSE adapter.
 *
 * The avitest1 ChatPanel speaks SSE with the events:
 *   text / tool_use / tool_result / agent_message / error / done
 *
 * Our FastAPI /chat is one-shot. After it returns, we re-fetch
 * /events?limit=... and replay the matching conversation_id as SSE
 * so the inline tool chips and a2a strips still light up.
 */
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { api, type BackendAgentEvent } from "@/lib/api-server";

function convCookieName(userId: string, target: string): string {
  // Per (me, chat-target) so chats with different friends don't bleed history.
  return `confluent_conv_${userId}_${target}`;
}

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
  const target = new URL(req.url).searchParams.get("target") || "self";
  const c = await cookies();
  c.delete(convCookieName(user.id, target));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
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

  // Wrap a message-to-friend into an intent the user's agent can route via
  // message_friend (still goes through OUR agent loop so scope enforces).
  const userInput = body.friendId
    ? `Please message ${body.friendId}'s agent (via message_friend) with: "${message}"`
    : message;

  // Conversation continuity: client doesn't track conv id, so we keep one
  // cookie per (user, chat-target). First turn -> backend mints one, we
  // store it. Subsequent turns reuse it so the agent has history.
  const cookieJar = await cookies();
  const target = body.friendId || "self";
  const convCookie = convCookieName(user.id, target);
  const priorConvId =
    body.conversationId || cookieJar.get(convCookie)?.value || null;

  // Do the backend call BEFORE building the Response so we can include
  // Set-Cookie in the response headers. (Cookies written via cookies().set
  // after streaming begins are silently dropped in Next.js.)
  let collected: StreamEvent[] = [];
  let convId: string | null = priorConvId;
  try {
    const r = await api.postChat(user.id, userInput, priorConvId);
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
      // not fatal — text still flows
    }
    collected.push({
      type: "text",
      delta: typeof r.reply === "string" ? r.reply : String(r.reply),
    });
    collected.push({ type: "done" });
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
    // 7-day persistence. Non-HttpOnly because the cookie is per-tab convenience,
    // not a security boundary (the user picker isn't authenticated either).
    const oneWeek = 60 * 60 * 24 * 7;
    headers.append(
      "set-cookie",
      `${convCookie}=${encodeURIComponent(convId)}; Path=/; Max-Age=${oneWeek}; SameSite=Lax`,
    );
  }

  return new Response(stream, { headers });
}
