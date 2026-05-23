/**
 * inter-agent.ts
 * --------------
 * Shared types, constants, and small helpers for the agent-to-agent flow.
 *
 * The ported semantics from the Python/Vertex `rian-demo-1` branch are:
 *   1. Sender's loop calls a `friends_*` tool, which routes through this file.
 *   2. The sender side resolves the recipient's scope-for-sender, runs the
 *      outbound payload through `applyScope(scope, intent, payload)`, persists
 *      the AgentMessage (raw `payloadSent`, sanitized `payloadDelivered`), and
 *      then invokes the recipient's agent in INBOX MODE synchronously.
 *   3. Inbox mode is a *constrained* loop: a smaller toolset, a hardened system
 *      prompt that wraps the incoming intent in `<incoming_agent_message>` so
 *      the recipient's model is told to treat the body as DATA, not instructions
 *      (prompt-injection blocking).
 *   4. The recipient's reply is then run through `applyScope` from the SENDER's
 *      perspective (recipient-perspective enforcement for both directions —
 *      each side controls what flows OUT of them) and returned to the sender's
 *      loop as the tool result.
 *
 * Everything in this module is pure / typed / I/O-free except `loadFriendScope`,
 * which only reads from Prisma.
 */
import { prisma } from "../db";
import type { Intent, Scope, SharePayload } from "../scope-policy";

// ---------------------------------------------------------------------------
// Friend intents — kept as a separate union from `Intent` (scope-policy) so we
// can map the tool surface to the smaller scope-policy vocabulary cleanly.
// ---------------------------------------------------------------------------

export type FriendToolIntent =
  | "ask_availability"
  | "propose_meeting"
  | "message"
  | "reply";

/**
 * Map a friend-tool intent → the canonical `applyScope` Intent used to filter
 * the OUTBOUND payload (sender -> recipient).
 *
 * - ask_availability: we're asking the friend to disclose THEIR free time, so
 *   the relevant scope filter on the *reply* side is share_availability. The
 *   outbound payload doesn't carry sensitive data, but we filter it under
 *   share_availability too so a malformed sender can't accidentally leak its
 *   own private fields via the intent body.
 * - propose_meeting: outbound carries title/location/times -> share_event.
 * - message: free-form -> share_event (most permissive of the time-bearing
 *   intents but still filtered).
 * - reply: inbound reply — same mapping per direction, applied by the SENDER's
 *   loop to the RECIPIENT's outbound reply.
 */
export function senderIntent(intent: FriendToolIntent): Intent {
  switch (intent) {
    case "ask_availability":
      return "share_availability";
    case "propose_meeting":
      return "share_event";
    case "message":
      return "share_event";
    case "reply":
      return "share_event";
  }
}

/**
 * The reply intent used when filtering the RECIPIENT's outbound reply payload
 * back to the sender. Same mapping in this hackathon impl, but split so we
 * can tighten one direction later without touching the other.
 */
export function replyIntent(intent: FriendToolIntent): Intent {
  switch (intent) {
    case "ask_availability":
      return "share_availability";
    case "propose_meeting":
      return "share_event";
    case "message":
      return "share_event";
    case "reply":
      return "share_event";
  }
}

// ---------------------------------------------------------------------------
// Scope ladder (mirrors scope-policy.ts) — local so we don't expose the RANK
// internals from scope-policy. Used for rank comparisons here only.
// ---------------------------------------------------------------------------

const SCOPE_RANK: Record<Scope, number> = {
  acquaintance: 0,
  friend: 1,
  family: 2,
  close: 3,
};

export function scopeRank(s: Scope | null | undefined): number {
  if (!s) return -1;
  return SCOPE_RANK[s];
}

export function isValidScope(s: unknown): s is Scope {
  return s === "acquaintance" || s === "friend" || s === "family" || s === "close";
}

// ---------------------------------------------------------------------------
// Friend graph helpers — small Prisma wrappers used by tools + the inter-agent
// dispatcher.
// ---------------------------------------------------------------------------

/**
 * Verify that `me` and `other` are accepted friends (in either direction).
 */
export async function areFriends(meId: string, otherId: string): Promise<boolean> {
  if (meId === otherId) return false;
  const fs = await prisma.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { userAId: meId, userBId: otherId },
        { userAId: otherId, userBId: meId },
      ],
    },
    select: { id: true },
  });
  return fs !== null;
}

/**
 * Look up the scope that `ownerId` has assigned to `friendId`. Returns the
 * default `acquaintance` if no row exists (least-permissive default).
 *
 * WHY recipient-perspective: when Alice's agent asks Bob's agent for data, the
 * gate is "what scope did Bob grant Alice?" — not "what scope did Alice grant
 * Bob?". The sender doesn't get to elevate themselves.
 */
export async function loadFriendScope(
  ownerId: string,
  friendId: string,
): Promise<Scope> {
  const row = await prisma.friendScope.findUnique({
    where: { ownerId_friendId: { ownerId, friendId } },
    select: { scope: true },
  });
  if (!row) return "acquaintance";
  return isValidScope(row.scope) ? row.scope : "acquaintance";
}

// ---------------------------------------------------------------------------
// AgentMessage payload schemas — narrow per-intent shapes that we serialize
// into the `payloadSent` / `payloadDelivered` JSON columns.
// ---------------------------------------------------------------------------

export interface AvailabilityRequestPayload {
  kind: "availability_request";
  from: string; // ISO
  to: string; // ISO
  durationMin: number;
  note?: string;
}

export interface AvailabilityReplyPayload {
  kind: "availability_reply";
  slots: { startsAt: string; endsAt: string }[];
}

export interface ProposeMeetingPayload {
  kind: "propose_meeting";
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  note?: string;
}

export interface ProposeMeetingReplyPayload {
  kind: "propose_meeting_reply";
  accepted: boolean;
  eventId?: string;
  reason?: string;
  approvalId?: string;
}

export interface GenericMessagePayload {
  kind: "message";
  text: string;
  intent: FriendToolIntent;
}

export interface GenericReplyPayload {
  kind: "message_reply";
  text: string;
  data?: Record<string, unknown>;
}

export type OutboundAgentPayload =
  | AvailabilityRequestPayload
  | ProposeMeetingPayload
  | GenericMessagePayload;

export type InboundAgentReplyPayload =
  | AvailabilityReplyPayload
  | ProposeMeetingReplyPayload
  | GenericReplyPayload;

// ---------------------------------------------------------------------------
// Approval policy — for the hackathon, only `propose_meeting` requires
// approval; everything else is auto. The rian branch has no per-pair table for
// this either, so this matches its behavior.
// ---------------------------------------------------------------------------

export type ApprovalMode = "auto" | "approve";

export function approvalModeFor(intent: FriendToolIntent): ApprovalMode {
  return intent === "propose_meeting" ? "approve" : "auto";
}

// ---------------------------------------------------------------------------
// Stringify helpers — keep AgentMessage column writes consistent across the
// two call sites (sender persist, recipient reply update).
// ---------------------------------------------------------------------------

export function stringifyPayload(p: unknown): string {
  return JSON.stringify(p ?? {});
}
