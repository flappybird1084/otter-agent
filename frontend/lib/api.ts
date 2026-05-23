import type {
  AgentEvent,
  CalendarEvent,
  ChatMessage,
  Friendship,
  NoteMeta,
  Scope,
  User,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} on ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listUsers: () => request<User[]>("/users"),
  getUser: (id: string) => request<User>(`/users/${id}`),
  getFriends: (id: string) => request<Friendship[]>(`/friends/${id}`),
  setScope: (ownerId: string, friendId: string, scope: Scope) =>
    request<{ ok: true }>(`/friends/${ownerId}/scope`, {
      method: "POST",
      body: JSON.stringify({ friend_id: friendId, scope }),
    }),
  getNotes: (userId: string) => request<NoteMeta[]>(`/notes/${userId}`),
  getNote: (userId: string, noteId: string) =>
    request<NoteMeta & { body: string }>(`/notes/${userId}/${noteId}`),
  getCalendar: (userId: string) =>
    request<CalendarEvent[]>(`/calendar/${userId}`),
  getEvents: (limit = 60) => request<AgentEvent[]>(`/events?limit=${limit}`),
  getChat: (userId: string, conversationId?: string | null) => {
    const qs = conversationId
      ? `?conversation_id=${encodeURIComponent(conversationId)}`
      : "";
    return request<ChatMessage[]>(`/chat/${userId}${qs}`);
  },
  postChat: (userId: string, content: string, conversation_id?: string | null) =>
    request<{ reply: unknown; conversation_id: string }>(`/chat`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        content,
        conversation_id: conversation_id || null,
      }),
    }),
  reseed: () => request<{ ok: true }>(`/seed`, { method: "POST" }),
};
