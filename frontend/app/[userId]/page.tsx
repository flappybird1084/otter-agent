"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent, Friendship, User } from "@/lib/types";
import { NotesPanel } from "@/components/NotesPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { SocialGraph } from "@/components/SocialGraph";
import { ActivityFeed } from "@/components/ActivityFeed";
import { CalendarView } from "@/components/CalendarView";
import { FriendScopeControls } from "@/components/FriendScopeControls";
import { ScopePopover } from "@/components/ScopePopover";

type RightTab = "calendar" | "friends";

const POLL_MS = 800;

export default function UserHome({ params }: { params: { userId: string } }) {
  const userId = params.userId;
  const [user, setUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [allFriendships, setAllFriendships] = useState<Friendship[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [demoMode, setDemoMode] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>("calendar");
  const [popoverFriendId, setPopoverFriendId] = useState<string | null>(null);

  useEffect(() => {
    api.getUser(userId).then(setUser).catch(() => setUser(null));
    api.listUsers().then(setAllUsers);
    api.getFriends(userId).then(setFriendships);
    api.getAllFriendships().then(setAllFriendships);
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
        <div className="flex border-b border-zinc-900 text-xs">
          <TabButton
            active={rightTab === "calendar"}
            onClick={() => setRightTab("calendar")}
          >
            Calendar
          </TabButton>
          <TabButton
            active={rightTab === "friends"}
            onClick={() => setRightTab("friends")}
          >
            Friends
          </TabButton>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {rightTab === "calendar" ? (
            <CalendarView userId={userId} />
          ) : (
            <>
              <FriendScopeControls
                ownerId={userId}
                friendships={friendships}
                onChange={(next) => {
                  setFriendships((prev) =>
                    prev.map((p) =>
                      p.friend_id === next.friend_id ? next : p,
                    ),
                  );
                  setAllFriendships((prev) =>
                    prev.map((p) =>
                      p.owner_id === userId && p.friend_id === next.friend_id
                        ? { ...p, scope: next.scope }
                        : p,
                    ),
                  );
                }}
              />
              <div className="flex-1 min-h-0 border-b border-zinc-900 relative">
                <SocialGraph
                  users={allUsers}
                  friendships={allFriendships}
                  events={events}
                  meId={userId}
                  onNodeClick={(uid) => setPopoverFriendId(uid)}
                />
                {popoverFriendId && (
                  <ScopePopover
                    meId={userId}
                    friendId={popoverFriendId}
                    friendships={friendships}
                    allUsers={allUsers}
                    onClose={() => setPopoverFriendId(null)}
                    onChange={(next) => {
                      setFriendships((prev) =>
                        prev.map((p) =>
                          p.friend_id === next.friend_id ? next : p,
                        ),
                      );
                      setAllFriendships((prev) =>
                        prev.map((p) =>
                          p.owner_id === userId &&
                          p.friend_id === next.friend_id
                            ? { ...p, scope: next.scope }
                            : p,
                        ),
                      );
                    }}
                  />
                )}
              </div>
              <div className="h-60 min-h-60 overflow-hidden">
                <ActivityFeed events={events} users={allUsers} />
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 border-b-2 transition " +
        (active
          ? "border-emerald-500 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300")
      }
    >
      {children}
    </button>
  );
}
