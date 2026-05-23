"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Friendship, Scope, User } from "@/lib/types";
import { ScopeAccessList, ScopeSlider } from "./ScopeSlider";

export function ScopePopover({
  meId,
  friendId,
  friendships,
  allUsers,
  onClose,
  onChange,
}: {
  meId: string;
  friendId: string;
  friendships: Friendship[];
  allUsers: User[];
  onClose: () => void;
  onChange: (next: Friendship) => void;
}) {
  const friendship = friendships.find((f) => f.friend_id === friendId);
  const friend = allUsers.find((u) => u.id === friendId);
  const initial = friendship?.scope ?? "acquaintance";
  const [scope, setScope] = useState<Scope>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScope(initial);
  }, [initial]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!friend) {
    return null;
  }

  async function update(next: Scope) {
    setScope(next);
    setSaving(true);
    try {
      await api.setScope(meId, friendId, next);
      if (friendship) onChange({ ...friendship, scope: next });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-700 rounded-xl p-5 w-[320px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">{friend.avatar_emoji}</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-zinc-100">
              {friend.display_name}
            </div>
            <div className="text-xs text-zinc-500">{friend.handle}</div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!friendship ? (
          <div className="mt-4 text-xs text-zinc-400">
            You&apos;re not friends with {friend.display_name?.split(" ")[0]}.
          </div>
        ) : (
          <>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center justify-between">
                <span>Trust scope</span>
                {saving && (
                  <span className="text-[10px] text-zinc-500 animate-pulse">
                    saving
                  </span>
                )}
              </div>
              <ScopeSlider value={scope} onChange={update} />
            </div>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                {friend.display_name?.split(" ")[0]}&apos;s agent can see
              </div>
              <ScopeAccessList scope={scope} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
