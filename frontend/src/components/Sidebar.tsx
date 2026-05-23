"use client";
import { useEffect, useMemo, useState } from "react";
import type { NoteSummary, AppUser, View } from "./AppShell";

interface FriendRow {
  id: string;
  displayName: string;
  email: string;
  myScope: string;
  theirScope: string;
}

const SCOPE_RANK: Record<string, number> = {
  acquaintance: 0,
  friend: 1,
  close: 2,
  family: 3,
};
const SCOPE_LABEL: Record<string, string> = {
  acquaintance: "acquaintance",
  friend: "friend",
  close: "close",
  family: "family",
};

function effectiveScope(mine: string, theirs: string): string {
  // The lower of the two — whichever direction is tighter governs what data
  // actually flows in either direction.
  const a = SCOPE_RANK[mine] ?? 0;
  const b = SCOPE_RANK[theirs] ?? 0;
  return a <= b ? mine : theirs;
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

interface DragPayload {
  noteId: string;
  fromKind: string;
}

function midpointIndex(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

function TreeGroup({
  label,
  kind,
  notes,
  activeId,
  onOpen,
  onCreateInGroup,
  onDelete,
  onMoveNote,
}: {
  label: string;
  kind: string;
  notes: NoteSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreateInGroup?: (kind: string) => void;
  onDelete?: (noteId: string) => void;
  onMoveNote?: (noteId: string, newSortIndex: number, newKind?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  function readPayload(e: React.DragEvent): DragPayload | null {
    try {
      const raw = e.dataTransfer.getData("application/x-note");
      if (!raw) return null;
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  }

  function handleDrop(e: React.DragEvent, insertAt: number) {
    e.preventDefault();
    e.stopPropagation();
    setHoverIdx(null);
    const payload = readPayload(e);
    if (!payload || !onMoveNote) return;
    // Skip the moved item from sibling list when computing neighbors so it
    // doesn't try to slot between itself.
    const siblings = notes.filter((n) => n.id !== payload.noteId);
    const before = siblings[insertAt - 1]?.sortIndex;
    const after = siblings[insertAt]?.sortIndex;
    const newSort = midpointIndex(before, after);
    const newKind = payload.fromKind !== kind ? kind : undefined;
    onMoveNote(payload.noteId, newSort, newKind);
  }

  function allowDrop(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("application/x-note")) {
      e.preventDefault();
    }
  }

  return (
    <div className="sb-tree-group">
      <div
        className={`sb-tree-label${open ? "" : " collapsed"}`}
        style={{ display: "flex", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
        onDragOver={allowDrop}
        onDrop={(e) => handleDrop(e, notes.length)}
      >
        <span className="chev">▾</span>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", color: "var(--fg-faint)", fontSize: 10 }}>{notes.length}</span>
        {onCreateInGroup && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCreateInGroup(kind); }}
            title={`New ${kind}`}
            style={{
              marginLeft: 6, width: 16, height: 16, padding: 0,
              background: "transparent", border: "1px solid var(--border-soft)",
              borderRadius: 4, cursor: "pointer", fontSize: 11, lineHeight: 1,
              color: "var(--fg-mute)",
            }}
          >+</button>
        )}
      </div>
      {open && (
        <div
          className="sb-tree-children"
          onDragOver={allowDrop}
          onDrop={(e) => handleDrop(e, notes.length)}
        >
          {notes.length === 0 && (
            <div style={{
              padding: "6px 10px", fontSize: 11, color: "var(--fg-faint)",
              fontStyle: "italic",
            }}>
              — empty — drag here or +
            </div>
          )}
          {notes.map((n, i) => {
            const isActive = activeId === n.id;
            const isHover = hoverIdx === i;
            return (
              <div key={n.id} style={{ position: "relative" }}>
                {isHover && (
                  <div
                    style={{
                      position: "absolute", top: -1, left: 6, right: 6,
                      height: 2, background: "var(--accent)", borderRadius: 1,
                      pointerEvents: "none",
                    }}
                  />
                )}
                <div
                  className={`sb-item ${isActive ? "active" : ""}`}
                  draggable
                  onClick={() => onOpen(n.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-note",
                      JSON.stringify({ noteId: n.id, fromKind: n.kind }),
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-note")) {
                      e.preventDefault();
                      setHoverIdx(i);
                    }
                  }}
                  onDragLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                  onDrop={(e) => handleDrop(e, i)}
                  style={{ cursor: "grab", paddingRight: 4 }}
                >
                  <span className="icon"><NoteIcon kind={n.kind} /></span>
                  <span className="title-text">{n.title}</span>
                  {onDelete && (
                    <button
                      type="button"
                      className="sb-item-del"
                      title="Delete note"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${n.title}"?`)) onDelete(n.id);
                      }}
                      style={{
                        marginLeft: "auto",
                        width: 16, height: 16, padding: 0,
                        background: "transparent", border: "none",
                        color: "var(--fg-faint)", cursor: "pointer",
                        fontSize: 12, lineHeight: 1,
                      }}
                    >×</button>
                  )}
                </div>
              </div>
            );
          })}
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
  onDelete,
  onMoveNote,
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
  onCreate: (kind?: string) => void;
  onDelete?: (noteId: string) => void;
  onMoveNote?: (noteId: string, newSortIndex: number, newKind?: string) => void;
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
        <button type="button" title="New note" onClick={() => onCreate()}>+</button>
      </div>
      <div className="sb-tree">
        {GROUPS.map((g) => (
          <TreeGroup
            key={g.id}
            label={g.label}
            kind={g.kinds[0]}
            notes={grouped.map[g.id]}
            activeId={activeId}
            onOpen={onOpen}
            onCreateInGroup={onCreate}
            onDelete={onDelete}
            onMoveNote={onMoveNote}
          />
        ))}
        {grouped.other.length > 0 && (
          <TreeGroup
            label="Other"
            kind="note"
            notes={grouped.other}
            activeId={activeId}
            onOpen={onOpen}
            onDelete={onDelete}
            onMoveNote={onMoveNote}
          />
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
                <FriendChatRow
                  key={f.id}
                  friend={f}
                  active={chatTarget === f.id}
                  onChatWith={onChatWith}
                />
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

function FriendChatRow({
  friend,
  active,
  onChatWith,
}: {
  friend: FriendRow;
  active: boolean;
  onChatWith: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const eff = effectiveScope(friend.myScope, friend.theirScope);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className={`sb-item ${active ? "active" : ""}`}
        onClick={() => onChatWith(friend.id)}
      >
        <span className="icon">
          <span style={{
            width: 14, height: 14, borderRadius: "50%",
            background: "var(--accent)", color: "var(--bg)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, fontWeight: 700,
          }}>{friend.displayName.slice(0, 1).toUpperCase()}</span>
        </span>
        <span className="title-text">{friend.displayName}</span>
        <span className="count" style={{ fontFamily: "var(--font-mono)" }}>
          {SCOPE_LABEL[eff] ?? eff}
        </span>
      </button>
      {hover && (
        <div
          style={{
            position: "absolute",
            right: 8,
            top: "calc(100% + 4px)",
            zIndex: 30,
            minWidth: 200,
            padding: "8px 10px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 8px 20px rgba(0,0,0,.35)",
            fontSize: 11,
            color: "var(--fg-mute)",
            lineHeight: 1.5,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Your scope for them</span>
            <span style={{ color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
              {SCOPE_LABEL[friend.myScope] ?? friend.myScope}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Their scope for you</span>
            <span style={{ color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
              {SCOPE_LABEL[friend.theirScope] ?? friend.theirScope}
            </span>
          </div>
          <div
            style={{
              marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-soft)",
              display: "flex", justifyContent: "space-between", gap: 8,
            }}
          >
            <span>Effective scope</span>
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              {SCOPE_LABEL[eff] ?? eff}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
