export type User = {
  id: string;
  display_name: string;
  handle: string;
  avatar_emoji: string;
  bio: string;
};

export type Scope = "acquaintance" | "friend" | "close_friend" | "family";

export type Friendship = {
  id: string;
  owner_id: string;
  friend_id: string;
  scope: Scope;
  display_name?: string;
  handle?: string;
  avatar_emoji?: string;
  bio?: string;
};

export type NoteMeta = {
  id: string;
  user_id: string;
  title: string;
  tags: string[];
  share_tier: "private" | "friends" | "close_friends" | "family";
  storage_path: string;
  updated_at?: string;
};

export type CalendarEvent = {
  id: string;
  user_id: string;
  title?: string;
  start: string;
  end: string;
  location?: string;
  visibility?: string;
  status?: string;
  attendees?: string[];
};

export type ChatMessage = {
  id: string;
  user_id: string;
  role: "user" | "agent";
  content: string;
  conversation_id: string;
  created_at: string;
};

export type AgentEvent = {
  id: string;
  type:
    | "agent_thinking"
    | "tool_call"
    | "agent_message_sent"
    | "agent_message_received"
    | "agent_replied"
    | "event_proposed";
  actor_user_id: string;
  target_user_id?: string | null;
  payload: Record<string, unknown> & { summary?: string; rejected?: boolean };
  conversation_id: string;
  created_at: string;
};
