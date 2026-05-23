"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteSummary } from "./AppShell";

interface SearchHit {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

const FILTERS = [
  { id: "all",     label: "All" },
  { id: "daily",   label: "Daily" },
  { id: "project", label: "Projects" },
  { id: "task",    label: "Tasks" },
  { id: "note",    label: "Notes" },
];

export default function SearchModal({
  notes,
  onPick,
  onClose,
}: {
  notes: NoteSummary[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIdx(0);
    if (!q.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/notes/search?q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const j = (await r.json()) as { results: SearchHit[] };
        setHits(j.results ?? []);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: notes.length };
    for (const n of notes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (kind === "all") return notes;
    return notes.filter((n) => n.kind === kind);
  }, [notes, kind]);

  const results = useMemo(() => {
    if (!q.trim()) {
      return filteredNotes.slice(0, 30).map((n) => ({
        id: n.id, title: n.title, slug: n.slug, snippet: n.kind + " · " + new Date(n.updatedAt).toLocaleDateString(),
      }));
    }
    if (!hits) return [];
    const allowed = new Set(filteredNotes.map((n) => n.id));
    return hits.filter((h) => allowed.has(h.id));
  }, [q, hits, filteredNotes]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) onPick(hit.id);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "var(--fg-dim)" }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search notes, tasks…"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="search-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-chip ${kind === f.id ? "active" : ""}`}
              onClick={() => setKind(f.id)}
            >
              {f.label}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: .65 }}>
                {counts[f.id] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="search-results">
          {results.length === 0 ? (
            <div className="empty">No matches.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={`search-result ${i === activeIdx ? "active" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => onPick(r.id)}
              >
                <div className="search-result-title">{r.title}</div>
                {r.snippet && <div className="search-result-snippet">{r.snippet}</div>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
