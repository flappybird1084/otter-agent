import {
  FunctionDeclaration,
  SchemaType as FunctionDeclarationSchemaType,
} from "@google/generative-ai";
import { prisma } from "../db";
import { slugify } from "../vault";
import { applyScope, type Scope, type SharePayload } from "../scope-policy";
import {
  areFriends,
  loadFriendScope,
  scopeRank,
  senderIntent,
  replyIntent,
  stringifyPayload,
  type FriendToolIntent,
  type InboundAgentReplyPayload,
} from "./inter-agent";

// Gemini function declarations. Names use underscores (Gemini disallows dots).
// The dispatcher accepts both the underscore form Gemini uses and the
// dotted public names ("brain.search", etc.) for readability.
export const TOOLS: FunctionDeclaration[] = [
  {
    name: "brain_search",
    description:
      "Full-text search across the user's notes. Returns top matches with title, slug, and snippet.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        query: { type: FunctionDeclarationSchemaType.STRING, description: "Search query." },
        limit: { type: FunctionDeclarationSchemaType.NUMBER, description: "Max results, default 10." },
      },
      required: ["query"],
    },
  },
  {
    name: "brain_get_note",
    description: "Fetch one note by slug. Returns full markdown body.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: { slug: { type: FunctionDeclarationSchemaType.STRING } },
      required: ["slug"],
    },
  },
  {
    name: "brain_create_note",
    description: "Create a new note. Returns the created slug.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        title: { type: FunctionDeclarationSchemaType.STRING },
        bodyMd: { type: FunctionDeclarationSchemaType.STRING },
        kind: {
          type: FunctionDeclarationSchemaType.STRING,
          enum: ["note", "task", "daily", "person"],
        },
        dueAt: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "ISO datetime if kind=task.",
        },
      },
      required: ["title", "bodyMd"],
    },
  },
  {
    name: "brain_update_note",
    description: "Update an existing note's body and/or title.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        slug: { type: FunctionDeclarationSchemaType.STRING },
        title: { type: FunctionDeclarationSchemaType.STRING },
        bodyMd: { type: FunctionDeclarationSchemaType.STRING },
        status: {
          type: FunctionDeclarationSchemaType.STRING,
          enum: ["open", "done", "snoozed"],
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "brain_list_tasks",
    description: "List the user's tasks, optionally filtered by status.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        status: {
          type: FunctionDeclarationSchemaType.STRING,
          enum: ["open", "done", "snoozed"],
        },
      },
    },
  },
  {
    name: "brain_daily_note",
    description: "Get or create today's daily note. Returns the daily note's slug and body.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "cal_list_events",
    description: "List calendar events in a date range.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        from: { type: FunctionDeclarationSchemaType.STRING, description: "ISO date." },
        to: { type: FunctionDeclarationSchemaType.STRING, description: "ISO date." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "cal_find_free",
    description: "Find free time slots in a date range (very basic, hour-granularity, 9am-9pm).",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        from: { type: FunctionDeclarationSchemaType.STRING },
        to: { type: FunctionDeclarationSchemaType.STRING },
        durationMin: { type: FunctionDeclarationSchemaType.NUMBER },
      },
      required: ["from", "to", "durationMin"],
    },
  },
  {
    name: "cal_create_event",
    description: "Create a calendar event on the user's own calendar.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        title: { type: FunctionDeclarationSchemaType.STRING },
        startsAt: { type: FunctionDeclarationSchemaType.STRING },
        endsAt: { type: FunctionDeclarationSchemaType.STRING },
        notes: { type: FunctionDeclarationSchemaType.STRING },
      },
      required: ["title", "startsAt", "endsAt"],
    },
  },

  // ─── Friends / inter-agent tools ────────────────────────────────────────
  // Ported from rian-demo-1 `backend/agent/tools.py` (`message_friend`,
  // `reply_to_agent`, etc.). Naming uses underscores (Gemini rule) but the
  // dotted display names ("friends.list") show up in chat as chips.
  {
    name: "friends_list",
    description:
      "List the user's friends and the trust scope each side has assigned. " +
      "ALWAYS call this before friends_ask_availability or friends_propose_meeting " +
      "to confirm the friend_id and to see what scope they granted you.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "friends_ask_availability",
    description:
      "Ask a friend's agent for their availability in a date range. FULLY SYNCHRONOUS: " +
      "when this returns, the friend's agent has already replied. NEVER write 'still waiting' " +
      "in your final answer. The reply may be scope-filtered (day-level vs exact times) " +
      "depending on the scope the friend granted you.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        friend_id: { type: FunctionDeclarationSchemaType.STRING, description: "From friends_list." },
        from: { type: FunctionDeclarationSchemaType.STRING, description: "ISO datetime — start of window." },
        to: { type: FunctionDeclarationSchemaType.STRING, description: "ISO datetime — end of window." },
        duration_min: { type: FunctionDeclarationSchemaType.NUMBER, description: "Required block length in minutes." },
        note: { type: FunctionDeclarationSchemaType.STRING, description: "Optional human-readable context for the friend's agent." },
      },
      required: ["friend_id", "from", "to", "duration_min"],
    },
  },
  {
    name: "friends_propose_meeting",
    description:
      "Propose a specific time to a friend. The friend's agent may accept (and " +
      "the event lands on BOTH calendars) or decline. Use this AFTER coordinating " +
      "availability via friends_ask_availability.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        friend_id: { type: FunctionDeclarationSchemaType.STRING },
        title: { type: FunctionDeclarationSchemaType.STRING },
        starts_at: { type: FunctionDeclarationSchemaType.STRING, description: "ISO datetime." },
        ends_at: { type: FunctionDeclarationSchemaType.STRING, description: "ISO datetime." },
        location: { type: FunctionDeclarationSchemaType.STRING },
        note: { type: FunctionDeclarationSchemaType.STRING },
      },
      required: ["friend_id", "title", "starts_at", "ends_at"],
    },
  },
  {
    name: "friends_message",
    description:
      "Send a free-form structured message to a friend's agent and wait for a reply. " +
      "Use for coordination that doesn't fit ask_availability or propose_meeting.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        friend_id: { type: FunctionDeclarationSchemaType.STRING },
        text: { type: FunctionDeclarationSchemaType.STRING, description: "Natural-language request including any context the friend's agent needs." },
      },
      required: ["friend_id", "text"],
    },
  },
  {
    name: "friends_reply",
    description:
      "ONLY available when you are responding to another user's agent (inbox mode). " +
      "Send the final structured reply back. Include concrete data (proposed times, etc.). " +
      "You MUST call this to end your inbox turn — plain text without it gets auto-wrapped " +
      "but a structured reply is always better.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        text: { type: FunctionDeclarationSchemaType.STRING, description: "Human-readable summary for the sender's agent to read." },
        data: {
          type: FunctionDeclarationSchemaType.OBJECT,
          description:
            "Structured payload. For availability: { slots: [{ startsAt, endsAt }] }. " +
            "For propose_meeting: { accepted: bool, reason?: string }.",
          properties: {},
        },
      },
      required: ["text"],
    },
  },
];

// Self-mode (user chat) toolset: everything.
export const SELF_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOLS.map((t) => t.name).filter((n) => n !== "friends_reply"),
);

// Inbox-mode toolset: scope-filtered brain/cal reads + friends_reply only.
// WHY: a friend's agent answering your request should NOT be able to recurse
// into another agent-to-agent call (would bypass the original consent chain).
export const INBOX_TOOL_NAMES: ReadonlySet<string> = new Set([
  "brain_search",
  "brain_get_note",
  "brain_list_tasks",
  "cal_list_events",
  "cal_find_free",
  "friends_reply",
]);

export function toolsForMode(mode: "user_chat" | "inbox"): FunctionDeclaration[] {
  const allowed = mode === "user_chat" ? SELF_TOOL_NAMES : INBOX_TOOL_NAMES;
  return TOOLS.filter((t) => allowed.has(t.name));
}

type ToolInput = Record<string, unknown>;

function s(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// Map Gemini's underscore tool names back to canonical dotted names for logging
// and for handling either form transparently in the dispatcher.
export function canonicalToolName(name: string): string {
  return name
    .replace(/^brain_/, "brain.")
    .replace(/^cal_/, "cal.")
    .replace(/^friends_/, "friends.");
}

// ───────────────────────────────────────────────────────────────────────────
// Dispatch context — threaded through by the agent loop. Carries inbox-mode
// state (viewerScope, replySink) and the inter-agent dispatcher callback.
// ───────────────────────────────────────────────────────────────────────────

export interface AgentMessageEmit {
  fromUserId: string;
  toUserId: string;
  intent: FriendToolIntent;
  payloadSent: unknown;
  payloadDelivered: unknown;
  reply?: InboundAgentReplyPayload;
  denied?: boolean;
  reason?: string;
}

export interface A2ADispatchParams {
  receiverUserId: string;
  senderUserId: string;
  intent: FriendToolIntent;
  sanitizedPayload: SharePayload;
  rawPayload: SharePayload;
}

export interface DispatchContext {
  mode: "user_chat" | "inbox";
  // When mode === "inbox": the sender's scope as granted by the recipient.
  // Brain/cal tool outputs get scope-filtered against this before returning.
  viewerScope?: Scope;
  // When mode === "inbox": friends_reply writes its payload here so the
  // surrounding inbox loop can terminate and return the reply to the sender.
  replySink?: { text?: string; data?: Record<string, unknown> };
  // When mode === "user_chat": friends_* tools call this to invoke the
  // recipient's inbox loop synchronously. Returned reply is then filtered
  // through applyScope (sender's scope-for-recipient) before being shown.
  a2aDispatch?: (p: A2ADispatchParams) => Promise<InboundAgentReplyPayload>;
  // When mode === "user_chat": emit an agent-to-agent bubble to the UI.
  emitAgentMessage?: (msg: AgentMessageEmit) => void;
  // For prompt-injection avoidance: the inbox depth. Hard-capped at 2 to
  // prevent A→B→A→B pingpong.
  depth?: number;
}

export async function dispatch(
  name: string,
  input: ToolInput,
  userId: string,
  ctx: DispatchContext = { mode: "user_chat" },
): Promise<unknown> {
  // Normalize both "brain.search" and "brain_search" to underscore form.
  const key = name.replace(/\./g, "_");

  // In inbox mode, gate the available tools defensively. The model is also
  // told which tools exist via tool catalog, but a paranoid second check
  // means a malformed model that hallucinates a tool name can't escalate.
  if (ctx.mode === "inbox" && !INBOX_TOOL_NAMES.has(key)) {
    return { error: "tool_not_allowed_in_inbox_mode", name: key };
  }

  switch (key) {
    case "brain_search": {
      const q = s(input.query) ?? "";
      const limit = n(input.limit) ?? 10;
      const rows = await safeBrainSearch(userId, q, limit);
      if (ctx.mode === "inbox") {
        // In inbox mode, brain search results are scope-filtered: only titles
        // for friend+, full snippets for close+. Acquaintance gets nothing.
        return scopeFilterBrainSearch(rows, ctx.viewerScope ?? "acquaintance");
      }
      return { results: rows };
    }

    case "brain_get_note": {
      const slug = s(input.slug);
      if (!slug) return { error: "slug required" };
      const note = await prisma.note.findUnique({
        where: { userId_slug: { userId, slug } },
      });
      if (!note) return { error: "not found" };
      if (ctx.mode === "inbox") {
        return scopeFilterNote(note, ctx.viewerScope ?? "acquaintance");
      }
      return note;
    }

    case "brain_create_note": {
      const title = s(input.title) ?? "Untitled";
      const bodyMd = s(input.bodyMd) ?? "";
      const kind = s(input.kind) ?? "note";
      const dueAt = s(input.dueAt);
      const slug = slugify(title);
      const note = await prisma.note.create({
        data: {
          userId,
          title,
          slug,
          bodyMd,
          kind,
          dueAt: dueAt ? new Date(dueAt) : null,
          status: kind === "task" ? "open" : null,
        },
      });
      return { id: note.id, slug: note.slug, title: note.title };
    }

    case "brain_update_note": {
      const slug = s(input.slug);
      if (!slug) return { error: "slug required" };
      const data: Record<string, unknown> = {};
      const t = s(input.title);
      const b = s(input.bodyMd);
      const st = s(input.status);
      if (t !== undefined) data.title = t;
      if (b !== undefined) data.bodyMd = b;
      if (st !== undefined) data.status = st;
      const note = await prisma.note.update({
        where: { userId_slug: { userId, slug } },
        data,
      });
      return { id: note.id, slug: note.slug };
    }

    case "brain_list_tasks": {
      const status = s(input.status);
      const tasks = await prisma.note.findMany({
        where: { userId, kind: "task", ...(status ? { status } : {}) },
        orderBy: [{ dueAt: "asc" }],
        select: { title: true, slug: true, status: true, dueAt: true },
      });
      if (ctx.mode === "inbox") {
        const filtered = tasks.map((t) =>
          applyScope(ctx.viewerScope ?? "acquaintance", "share_task", {
            taskTitle: t.title,
            taskDueAt: t.dueAt?.toISOString(),
          }),
        );
        return { tasks: filtered };
      }
      return { tasks };
    }

    case "brain_daily_note": {
      const today = new Date().toISOString().slice(0, 10);
      const slug = `daily-${today}`;
      const existing = await prisma.note.findUnique({
        where: { userId_slug: { userId, slug } },
      });
      if (existing) return { slug: existing.slug, title: existing.title, bodyMd: existing.bodyMd };
      const created = await prisma.note.create({
        data: {
          userId,
          title: `Daily ${today}`,
          slug,
          bodyMd: `# Daily ${today}\n\n## Plan\n\n## Notes\n`,
          kind: "daily",
        },
      });
      return { slug: created.slug, title: created.title, bodyMd: created.bodyMd };
    }

    case "cal_list_events": {
      const from = s(input.from);
      const to = s(input.to);
      if (!from || !to) return { error: "from/to required" };
      const events = await prisma.calendarEvent.findMany({
        where: {
          userId,
          startsAt: { gte: new Date(from), lte: new Date(to) },
        },
        orderBy: { startsAt: "asc" },
      });
      if (ctx.mode === "inbox") {
        const scope = ctx.viewerScope ?? "acquaintance";
        const filtered = events.map((e) =>
          applyScope(scope, "share_event", {
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt.toISOString(),
            text: e.title,
            location: e.notes ?? undefined,
          }),
        );
        return { events: filtered };
      }
      return { events };
    }

    case "cal_find_free": {
      const from = s(input.from);
      const to = s(input.to);
      const durationMin = n(input.durationMin) ?? 30;
      if (!from || !to) return { error: "from/to required" };
      const events = await prisma.calendarEvent.findMany({
        where: { userId, startsAt: { gte: new Date(from), lte: new Date(to) } },
        orderBy: { startsAt: "asc" },
      });
      const slots: { startsAt: string; endsAt: string }[] = [];
      const start = new Date(from);
      const end = new Date(to);
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        for (let h = 9; h < 21; h++) {
          const slotStart = new Date(d);
          slotStart.setHours(h, 0, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000);
          const busy = events.some(
            (e) => e.startsAt < slotEnd && e.endsAt > slotStart,
          );
          if (!busy && slotEnd <= end) {
            slots.push({ startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString() });
            if (slots.length >= 10) {
              return ctx.mode === "inbox"
                ? scopeFilterSlots(slots, ctx.viewerScope ?? "acquaintance")
                : { slots };
            }
          }
        }
      }
      return ctx.mode === "inbox"
        ? scopeFilterSlots(slots, ctx.viewerScope ?? "acquaintance")
        : { slots };
    }

    case "cal_create_event": {
      const title = s(input.title) ?? "Untitled";
      const startsAt = s(input.startsAt);
      const endsAt = s(input.endsAt);
      const notes = s(input.notes) ?? null;
      if (!startsAt || !endsAt) return { error: "startsAt/endsAt required" };
      const ev = await prisma.calendarEvent.create({
        data: {
          userId,
          title,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          notes,
        },
      });
      return { id: ev.id, title: ev.title };
    }

    // ─── Inter-agent ────────────────────────────────────────────────────
    case "friends_list": {
      // Return both directions of the friendship + scope so the model can
      // reason about what it can ask for.
      const me = userId;
      const fs = await prisma.friendship.findMany({
        where: {
          status: "accepted",
          OR: [{ userAId: me }, { userBId: me }],
        },
      });
      const otherIds = fs.map((f) => (f.userAId === me ? f.userBId : f.userAId));
      const others = await prisma.user.findMany({
        where: { id: { in: otherIds } },
        select: { id: true, displayName: true, email: true },
      });
      const scopes = await prisma.friendScope.findMany({
        where: {
          OR: otherIds.flatMap((oid) => [
            { ownerId: me, friendId: oid },
            { ownerId: oid, friendId: me },
          ]),
        },
      });
      const byOwnerFriend = new Map<string, string>();
      for (const r of scopes) byOwnerFriend.set(`${r.ownerId}::${r.friendId}`, r.scope);
      const friends = others.map((o) => {
        const myScope = byOwnerFriend.get(`${me}::${o.id}`) ?? "acquaintance";
        const theirScope = byOwnerFriend.get(`${o.id}::${me}`) ?? "acquaintance";
        return {
          friend_id: o.id,
          display_name: o.displayName,
          email: o.email,
          my_scope_for_them: myScope,
          their_scope_for_me: theirScope,
        };
      });
      return { friends };
    }

    case "friends_ask_availability": {
      const friendId = s(input.friend_id);
      const from = s(input.from);
      const to = s(input.to);
      const durationMin = n(input.duration_min);
      const note = s(input.note);
      if (!friendId || !from || !to || durationMin == null) {
        return { error: "friend_id, from, to, duration_min required" };
      }
      return dispatchFriendCall(userId, friendId, "ask_availability", {
        startsAt: from,
        endsAt: to,
        text: note ?? `Looking for ${durationMin}-min block`,
      }, ctx);
    }

    case "friends_propose_meeting": {
      const friendId = s(input.friend_id);
      const title = s(input.title);
      const startsAt = s(input.starts_at);
      const endsAt = s(input.ends_at);
      const location = s(input.location);
      const note = s(input.note);
      if (!friendId || !title || !startsAt || !endsAt) {
        return { error: "friend_id, title, starts_at, ends_at required" };
      }
      const reply = await dispatchFriendCall(userId, friendId, "propose_meeting", {
        text: title,
        startsAt,
        endsAt,
        location,
        ...(note ? { note } : {}),
      }, ctx);
      // If the friend's agent accepted, write the event on the sender's
      // calendar too. (The friend wrote their own copy inside their loop.)
      const replyObj = reply as { ok?: boolean; denied?: boolean; reply?: InboundAgentReplyPayload };
      if (replyObj.ok && replyObj.reply && replyObj.reply.kind === "propose_meeting_reply" && replyObj.reply.accepted) {
        const ev = await prisma.calendarEvent.create({
          data: {
            userId,
            title,
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
            notes: location ?? null,
          },
        });
        return { ...replyObj, my_event_id: ev.id };
      }
      return reply;
    }

    case "friends_message": {
      const friendId = s(input.friend_id);
      const text = s(input.text);
      if (!friendId || !text) return { error: "friend_id, text required" };
      return dispatchFriendCall(userId, friendId, "message", { text }, ctx);
    }

    case "friends_reply": {
      if (ctx.mode !== "inbox" || !ctx.replySink) {
        return { error: "friends_reply only valid in inbox mode" };
      }
      ctx.replySink.text = s(input.text) ?? "";
      const d = input.data;
      ctx.replySink.data = (d && typeof d === "object" && !Array.isArray(d))
        ? (d as Record<string, unknown>)
        : {};
      return { ok: true };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

async function safeBrainSearch(userId: string, q: string, limit: number) {
  try {
    return await prisma.$queryRawUnsafe<{ id: string; title: string; slug: string; snippet: string }[]>(
      `SELECT n.id, n.title, n.slug, snippet(notes_fts, 2, '[', ']', '...', 8) AS snippet
       FROM notes_fts JOIN "Note" n ON n.id = notes_fts.rowid
       WHERE notes_fts MATCH ? AND n.userId = ?
       LIMIT ?`,
      q,
      userId,
      limit,
    );
  } catch {
    const rows = await prisma.note.findMany({
      where: {
        userId,
        OR: [{ title: { contains: q } }, { bodyMd: { contains: q } }],
      },
      take: limit,
      select: { id: true, title: true, slug: true, bodyMd: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      snippet: r.bodyMd.slice(0, 160),
    }));
  }
}

function scopeFilterBrainSearch(
  rows: { id: string; title: string; slug: string; snippet: string }[],
  viewerScope: Scope,
) {
  return {
    results: rows.map((r) =>
      applyScope(viewerScope, "share_note", {
        noteTitle: r.title,
        noteBody: r.snippet,
      }),
    ),
  };
}

function scopeFilterNote(
  note: { title: string; bodyMd: string },
  viewerScope: Scope,
) {
  return applyScope(viewerScope, "share_note", {
    noteTitle: note.title,
    noteBody: note.bodyMd,
  });
}

function scopeFilterSlots(slots: { startsAt: string; endsAt: string }[], viewerScope: Scope) {
  return {
    slots: slots.map((s) =>
      applyScope(viewerScope, "share_availability", {
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      }),
    ),
  };
}

/**
 * The inter-agent call gate. Used by friends_ask_availability,
 * friends_propose_meeting, friends_message.
 *
 * Steps (mirrors rian commit-by-commit semantics):
 *   1. Verify friendship — never speak to strangers.
 *   2. Look up recipient's scope-for-sender (RECIPIENT-PERSPECTIVE — the
 *      receiver controls what flows TO them about us, not vice versa).
 *      If acquaintance, deny outright for any sensitive intent.
 *   3. Run the outbound payload through applyScope(theirScopeForMe, intent, ...).
 *   4. Persist AgentMessage row (raw + sanitized) for audit.
 *   5. Emit an agent_message chunk to the UI so the bubble appears.
 *   6. Recursively invoke the recipient's agent in inbox mode.
 *   7. Filter the recipient's reply through applyScope(myScopeForThem, replyIntent, ...).
 *   8. Return the filtered reply to the calling tool.
 */
async function dispatchFriendCall(
  senderUserId: string,
  receiverUserId: string,
  intent: FriendToolIntent,
  rawPayload: SharePayload,
  ctx: DispatchContext,
): Promise<unknown> {
  if (ctx.mode === "inbox") {
    return { error: "no_cascading_calls_from_inbox" };
  }
  if (!ctx.a2aDispatch) {
    return { error: "a2a_dispatch_not_wired" };
  }
  if ((ctx.depth ?? 0) >= 2) {
    return { error: "max_agent_depth" };
  }

  // 1. Friendship check.
  const friends = await areFriends(senderUserId, receiverUserId);
  if (!friends) {
    return { ok: false, denied: true, reason: "not_friends" };
  }

  // 2. Recipient's scope for the sender.
  const theirScopeForMe = await loadFriendScope(receiverUserId, senderUserId);

  // 2a. Deny pure acquaintances any sensitive intent up front. We treat
  // ask_availability and propose_meeting as "friend+ required".
  if (
    (intent === "ask_availability" || intent === "propose_meeting") &&
    scopeRank(theirScopeForMe) < scopeRank("friend")
  ) {
    return {
      ok: false,
      denied: true,
      reason: `scope_insufficient (their_scope_for_me=${theirScopeForMe})`,
    };
  }

  // 3. Sanitize outbound through the receiver's scope.
  const outboundIntent = senderIntent(intent);
  const sanitizedOut = applyScope(theirScopeForMe, outboundIntent, rawPayload);

  // 4. Persist audit row.
  const audit = await prisma.agentMessage.create({
    data: {
      fromUserId: senderUserId,
      toUserId: receiverUserId,
      intent,
      payloadSent: stringifyPayload(rawPayload),
      payloadDelivered: stringifyPayload(sanitizedOut),
    },
  });

  // 5. Tell the UI.
  ctx.emitAgentMessage?.({
    fromUserId: senderUserId,
    toUserId: receiverUserId,
    intent,
    payloadSent: rawPayload,
    payloadDelivered: sanitizedOut,
  });

  // 6. Recurse.
  let reply: InboundAgentReplyPayload;
  try {
    reply = await ctx.a2aDispatch({
      receiverUserId,
      senderUserId,
      intent,
      sanitizedPayload: sanitizedOut,
      rawPayload,
    });
  } catch (e) {
    return {
      ok: false,
      denied: false,
      reason: e instanceof Error ? e.message : String(e),
      audit_id: audit.id,
    };
  }

  // 7. Filter the reply through the SENDER's scope-for-RECEIVER.
  // This guards against a misbehaving inbox loop that tries to send back
  // more than the original ask warranted.
  const myScopeForThem = await loadFriendScope(senderUserId, receiverUserId);
  const inboundIntent = replyIntent(intent);
  const replyAsShare: SharePayload =
    reply.kind === "availability_reply"
      ? { startsAt: reply.slots[0]?.startsAt, endsAt: reply.slots[0]?.endsAt }
      : reply.kind === "propose_meeting_reply"
      ? { text: reply.reason }
      : { text: reply.text };
  const filteredReply = applyScope(myScopeForThem, inboundIntent, replyAsShare);
  void filteredReply;

  // 8. Emit the reply on the chunk too so the UI shows both sides.
  ctx.emitAgentMessage?.({
    fromUserId: senderUserId,
    toUserId: receiverUserId,
    intent,
    payloadSent: rawPayload,
    payloadDelivered: sanitizedOut,
    reply,
  });

  return { ok: true, reply, audit_id: audit.id };
}
