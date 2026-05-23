"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent, Friendship, User } from "@/lib/types";
import { NotesPanel } from "@/components/NotesPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { SocialGraph } from "@/components/SocialGraph";
import { ActivityFeed } from "@/components/ActivityFeed";

const POLL_MS = 800;

export default function UserHome({ params }: { params: { userId: string } }) {
  const userId = params.userId;
  const [user, setUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [demoMode, setDemoMode] = useState(true);

  useEffect(() => {
    api.getUser(userId).then(setUser).catch(() => setUser(null));
    api.listUsers().then(setAllUsers);
    api.getFriends(userId).then(setFriendships);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const e = await api.getEvents(60);
        if (!cancelled) setEvents(e);
      } catch {}
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <main className="h-[calc(100vh-3rem)] grid grid-cols-[26%_36%_38%] divide-x divide-zinc-900">
      <section className="overflow-hidden">
        <NotesPanel userId={userId} />
      </section>
      <section className="overflow-hidden flex flex-col">
        <ChatPanel
          userId={userId}
          user={user}
          demoMode={demoMode}
          onToggleDemoMode={() => setDemoMode((v) => !v)}
        />
      </section>
      <section className="overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 border-b border-zinc-900">
          <SocialGraph
            users={allUsers}
            friendships={friendships}
            events={events}
            meId={userId}
          />
        </div>
        <div className="h-72 min-h-72 overflow-hidden">
          <ActivityFeed events={events} users={allUsers} />
        </div>
      </section>
    </main>
  );
}
