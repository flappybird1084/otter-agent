"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import type { NoteMeta } from "@/lib/types";

export function NotesPanel({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");

  useEffect(() => {
    api.getNotes(userId).then((ns) => {
      setNotes(ns);
      if (ns[0]) setSelected(ns[0].id);
    });
  }, [userId]);

  useEffect(() => {
    if (!selected) return;
    api.getNote(userId, selected).then((n) => setBody(n.body || ""));
  }, [userId, selected]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-900">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          Notes
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-rows-[40%_60%] divide-y divide-zinc-900">
        <ul className="overflow-y-auto">
          {notes.map((n) => (
            <li
              key={n.id}
              onClick={() => setSelected(n.id)}
              className={
                "px-4 py-2 cursor-pointer border-l-2 " +
                (selected === n.id
                  ? "border-emerald-500 bg-zinc-900/50"
                  : "border-transparent hover:bg-zinc-900/40")
              }
            >
              <div className="text-sm text-zinc-200 truncate">{n.title}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex gap-2 items-center mt-0.5">
                <span>{n.share_tier.replace("_", " ")}</span>
                {n.tags.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 normal-case tracking-normal"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="overflow-y-auto p-4 prose-confluent">
          {body ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          ) : (
            <div className="text-zinc-600 text-sm">Select a note.</div>
          )}
        </div>
      </div>
    </div>
  );
}
