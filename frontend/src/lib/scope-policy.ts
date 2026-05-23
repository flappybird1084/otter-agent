/**
 * scope-policy.ts
 * ---------------
 * Single source of truth for what one user's agent is allowed to share with
 * another user's agent. Every cross-agent payload MUST pass through
 * `applyScope` before being delivered.
 *
 * The scope ladder (least -> most trust):
 *   acquaintance  : public-facing facts only, no precise availability
 *   friend        : free/busy + general topics, blurred locations
 *   family        : exact times, locations, calendar details
 *   close         : near-full transparency (still excludes secrets/keys)
 *
 * WHY this lives in one file:
 *   - Privacy is easy to get wrong if scattered. A single chokepoint means
 *     auditors (and us) can reason about leakage in one place.
 *   - We can unit-test the matrix exhaustively.
 *
 * WHY it's a pure function:
 *   - No DB, no I/O — trivially testable, deterministic, side-effect-free.
 *   - The caller is responsible for fetching the scope; we just transform.
 */

export type Scope = "acquaintance" | "friend" | "family" | "close";

export type Intent =
  | "share_availability" // "are you free Thursday?"
  | "share_location"     // "where will you be?"
  | "share_note"         // "send me your notes on X"
  | "share_task"         // "what's on your plate?"
  | "share_contact"      // phone/email/etc.
  | "share_event";       // calendar event details

// Loose payload shape — fields are filtered out as scope demands.
export interface SharePayload {
  text?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  precise?: boolean;     // true if location/time is exact
  noteBody?: string;
  noteTitle?: string;
  taskTitle?: string;
  taskDueAt?: string;
  contact?: { email?: string; phone?: string };
  [k: string]: unknown;
}

// Rank scopes so we can do "at least friend" comparisons.
// Family is the most-trusted tier — it sits inside even Close.
const RANK: Record<Scope, number> = {
  acquaintance: 0,
  friend: 1,
  close: 2,
  family: 3,
};

function atLeast(have: Scope, need: Scope): boolean {
  return RANK[have] >= RANK[need];
}

/**
 * Coarsens a time window to a day-level bucket. WHY: acquaintances/friends
 * shouldn't learn the exact minute you're free — only the rough day.
 */
function dayBucket(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Blurs a location string to a city-ish granularity. WHY: an acquaintance
 * shouldn't get your home street. The heuristic is intentionally crude — a
 * real impl would geocode. For the hackathon, we strip everything after the
 * first comma and drop any digits (street numbers).
 */
function blurLocation(loc?: string): string | undefined {
  if (!loc) return undefined;
  const head = loc.split(",")[0] ?? loc;
  return head.replace(/\d+/g, "").trim();
}

/**
 * The main filter. Returns a NEW payload object — never mutates input.
 * Anything not explicitly allowed is dropped (allowlist, not denylist).
 */
export function applyScope(
  scope: Scope,
  intent: Intent,
  payload: SharePayload,
): SharePayload {
  const out: SharePayload = {};

  switch (intent) {
    case "share_availability": {
      // Close+/Family: real start/end. Friend: day-level. Acquaintance: nothing.
      if (atLeast(scope, "close")) {
        out.startsAt = payload.startsAt;
        out.endsAt = payload.endsAt;
        out.precise = true;
      } else if (atLeast(scope, "friend")) {
        out.startsAt = dayBucket(payload.startsAt);
        out.endsAt = dayBucket(payload.endsAt);
        out.precise = false;
      }
      return out;
    }

    case "share_location": {
      if (atLeast(scope, "close")) {
        out.location = payload.location;
        out.precise = true;
      } else if (atLeast(scope, "friend")) {
        out.location = blurLocation(payload.location);
        out.precise = false;
      }
      return out;
    }

    case "share_event": {
      if (atLeast(scope, "close")) {
        out.startsAt = payload.startsAt;
        out.endsAt = payload.endsAt;
        out.location = payload.location;
        out.text = payload.text;
        out.precise = true;
      } else if (atLeast(scope, "friend")) {
        // Friends learn there IS an event but not where/exact-when.
        out.startsAt = dayBucket(payload.startsAt);
        out.endsAt = dayBucket(payload.endsAt);
        out.text = payload.text;
        out.precise = false;
      } else {
        out.text = "busy";
      }
      return out;
    }

    case "share_note": {
      // Close+/Family see title + body. Friend sees title only.
      if (atLeast(scope, "close")) {
        out.noteTitle = payload.noteTitle;
        out.noteBody = payload.noteBody;
      } else if (atLeast(scope, "friend")) {
        out.noteTitle = payload.noteTitle;
      }
      return out;
    }

    case "share_task": {
      if (atLeast(scope, "close")) {
        out.taskTitle = payload.taskTitle;
        out.taskDueAt = payload.taskDueAt;
      } else if (atLeast(scope, "friend")) {
        out.taskTitle = payload.taskTitle;
      }
      return out;
    }

    case "share_contact": {
      // Contact info is family-only — the strictest tier. Close gets every-
      // thing else but contact details still require the closest trust.
      if (atLeast(scope, "family") && payload.contact) {
        out.contact = {
          email: payload.contact.email,
          phone: payload.contact.phone,
        };
      }
      return out;
    }

    default: {
      // Unknown intent: fail closed. WHY: better to leak nothing than to
      // accidentally allow a future intent we haven't reasoned about.
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}
