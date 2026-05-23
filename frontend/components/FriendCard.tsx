"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Friendship, Scope } from "@/lib/types";
import { ScopeAccessList, ScopeSlider } from "./ScopeSlider";

export function FriendCard({
  ownerId,
  friendship,
  onChange,
}: {
  ownerId: string;
  friendship: Friendship;
  onChange?: (next: Friendship) => void;
}) {
  const [scope, setScope] = useState<Scope>(friendship.scope);
  const [saving, setSaving] = useState(false);

  async function update(next: Scope) {
    setScope(next);
    setSaving(true);
    try {
      await api.setScope(ownerId, friendship.friend_id, next);
      onChange?.({ ...friendship, scope: next });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex items-start gap-3">
        <div className="text-3xl">{friendship.avatar_emoji}</div>
        <div className="flex-1">
          <div className="text-sm font-medium text-zinc-100">
            {friendship.display_name}
          </div>
          <div className="text-xs text-zinc-500">{friendship.handle}</div>
          <div className="text-xs text-zinc-400 mt-1.5 line-clamp-2">
            {friendship.bio}
          </div>
        </div>
        {saving && (
          <span className="text-[10px] text-zinc-500 animate-pulse">saving</span>
        )}
      </div>
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Trust scope
        </div>
        <ScopeSlider value={scope} onChange={update} />
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {friendship.display_name?.split(" ")[0]}&apos;s agent can see
        </div>
        <ScopeAccessList scope={scope} />
      </div>
    </div>
  );
}
