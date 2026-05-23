"use client";
import { useEffect, useMemo, useState } from "react";
import type { NoteSummary, AppUser, View } from "./AppShell";

interface FriendRow {
  id: string;
  displayName: string;
  email: string;
  myScope: string;
}

const GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: "daily", label: "Daily", kinds: ["daily"] },
  { id: "projects", label: "Projects", kinds: ["project"] },
  { id: "tasks", label: "Tasks", kinds: ["task"] },
  { id: "notes", label: "Notes", kinds: ["note"] },
  { id: "people", label: "People", kinds: ["person"] },
];

function NoteIcon({ kind }: { kind: string }) {
  if (kind === "task") return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (kind === "person") return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 14c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
  if (kind === "daily") return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
  if (kind === "project") return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2 6h12" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

function TreeGroup({
  label,
  notes,
  activeId,
  onOpen,
}: {
  label: string;
  notes: NoteSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!notes.length) return null;
  return (
    <div className="sb-tree-group">
      <button
        type="button"
        className={`sb-tree-label${open ? "" : " collapsed"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chev">▾</span>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", color: "var(--fg-faint)", fontSize: 10 }}>{notes.length}</span>
      </button>
      {open && (
        <div className="sb-tree-children">
          {notes.map((n) => (
            <button
              type="button"
              key={n.id}
              className={`sb-item ${activeId === n.id ? "active" : ""}`}
              onClick={() => onOpen(n.id)}
            >
              <span className="icon"><NoteIcon kind={n.kind} /></span>
              <span className="title-text">{n.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  view,
  setView,
  notes,
  activeId,
  onOpen,
  onCreate,
  user,
  onLogout,
  onOpenSearch,
  chatTarget,
  onChatWith,
}: {
  view: View;
  setView: (v: View) => void;
  notes: NoteSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  user: AppUser;
  onLogout: () => void;
  onOpenSearch: () => void;
  chatTarget: string;
  onChatWith: (id: string) => void;
}) {
  const [friends, setFriends] = useState<FriendRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/friends")
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((j: { friends?: FriendRow[] }) => {
        if (!cancelled) setFriends(j.friends ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, NoteSummary[]> = {};
    for (const g of GROUPS) map[g.id] = [];
    const other: NoteSummary[] = [];
    for (const n of notes) {
      const g = GROUPS.find((g) => g.kinds.includes(n.kind));
      if (g) map[g.id].push(n);
      else other.push(n);
    }
    return { map, other };
  }, [notes]);

  return (
    <aside className="sidebar">
      <div className="sb-section">
        <span>Workspace</span>
      </div>
      <div className="sb-nav">
        <button type="button" className="sb-item" onClick={onOpenSearch}>
          <span className="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </span>
          <span>Search</span>
          <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
        </button>
        <button
          type="button"
          className={`sb-item ${view === "brain" ? "active" : ""}`}
          onClick={() => setView("brain")}
        >
          <span className="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3h7l3 3v7H3V3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M10 3v3h3" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </span>
          <span>Brain</span>
          <span className="count">{notes.length}</span>
        </button>
        <button
          type="button"
          className={`sb-item ${view === "calendar" ? "active" : ""}`}
          onClick={() => setView("calendar")}
        >
          <span className="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2 6h12" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 1.5v3M10 1.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </span>
          <span>Calendar</span>
        </button>
        <button
          type="button"
          className={`sb-item ${view === "social" ? "active" : ""}`}
          onClick={() => setView("social")}
        >
          <span className="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="8" cy="8" r="0.8" fill="currentColor"/>
            </svg>
          </span>
          <span>Social</span>
          <span className="count">{friends.length}</span>
        </button>
        <button
          type="button"
          className={`sb-item ${view === "graph" ? "active" : ""}`}
          onClick={() => setView("graph")}
        >
          <span className="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="1.8" fill="currentColor"/>
              <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="11" r="1.8" fill="currentColor"/>
              <circle cx="3" cy="12" r="1.3" fill="currentColor"/>
              <path d="M4 4l4 7M12 5l-4 6M3 12l5-1" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
            </svg>
          </span>
          <span>Brain map</span>
        </button>
      </div>

      <div className="sb-section">
        <span>Notes</span>
        <button type="button" title="New note" onClick={onCreate}>+</button>
      </div>
      <div className="sb-tree">
        {GROUPS.map((g) => (
          <TreeGroup
            key={g.id}
            label={g.label}
            notes={grouped.map[g.id]}
            activeId={activeId}
            onOpen={onOpen}
          />
        ))}
        {grouped.other.length > 0 && (
          <TreeGroup label="Other" notes={grouped.other} activeId={activeId} onOpen={onOpen} />
        )}

        {friends.length > 0 && (
          <>
            <div className="sb-section">
              <span>Friends</span>
              <span style={{ fontSize: 9.5, color: "var(--fg-faint)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                click to chat
              </span>
            </div>
            <div className="sb-tree-children" style={{ paddingLeft: 0 }}>
              <button
                type="button"
                className={`sb-item ${chatTarget === "self" ? "active" : ""}`}
                onClick={() => onChatWith("self")}
                title="Chat with your own agent"
              >
                <span className="icon">
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%",
                    background: "var(--accent)", color: "var(--bg)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, fontWeight: 700,
                  }}>{user.displayName.slice(0, 1).toUpperCase()}</span>
                </span>
                <span className="title-text">your agent</span>
                <span className="count" style={{ fontFamily: "var(--font-mono)" }}>you</span>
              </button>
              {friends.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`sb-item ${chatTarget === f.id ? "active" : ""}`}
                  onClick={() => onChatWith(f.id)}
                  title={`Chat with ${f.displayName}'s agent`}
                >
                  <span className="icon">
                    <span style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: "var(--accent)", color: "var(--bg)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, fontWeight: 700,
                    }}>{f.displayName.slice(0, 1).toUpperCase()}</span>
                  </span>
                  <span className="title-text">{f.displayName}</span>
                  <span className="count" style={{ fontFamily: "var(--font-mono)" }}>{f.myScope}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="sb-foot">
        <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
        <div className="who">
          <div className="name">{user.displayName}</div>
          <div className="handle">{user.email}</div>
        </div>
        <button type="button" className="signout" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}
