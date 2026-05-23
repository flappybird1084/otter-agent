"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FriendCard } from "@/components/FriendCard";
import type { Friendship } from "@/lib/types";

export default function FriendsPage({
  params,
}: {
  params: { userId: string };
}) {
  const [friends, setFriends] = useState<Friendship[]>([]);

  useEffect(() => {
    api.getFriends(params.userId).then(setFriends);
  }, [params.userId]);

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Friends</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Trust scope controls what your friend&apos;s agent can see about you.
          Drag the slider to change it — the agent-to-agent permission system
          enforces this server-side.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {friends.map((f) => (
          <FriendCard
            key={f.friend_id}
            ownerId={params.userId}
            friendship={f}
            onChange={(next) =>
              setFriends((prev) =>
                prev.map((p) => (p.friend_id === next.friend_id ? next : p)),
              )
            }
          />
        ))}
        {friends.length === 0 && (
          <div className="text-zinc-500 text-sm">No friends yet.</div>
        )}
      </div>
    </main>
  );
}
