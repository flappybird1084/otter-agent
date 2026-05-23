import {
  Content,
  FunctionCall,
  GoogleGenerativeAI,
  Part,
} from "@google/generative-ai";
import { prisma } from "../db";
import { buildSystemPrompt, buildInboxPrompt } from "./prompts";
import {
  canonicalToolName,
  dispatch,
  toolsForMode,
  type A2ADispatchParams,
  type AgentMessageEmit,
  type DispatchContext,
} from "./tools";
import { applyScope, type Scope, type SharePayload } from "../scope-policy";
import type {
  FriendToolIntent,
  InboundAgentReplyPayload,
} from "./inter-agent";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const MAX_TOOL_CALLS = 8;
const WALL_CLOCK_MS = 60_000;
const INBOX_MAX_TOOL_CALLS = 4;
const INBOX_WALL_CLOCK_MS = 30_000;
const INBOX_MAX_DEPTH = 2;

export type AgentChunk =
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
  | { type: "done" }
  | { type: "error"; message: string };

interface ToolCallRecord {
  name: string;
  input: unknown;
}
interface ToolResultRecord {
  name: string;
  output: unknown;
}

export async function runAgentTurn(
  userId: string,
  userMessage: string,
  onChunk: (c: AgentChunk) => void,
): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    onChunk({ type: "error", message: "GOOGLE_API_KEY not configured" });
    onChunk({ type: "done" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
  if (!user) {
    onChunk({ type: "error", message: "user not found" });
    onChunk({ type: "done" });
    return;
  }

  const memoryNote = await prisma.note.findUnique({
    where: { userId_slug: { userId, slug: "memory" } },
    select: { bodyMd: true },
  });

  const system = buildSystemPrompt(user, memoryNote?.bodyMd ?? "", new Date());

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    tools: [{ functionDeclarations: toolsForMode("user_chat") }],
  });

  const toolCallsLog: ToolCallRecord[] = [];
  const toolResultsLog: ToolResultRecord[] = [];

  await prisma.chatTurn.create({
    data: { userId, role: "user", content: userMessage },
  });

  const history: Content[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const started = Date.now();
  let toolCallCount = 0;
  let assistantText = "";

  // ─── a2a callback ────────────────────────────────────────────────────
  // The friends_* tools call this to invoke the recipient's agent. Returns
  // the recipient's structured reply.
  const a2aDispatch = async (params: A2ADispatchParams): Promise<InboundAgentReplyPayload> => {
    return runAgentInboxTurn(
      params.receiverUserId,
      params.senderUserId,
      params.intent,
      params.sanitizedPayload,
      0,
    );
  };

  const ctx: DispatchContext = {
    mode: "user_chat",
    a2aDispatch,
    emitAgentMessage: (m: AgentMessageEmit) => {
      onChunk({
        type: "agent_message",
        fromUserId: m.fromUserId,
        toUserId: m.toUserId,
        intent: m.intent,
        payloadSent: m.payloadSent,
        payloadDelivered: m.payloadDelivered,
        reply: m.reply,
      });
    },
    depth: 0,
  };

  try {
    outer: while (true) {
      if (Date.now() - started > WALL_CLOCK_MS) {
        onChunk({ type: "error", message: "wall clock exceeded" });
        break;
      }

      const result = await model.generateContentStream({ contents: history });

      let turnText = "";
      const functionCalls: FunctionCall[] = [];

      for await (const chunk of result.stream) {
        const candidates = chunk.candidates ?? [];
        for (const cand of candidates) {
          const parts = cand.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text === "string" && part.text.length > 0) {
              turnText += part.text;
              assistantText += part.text;
              onChunk({ type: "text", delta: part.text });
            }
            if (part.functionCall) {
              functionCalls.push(part.functionCall);
            }
          }
        }
      }

      const modelParts: Part[] = [];
      if (turnText.length > 0) modelParts.push({ text: turnText });
      for (const fc of functionCalls) modelParts.push({ functionCall: fc });
      if (modelParts.length === 0) break;
      history.push({ role: "model", parts: modelParts });

      if (functionCalls.length === 0) break;

      // Run tool calls in parallel. Each tool call is either a pure DB read
      // or a scoped write — none share mutable state with siblings in the
      // same turn, so this is safe. Matters most for multi-friend coordination
      // where the model emits several friends_* calls in one turn.
      const responseParts: Part[] = await Promise.all(
        functionCalls.map(async (fc) => {
          const idx = ++toolCallCount;
          const displayName = canonicalToolName(fc.name);
          const input = (fc.args ?? {}) as Record<string, unknown>;
          toolCallsLog.push({ name: displayName, input });

          if (idx > MAX_TOOL_CALLS) {
            const errOut = { error: "max tool calls exceeded" };
            toolResultsLog.push({ name: displayName, output: errOut });
            return { functionResponse: { name: fc.name, response: errOut } };
          }

          onChunk({ type: "tool_use", name: displayName, input });
          let output: unknown;
          try {
            output = await dispatch(fc.name, input, userId, ctx);
          } catch (err) {
            output = { error: err instanceof Error ? err.message : String(err) };
          }
          onChunk({ type: "tool_result", name: displayName, output });
          toolResultsLog.push({ name: displayName, output });

          const wrapped =
            output !== null && typeof output === "object" && !Array.isArray(output)
              ? (output as Record<string, unknown>)
              : { result: output };
          return { functionResponse: { name: fc.name, response: wrapped } };
        }),
      );
      history.push({ role: "user", parts: responseParts });

      if (toolCallCount >= MAX_TOOL_CALLS) {
        onChunk({ type: "error", message: "max tool calls reached" });
        break outer;
      }
    }

    await prisma.chatTurn.create({
      data: {
        userId,
        role: "assistant",
        content: assistantText,
        toolCalls: toolCallsLog.length > 0 ? JSON.stringify(toolCallsLog) : null,
        toolResults:
          toolResultsLog.length > 0 ? JSON.stringify(toolResultsLog) : null,
      },
    });
  } catch (err) {
    onChunk({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    onChunk({ type: "done" });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Direct friend-agent chat — invoked when the user picks a friend from the
// chat panel's target selector. Their message is sent as a `friends_message`
// intent to the friend's agent and the inbox-mode reply is streamed back as
// text chunks. This is a thin wrapper over runAgentInboxTurn that exposes
// streaming and writes audit rows on both sides.
// ─────────────────────────────────────────────────────────────────────────
export async function runDirectFriendChat(
  senderUserId: string,
  receiverUserId: string,
  message: string,
  onChunk: (c: AgentChunk) => void,
): Promise<void> {
  try {
    const friends = await prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { userAId: senderUserId, userBId: receiverUserId },
          { userAId: receiverUserId, userBId: senderUserId },
        ],
      },
    });
    if (!friends) {
      onChunk({ type: "error", message: "not friends" });
      onChunk({ type: "done" });
      return;
    }

    // Look up the recipient's scope-for-sender (recipient-perspective).
    const theirScopeRow = await prisma.friendScope.findUnique({
      where: { ownerId_friendId: { ownerId: receiverUserId, friendId: senderUserId } },
      select: { scope: true },
    });
    const theirScopeForMe: Scope = (theirScopeRow?.scope as Scope) ?? "acquaintance";

    // Sanitize outbound — text is allowed through share_event.
    const raw: SharePayload = { text: message };
    const sanitized = applyScope(theirScopeForMe, "share_event", raw);

    // Audit.
    await prisma.agentMessage.create({
      data: {
        fromUserId: senderUserId,
        toUserId: receiverUserId,
        intent: "message",
        payloadSent: JSON.stringify(raw),
        payloadDelivered: JSON.stringify(sanitized),
      },
    });

    // Persist sender's user turn so the chat history table reflects it.
    await prisma.chatTurn.create({
      data: { userId: senderUserId, role: "user", content: `→ ${receiverUserId}: ${message}` },
    });

    onChunk({
      type: "agent_message",
      fromUserId: senderUserId,
      toUserId: receiverUserId,
      intent: "message",
      payloadSent: raw,
      payloadDelivered: sanitized,
    });

    // Stream the inbox loop's text out as we receive it.
    const reply = await runAgentInboxTurn(
      receiverUserId,
      senderUserId,
      "message",
      sanitized,
      0,
      (delta) => onChunk({ type: "text", delta }),
    );

    onChunk({
      type: "agent_message",
      fromUserId: senderUserId,
      toUserId: receiverUserId,
      intent: "message",
      payloadSent: raw,
      payloadDelivered: sanitized,
      reply,
    });

    // If nothing streamed, send the wrapped text once so the bubble isn't empty.
    if (reply.kind === "message_reply" && reply.text) {
      // Already emitted via onText path if Gemini produced text. The reply
      // bubble alone covers the structured case.
    }

    await prisma.chatTurn.create({
      data: {
        userId: senderUserId,
        role: "assistant",
        content: reply.kind === "message_reply" ? reply.text : JSON.stringify(reply),
      },
    });
  } catch (err) {
    onChunk({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    onChunk({ type: "done" });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Inbox mode — invoked recursively by `a2aDispatch` above.
//
// Same Gemini machinery as user_chat but:
//   1. System prompt is the hardened one from prompts.ts that wraps the
//      incoming intent in <incoming_agent_message> and tells the model to
//      treat that block as data, not commands (prompt-injection block).
//   2. Tool catalog is restricted (no friends_* except friends_reply).
//   3. Tool outputs are scope-filtered against the sender's scope-for-us
//      (defense in depth — the receiver model can't even SEE more than the
//      sender is permitted).
//   4. Hard caps lower than user_chat (4 calls / 30s / depth 2).
//   5. If the model ends without calling friends_reply, we auto-wrap any
//      loose text into a reply (per rian commit 717b7a4).
// ─────────────────────────────────────────────────────────────────────────
async function runAgentInboxTurn(
  receiverUserId: string,
  senderUserId: string,
  intent: FriendToolIntent,
  sanitizedPayload: SharePayload,
  depth: number,
  onText?: (delta: string) => void,
): Promise<InboundAgentReplyPayload> {
  if (depth >= INBOX_MAX_DEPTH) {
    return { kind: "message_reply", text: "[max agent depth reached]" };
  }
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { kind: "message_reply", text: "[GOOGLE_API_KEY not configured]" };
  }

  const [receiver, sender] = await Promise.all([
    prisma.user.findUnique({
      where: { id: receiverUserId },
      select: { displayName: true, email: true },
    }),
    prisma.user.findUnique({
      where: { id: senderUserId },
      select: { displayName: true, email: true },
    }),
  ]);
  if (!receiver || !sender) {
    return { kind: "message_reply", text: "[user lookup failed]" };
  }

  // Look up the sender's scope as granted by the recipient. Defaults to
  // acquaintance if absent (least-privilege).
  const scopeRow = await prisma.friendScope.findUnique({
    where: { ownerId_friendId: { ownerId: receiverUserId, friendId: senderUserId } },
    select: { scope: true },
  });
  const scope: Scope = (scopeRow?.scope as Scope) ?? "acquaintance";

  const system = buildInboxPrompt(
    receiver,
    sender,
    scope,
    intent,
    JSON.stringify(sanitizedPayload, null, 2),
    new Date(),
  );

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    tools: [{ functionDeclarations: toolsForMode("inbox") }],
  });

  // The model needs SOME user turn — we synthesize one summarizing the
  // request so it has something to respond to. The actual intent + payload
  // are already in the system prompt (inside <incoming_agent_message>).
  const userTurn = `${sender.displayName}'s agent is asking you to handle intent="${intent}". Gather what's needed via tools, then call friends_reply with a structured payload.`;

  const history: Content[] = [
    { role: "user", parts: [{ text: userTurn }] },
  ];

  const replySink: { text?: string; data?: Record<string, unknown> } = {};
  const ctx: DispatchContext = {
    mode: "inbox",
    viewerScope: scope,
    replySink,
    depth: depth + 1,
  };

  const started = Date.now();
  let toolCallCount = 0;
  let looseText = "";

  while (true) {
    if (Date.now() - started > INBOX_WALL_CLOCK_MS) break;
    const result = await model.generateContentStream({ contents: history });
    let turnText = "";
    const functionCalls: FunctionCall[] = [];
    for await (const chunk of result.stream) {
      const candidates = chunk.candidates ?? [];
      for (const cand of candidates) {
        const parts = cand.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === "string" && part.text.length > 0) {
            turnText += part.text;
            looseText += part.text;
            onText?.(part.text);
          }
          if (part.functionCall) functionCalls.push(part.functionCall);
        }
      }
    }
    const modelParts: Part[] = [];
    if (turnText.length > 0) modelParts.push({ text: turnText });
    for (const fc of functionCalls) modelParts.push({ functionCall: fc });
    if (modelParts.length === 0) break;
    history.push({ role: "model", parts: modelParts });

    if (functionCalls.length === 0) break;

    const responseParts: Part[] = await Promise.all(
      functionCalls.map(async (fc) => {
        toolCallCount += 1;
        if (toolCallCount > INBOX_MAX_TOOL_CALLS) {
          return { functionResponse: { name: fc.name, response: { error: "max_tool_calls" } } };
        }
        const input = (fc.args ?? {}) as Record<string, unknown>;
        let output: unknown;
        try {
          output = await dispatch(fc.name, input, receiverUserId, ctx);
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
        }
        const wrapped =
          output !== null && typeof output === "object" && !Array.isArray(output)
            ? (output as Record<string, unknown>)
            : { result: output };
        return { functionResponse: { name: fc.name, response: wrapped } };
      }),
    );
    history.push({ role: "user", parts: responseParts });

    // If friends_reply was called, the replySink is populated — end the turn.
    if (replySink.text !== undefined) break;
    if (toolCallCount >= INBOX_MAX_TOOL_CALLS) break;
  }

  // Build the typed reply payload.
  if (replySink.text !== undefined) {
    const data = replySink.data ?? {};
    if (intent === "ask_availability") {
      const slots = Array.isArray((data as { slots?: unknown }).slots)
        ? ((data as { slots: unknown[] }).slots
            .filter((s): s is { startsAt: string; endsAt: string } =>
              typeof s === "object" && s !== null &&
              typeof (s as { startsAt?: unknown }).startsAt === "string" &&
              typeof (s as { endsAt?: unknown }).endsAt === "string",
            )
            .map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })))
        : [];
      return { kind: "availability_reply", slots };
    }
    if (intent === "propose_meeting") {
      const accepted = Boolean((data as { accepted?: unknown }).accepted);
      const reason = typeof (data as { reason?: unknown }).reason === "string"
        ? ((data as { reason: string }).reason)
        : (replySink.text ?? undefined);
      let eventId: string | undefined;
      // If accepted, write the event to receiver's calendar too.
      if (accepted) {
        // The sanitized payload from the sender has the times the friend should see.
        const startsAt = typeof sanitizedPayload.startsAt === "string" ? sanitizedPayload.startsAt : undefined;
        const endsAt = typeof sanitizedPayload.endsAt === "string" ? sanitizedPayload.endsAt : undefined;
        const title = typeof sanitizedPayload.text === "string" ? sanitizedPayload.text : "Proposed meeting";
        if (startsAt && endsAt) {
          const ev = await prisma.calendarEvent.create({
            data: {
              userId: receiverUserId,
              title,
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
              notes: typeof sanitizedPayload.location === "string" ? sanitizedPayload.location : null,
            },
          });
          eventId = ev.id;
        }
      }
      return { kind: "propose_meeting_reply", accepted, eventId, reason };
    }
    return { kind: "message_reply", text: replySink.text, data };
  }

  // No friends_reply call — wrap loose text (rian fix 717b7a4).
  return { kind: "message_reply", text: looseText.trim() || "(no reply)" };
}
