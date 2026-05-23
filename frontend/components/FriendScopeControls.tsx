"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Friendship, Scope } from "@/lib/types";

const SCOPES: Scope[] = ["acquaintance", "friend", "close_friend", "family"];
const SHORT: Record<Scope, string> = {
  acquaintance: "Acq",
  friend: "Friend",
  close_friend: "Close",
  family: "Family",
};

export function FriendScopeControls({
  ownerId,
  friendships,
  onChange,
}: {
  ownerId: string;
  friendships: Friendship[];
  onChange?: (next: Friendship) => void;
}) {
  return (
    <div className="border-b border-zinc-900 bg-zinc-950/40">
      <div className="px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-zinc-500 flex items-center justify-between">
        <span>Trust scopes</span>
        <span className="text-[10px] normal-case tracking-normal text-zinc-600">
          how their agent sees you
        </span>
      </div>
      <ul>
        {friendships.length === 0 && (
          <li className="px-4 py-2 text-xs text-zinc-600">No friends yet.</li>
        )}
        {friendships.map((f) => (
          <FriendRow
            key={f.friend_id}
            ownerId={ownerId}
            friendship={f}
            onChange={onChange}
          />
        ))}
      </ul>
    </div>
  );
}

function FriendRow({
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

  // Keep in sync if the friendships prop changes externally.
  useEffect(() => {
    setScope(friendship.scope);
  }, [friendship.scope]);

  async function update(next: Scope) {
    if (next === scope || saving) return;
    const prev = scope;
    setScope(next);
    setSaving(true);
    try {
      await api.setScope(ownerId, friendship.friend_id, next);
      onChange?.({ ...friendship, scope: next });
    } catch {
      setScope(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="px-4 py-1.5 flex items-center gap-3 border-t border-zinc-900/60">
      <span className="text-lg leading-none">{friendship.avatar_emoji}</span>
      <span className="text-xs text-zinc-300 w-20 truncate">
        {friendship.display_name?.split(" ")[0]}
      </span>
      <div className="flex gap-1 flex-1">
        {SCOPES.map((s) => (
          <button
            key={s}
            onClick={() => update(s)}
            disabled={saving}
            title={s.replace("_", " ")}
            className={
              "px-2 py-0.5 text-[10px] rounded border transition " +
              (s === scope
                ? "bg-emerald-600/30 border-emerald-500 text-emerald-100"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600")
            }
          >
            {SHORT[s]}
          </button>
        ))}
      </div>
      {saving && (
        <span className="text-[10px] text-zinc-600 animate-pulse">saving</span>
      )}
    </li>
  );
}
