"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Friendship, Scope, User } from "@/lib/types";
import { ScopeAccessList, ScopeSlider } from "./ScopeSlider";

const SCOPE_LABEL: Record<Scope, string> = {
  acquaintance: "Acquaintance",
  friend: "Friend",
  close_friend: "Close friend",
  family: "Family",
};

export function ScopePopover({
  meId,
  friendId,
  friendships,
  allFriendships = [],
  allUsers,
  onClose,
  onChange,
}: {
  meId: string;
  friendId: string;
  friendships: Friendship[];
  allFriendships?: Friendship[];
  allUsers: User[];
  onClose: () => void;
  onChange: (next: Friendship) => void;
}) {
  const friendship = friendships.find((f) => f.friend_id === friendId);
  const friend = allUsers.find((u) => u.id === friendId);
  const theirScope = allFriendships.find(
    (af) => af.owner_id === friendId && af.friend_id === meId,
  )?.scope;
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
            <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                How {friend.display_name?.split(" ")[0]} has you
              </div>
              <div className="text-sm flex items-center gap-2">
                <span
                  className={
                    "px-2 py-0.5 rounded text-xs border " +
                    (theirScope
                      ? "border-zinc-700 text-zinc-200 bg-zinc-900"
                      : "border-zinc-800 text-zinc-500")
                  }
                >
                  {theirScope ? SCOPE_LABEL[theirScope] : "Not friends back"}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {theirScope
                    ? `bounds what you can ask of them`
                    : ""}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                With {SCOPE_LABEL[scope]}, your agent shares:
              </div>
              <ScopeAccessList scope={scope} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
