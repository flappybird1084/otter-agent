import { requireUser } from "@/lib/auth";
import { runAgentTurn, runDirectFriendChat, type AgentChunk } from "@/lib/agent/loop";

/**
 * SSE streaming chat endpoint.
 *
 * Two modes:
 *   - default: runAgentTurn — chat with your own agent (full toolset).
 *   - friendId set: runDirectFriendChat — your message is delivered as a
 *     friends_message intent to that friend's agent, sanitized through their
 *     scope-for-you, and the reply is streamed back.
 *
 * Wire format: `data: <json>\n\n` per the EventSource spec.
 */
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

  const body = (await req.json().catch(() => ({}))) as { message?: string; friendId?: string };
  const message = body.message?.trim();
  const friendId = body.friendId?.trim();
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (c: AgentChunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      };
      try {
        if (friendId) {
          await runDirectFriendChat(user.id, friendId, message, send);
        } else {
          await runAgentTurn(user.id, message, send);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
