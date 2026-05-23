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
const RANK: Record<Scope, number> = {
  acquaintance: 0,
  friend: 1,
  family: 2,
  close: 3,
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
      // Family/close: real start/end. Friend: day-level. Acquaintance: nothing.
      if (atLeast(scope, "family")) {
        out.startsAt = payload.startsAt;
        out.endsAt = payload.endsAt;
        out.precise = true;
      } else if (atLeast(scope, "friend")) {
        out.startsAt = dayBucket(payload.startsAt);
        out.endsAt = dayBucket(payload.endsAt);
        out.precise = false;
      }
      // WHY: pure acquaintances don't get to ping for your schedule.
      return out;
    }

    case "share_location": {
      if (atLeast(scope, "family")) {
        out.location = payload.location;
        out.precise = true;
      } else if (atLeast(scope, "friend")) {
        out.location = blurLocation(payload.location);
        out.precise = false;
      }
      return out;
    }

    case "share_event": {
      if (atLeast(scope, "family")) {
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
        // Acquaintance: only a generic "busy" pulse.
        out.text = "busy";
      }
      return out;
    }

    case "share_note": {
      // Notes can contain anything — only close friends see full body.
      if (atLeast(scope, "close")) {
        out.noteTitle = payload.noteTitle;
        out.noteBody = payload.noteBody;
      } else if (atLeast(scope, "family")) {
        // Family: title + first paragraph (summary-ish).
        out.noteTitle = payload.noteTitle;
        const body = payload.noteBody ?? "";
        out.noteBody = body.split(/\n\s*\n/)[0]?.slice(0, 500) ?? "";
      } else if (atLeast(scope, "friend")) {
        // Friend: title only.
        out.noteTitle = payload.noteTitle;
      }
      // Acquaintance gets nothing — note bodies are private by default.
      return out;
    }

    case "share_task": {
      // Tasks can be sensitive (medical, financial). Default to title only
      // for friends; full details only for family+.
      if (atLeast(scope, "family")) {
        out.taskTitle = payload.taskTitle;
        out.taskDueAt = payload.taskDueAt;
      } else if (atLeast(scope, "friend")) {
        out.taskTitle = payload.taskTitle;
      }
      return out;
    }

    case "share_contact": {
      // Contact info is escalation-gated. Acquaintances and friends get
      // nothing automatic — they have to ask the human directly.
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
