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
import { requireUser } from "@/lib/auth";
import { api, type BackendAgentEvent } from "@/lib/api-server";

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (c: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      };
      try {
        const r = await api.postChat(user.id, userInput, body.conversationId);
        // Replay tool/a2a events from this conversation in order
        try {
          const events = await api.getEvents(80);
          const inOrder = events
            .filter((e) => e.conversation_id === r.conversation_id)
            .sort((a, b) =>
              (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1,
            );
          for (const e of inOrder) {
            const out = asTuple(e);
            if (out) send(out);
          }
        } catch {
          // not fatal — the text reply still goes through
        }
        // The final text
        send({ type: "text", delta: typeof r.reply === "string" ? r.reply : String(r.reply) });
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
