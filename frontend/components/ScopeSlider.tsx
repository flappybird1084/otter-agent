"use client";

import type { Scope } from "@/lib/types";

const SCOPES: Scope[] = ["acquaintance", "friend", "close_friend", "family"];
const LABELS: Record<Scope, string> = {
  acquaintance: "Acquaintance",
  friend: "Friend",
  close_friend: "Close friend",
  family: "Family",
};

export function ScopeSlider({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (v: Scope) => void;
}) {
  const idx = SCOPES.indexOf(value);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {SCOPES.map((s, i) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={
              "px-2.5 py-1 rounded-md text-xs border transition " +
              (i === idx
                ? "bg-emerald-600/30 border-emerald-500 text-emerald-100"
                : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-600")
            }
          >
            {LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScopeAccessList({ scope }: { scope: Scope }) {
  const rows: { label: string; ok: boolean }[] = [
    {
      label: "Your busy/free calendar",
      ok: true,
    },
    {
      label: "Your calendar event titles",
      ok: scope === "friend" || scope === "close_friend" || scope === "family",
    },
    {
      label: "Notes shared with friends",
      ok: scope === "friend" || scope === "close_friend" || scope === "family",
    },
    {
      label: "Notes shared with close friends",
      ok: scope === "close_friend" || scope === "family",
    },
    { label: "Notes shared with family", ok: scope === "family" },
    { label: "Private notes", ok: false },
  ];
  return (
    <ul className="text-xs space-y-0.5 mt-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className={r.ok ? "text-emerald-400" : "text-red-400"}>
            {r.ok ? "✓" : "✗"}
          </span>
          <span className="text-zinc-300">{r.label}</span>
        </li>
      ))}
    </ul>
  );
}
