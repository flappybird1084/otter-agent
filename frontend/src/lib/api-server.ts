/**
 * Server-side client for the FastAPI backend. Used by the Next.js route
 * handlers that proxy /api/* to the Python service, with shape adapters
 * (snake_case → camelCase, scope rename, etc).
 */

const BASE = process.env.BACKEND_URL || "http://localhost:8080";

async function backend<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`backend ${res.status} on ${path}: ${txt}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ──────────────────────────────────────────────────────────────────────
// Scope name mapping. avitest1 UI uses "close"; our backend uses
// "close_friend". Translate at the API boundary so both stay clean.

export type UiScope = "acquaintance" | "friend" | "family" | "close";
export type BackendScope = "acquaintance" | "friend" | "family" | "close_friend";

export function uiToBackendScope(s: UiScope): BackendScope {
  return s === "close" ? "close_friend" : (s as BackendScope);
}
export function backendToUiScope(s: BackendScope | string): UiScope {
  return (s === "close_friend" ? "close" : (s as UiScope));
}

// ──────────────────────────────────────────────────────────────────────
// Users / friends

export interface BackendUser {
  id: string;
  display_name: string;
  handle: string;
  avatar_emoji?: string;
  bio?: string;
}

export interface BackendFriendship {
  id: string;
  owner_id: string;
  friend_id: string;
  scope: BackendScope;
  display_name?: string;
  handle?: string;
  avatar_emoji?: string;
  bio?: string;
}

export const api = {
  listUsers: () => backend<BackendUser[]>(`/users`),
  getUser: (id: string) => backend<BackendUser>(`/users/${id}`),
  getFriends: (id: string) => backend<BackendFriendship[]>(`/friends/${id}`),
  getAllFriendships: () => backend<BackendFriendship[]>(`/friendships`),
  getSocial: (id: string) =>
    backend<{
      me: { id: string; display_name: string };
      friends: Array<{
        id: string;
        display_name: string;
        handle: string;
        avatar_emoji?: string;
        my_scope_of_them: BackendScope;
        their_scope_of_me: BackendScope | null;
        visible_notes: Array<{
          id: string;
          title: string;
          slug?: string;
          kind?: string;
          share_tier?: string;
        }>;
      }>;
    }>(`/social/${id}`),
  setScope: (ownerId: string, friendId: string, scope: BackendScope) =>
    backend<{ ok: true }>(`/friends/${ownerId}/scope`, {
      method: "POST",
      body: JSON.stringify({ friend_id: friendId, scope }),
    }),

  getNotes: (userId: string) => backend<BackendNote[]>(`/notes/${userId}`),
  getNote: (userId: string, noteId: string) =>
    backend<BackendNote & { body: string }>(`/notes/${userId}/${noteId}`),
  getNoteBySlug: (userId: string, slug: string) =>
    backend<BackendNote & { body: string }>(
      `/notes/${userId}/by-slug/${encodeURIComponent(slug)}`,
    ),
  searchNotes: (userId: string, q: string) =>
    backend<{ results: BackendSearchHit[] }>(
      `/notes/${userId}/search?q=${encodeURIComponent(q)}`,
    ),
  notesGraph: (userId: string) =>
    backend<{ nodes: BackendGraphNode[]; edges: { a: string; b: string }[] }>(
      `/notes/${userId}/graph`,
    ),
  createNote: (
    userId: string,
    body: Partial<BackendNote> & { body?: string },
  ) =>
    backend<BackendNote & { body: string }>(`/notes/${userId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateNote: (
    userId: string,
    noteId: string,
    body: Partial<BackendNote> & { body?: string },
  ) =>
    backend<BackendNote & { body: string }>(`/notes/${userId}/${noteId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteNote: (userId: string, noteId: string) =>
    backend<{ ok: true }>(`/notes/${userId}/${noteId}`, { method: "DELETE" }),

  getCalendar: (userId: string) =>
    backend<BackendCalendarEvent[]>(`/calendar/${userId}`),

  postChat: (userId: string, content: string, conversationId?: string | null) =>
    backend<{ reply: string; conversation_id: string }>(`/chat`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        content,
        conversation_id: conversationId || null,
      }),
    }),
  getChat: (userId: string, conversationId?: string | null) =>
    backend<BackendChatMessage[]>(
      conversationId
        ? `/chat/${userId}?conversation_id=${encodeURIComponent(conversationId)}`
        : `/chat/${userId}`,
    ),
  deleteChat: (userId: string, conversationId?: string | null) =>
    backend<{ ok: true; deleted: number }>(
      conversationId
        ? `/chat/${userId}?conversation_id=${encodeURIComponent(conversationId)}`
        : `/chat/${userId}`,
      { method: "DELETE" },
    ),
  getEvents: (limit = 60) =>
    backend<BackendAgentEvent[]>(`/events?limit=${limit}`),

  // Direct chat (user → another user's agent, bypasses your own agent)
  postDirectChat: (
    senderUserId: string,
    recipientUserId: string,
    content: string,
    conversationId?: string | null,
  ) =>
    backend<{ reply: string; conversation_id: string; scope: string }>(
      `/direct-chat`,
      {
        method: "POST",
        body: JSON.stringify({
          sender_user_id: senderUserId,
          recipient_user_id: recipientUserId,
          content,
          conversation_id: conversationId || null,
        }),
      },
    ),
  getDirectChat: (
    senderUserId: string,
    recipientUserId: string,
    conversationId?: string | null,
  ) =>
    backend<BackendChatMessage[]>(
      conversationId
        ? `/direct-chat/${senderUserId}/${recipientUserId}?conversation_id=${encodeURIComponent(conversationId)}`
        : `/direct-chat/${senderUserId}/${recipientUserId}`,
    ),
  deleteDirectChat: (
    senderUserId: string,
    recipientUserId: string,
    conversationId?: string | null,
  ) =>
    backend<{ ok: true; deleted: number }>(
      conversationId
        ? `/direct-chat/${senderUserId}/${recipientUserId}?conversation_id=${encodeURIComponent(conversationId)}`
        : `/direct-chat/${senderUserId}/${recipientUserId}`,
      { method: "DELETE" },
    ),

  telegramLinkCode: (userId: string) =>
    backend<{ code: string; expires_in_seconds: number }>(`/telegram/link-code`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  telegramStatus: (userId: string) =>
    backend<{ bridge_enabled: boolean; linked: boolean; chat_id: string | null }>(
      `/telegram/status/${userId}`,
    ),
};

export interface BackendNote {
  id: string;
  user_id: string;
  title: string;
  slug?: string;
  kind?: string;
  status?: string | null;
  due_at?: string | null;
  tags?: string[];
  share_tier?: string;
  sort_index?: number;
  updated_at?: string;
}

export interface BackendSearchHit {
  id: string;
  title: string;
  slug?: string;
  kind?: string;
  snippet: string;
}

export interface BackendGraphNode {
  id: string;
  title: string;
  kind: string;
}

export interface BackendCalendarEvent {
  id: string;
  user_id: string;
  title?: string;
  start: string;
  end: string;
  location?: string;
  notes?: string | null;
  visibility?: string;
  status?: string;
  attendees?: string[];
}

export interface BackendChatMessage {
  id: string;
  user_id: string;
  role: "user" | "agent";
  content: string;
  conversation_id: string;
  created_at: string;
}

export interface BackendAgentEvent {
  id: string;
  type: string;
  actor_user_id: string;
  target_user_id?: string | null;
  payload: Record<string, unknown>;
  conversation_id: string;
  created_at: string;
}

// ──────────────────────────────────────────────────────────────────────
// UI shape adapters

export function toUiUser(u: BackendUser) {
  return {
    id: u.id,
    email: u.handle ?? u.id,
    displayName: u.display_name,
  };
}

export function toUiFriend(
  f: BackendFriendship,
  reciprocal?: BackendFriendship | undefined,
) {
  return {
    id: f.friend_id,
    email: f.handle ?? f.friend_id,
    displayName: f.display_name ?? f.friend_id,
    myScope: backendToUiScope(f.scope),
    theirScope: backendToUiScope((reciprocal?.scope ?? "acquaintance") as BackendScope),
  };
}

type UiShareTier = "private" | "public" | "friends" | "close_friends" | "family";
const VALID_TIERS: ReadonlyArray<UiShareTier> = [
  "private", "public", "friends", "close_friends", "family",
];
function toUiShareTier(s: string | undefined): UiShareTier {
  return VALID_TIERS.includes(s as UiShareTier) ? (s as UiShareTier) : "private";
}

export function toUiNoteSummary(n: BackendNote) {
  return {
    id: n.id,
    title: n.title,
    slug: n.slug ?? n.id,
    kind: n.kind ?? "note",
    status: n.status ?? null,
    dueAt: n.due_at ?? null,
    updatedAt: n.updated_at ?? new Date().toISOString(),
    sortIndex: n.sort_index,
    shareTier: toUiShareTier(n.share_tier),
  };
}

export function toUiActiveNote(n: BackendNote & { body: string }) {
  return {
    id: n.id,
    title: n.title,
    slug: n.slug ?? n.id,
    bodyMd: n.body,
    kind: n.kind ?? "note",
    status: n.status ?? null,
    dueAt: n.due_at ?? null,
    shareTier: toUiShareTier(n.share_tier),
  };
}

export function toUiCalendarEvent(e: BackendCalendarEvent) {
  return {
    id: e.id,
    title: e.title ?? "",
    startsAt: e.start,
    endsAt: e.end,
    notes: e.notes ?? e.location ?? null,
  };
}
