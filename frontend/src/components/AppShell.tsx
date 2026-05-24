"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import NoteEditor from "./NoteEditor";
import ChatPanel from "./ChatPanel";
import SocialView from "./SocialView";
import CalendarView from "./CalendarView";
import GraphView from "./GraphView";
import SearchModal from "./SearchModal";
import TelegramLinkButton from "./TelegramLinkButton";

const LEFT_DEFAULT = 240;
const RIGHT_DEFAULT = 360;
const LEFT_MIN = 180;
const LEFT_MAX = 480;
const RIGHT_MIN = 240;
const RIGHT_MAX = 600;

export type View = "brain" | "calendar" | "social" | "graph";

export type ShareTier = "private" | "public" | "friends" | "close_friends" | "family";

export interface NoteSummary {
  id: string;
  title: string;
  slug: string;
  kind: string;
  status: string | null;
  dueAt: string | null;
  updatedAt: string;
  sortIndex?: number;
  shareTier: ShareTier;
}

export interface ActiveNote {
  id: string;
  title: string;
  slug: string;
  bodyMd: string;
  kind: string;
  status: string | null;
  dueAt: string | null;
  shareTier: ShareTier;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
}

export default function AppShell({
  user,
  notes,
  initialNote,
}: {
  user: AppUser;
  notes: NoteSummary[];
  initialNote: ActiveNote | null;
}) {
  const [view, setView] = useState<View>("brain");
  const [active, setActive] = useState<ActiveNote | null>(initialNote);
  const [allNotes, setAllNotes] = useState<NoteSummary[]>(notes);
  const [searchOpen, setSearchOpen] = useState(false);
  // "self" = chat with own agent. Friend id = chat with that friend's agent.
  const [chatTarget, setChatTarget] = useState<string>("self");

  // Resizable sidebars — drag the splitter to set width; dbl-click resets.
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [rightW, setRightW] = useState(RIGHT_DEFAULT);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const l = parseInt(localStorage.getItem("confluent.leftW") || "", 10);
    const r = parseInt(localStorage.getItem("confluent.rightW") || "", 10);
    if (!Number.isNaN(l) && l >= LEFT_MIN && l <= LEFT_MAX) setLeftW(l);
    if (!Number.isNaN(r) && r >= RIGHT_MIN && r <= RIGHT_MAX) setRightW(r);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("confluent.leftW", String(leftW));
    }
  }, [leftW]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("confluent.rightW", String(rightW));
    }
  }, [rightW]);

  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);
  function onSplitterMouseDown(side: "left" | "right") {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftW : rightW,
      };
      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const delta = ev.clientX - d.startX;
        if (d.side === "left") {
          const next = Math.max(LEFT_MIN, Math.min(LEFT_MAX, d.startW + delta));
          setLeftW(next);
        } else {
          // right side: dragging right shrinks the chat panel
          const next = Math.max(
            RIGHT_MIN,
            Math.min(RIGHT_MAX, d.startW - delta),
          );
          setRightW(next);
        }
      };
      const onUp = () => {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const openNote = useCallback(async (id: string) => {
    const res = await fetch(`/api/notes/${id}`);
    if (!res.ok) return;
    const j = (await res.json()) as { note: ActiveNote };
    setActive(j.note);
    setView("brain");
  }, []);

  async function createNote(kind?: string) {
    const titleByKind: Record<string, string> = {
      daily: "Untitled daily",
      project: "Untitled project",
      task: "New task",
      note: "Untitled",
      person: "Untitled person",
    };
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: titleByKind[kind || "note"] || "Untitled",
        kind: kind || "note",
      }),
    });
    if (!res.ok) return;
    const j = (await res.json()) as { note: ActiveNote & { updatedAt: string } };
    setAllNotes((cur) => [
      {
        id: j.note.id, title: j.note.title, slug: j.note.slug, kind: j.note.kind,
        status: j.note.status, dueAt: j.note.dueAt, updatedAt: j.note.updatedAt,
        shareTier: j.note.shareTier,
      },
      ...cur,
    ]);
    setActive(j.note);
    setView("brain");
  }

  async function deleteNote(id: string) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setAllNotes((cur) => cur.filter((n) => n.id !== id));
    setActive((cur) => (cur && cur.id === id ? null : cur));
  }

  async function moveNote(noteId: string, newSortIndex: number, newKind?: string) {
    // Optimistic update
    setAllNotes((cur) =>
      cur.map((n) =>
        n.id === noteId
          ? { ...n, kind: newKind || n.kind, sortIndex: newSortIndex }
          : n,
      ),
    );
    const body: Record<string, unknown> = { sort_index: newSortIndex };
    if (newKind) body.kind = newKind;
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Refetch on failure to recover ground truth
      const r = await fetch("/api/notes");
      if (r.ok) {
        const j = (await r.json()) as { notes: NoteSummary[] };
        setAllNotes(j.notes);
      }
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function onNoteSaved(updated: ActiveNote) {
    setActive(updated);
    setAllNotes((cur) =>
      cur.map((n) =>
        n.id === updated.id
          ? {
              ...n,
              title: updated.title,
              kind: updated.kind,
              status: updated.status,
              dueAt: updated.dueAt,
              shareTier: updated.shareTier,
              updatedAt: new Date().toISOString(),
            }
          : n,
      ),
    );
  }

  // Refetch notes (and the open note's body) whenever the agent mutates
  // anything note-shaped via its tools. ChatPanel dispatches the event.
  useEffect(() => {
    const handler = async () => {
      try {
        const r = await fetch("/api/notes");
        if (r.ok) {
          const j = (await r.json()) as { notes: NoteSummary[] };
          setAllNotes(j.notes);
        }
      } catch { /* noop */ }
      const activeId = active?.id;
      if (activeId) {
        try {
          const r2 = await fetch(`/api/notes/${activeId}`);
          if (r2.ok) {
            const j2 = (await r2.json()) as { note: ActiveNote };
            setActive(j2.note);
          } else if (r2.status === 404) {
            setActive(null);
          }
        } catch { /* noop */ }
      }
    };
    window.addEventListener("confluent:notes-changed", handler);
    return () => window.removeEventListener("confluent:notes-changed", handler);
  }, [active?.id]);

  // ⌘K / Ctrl-K opens search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const initials = user.displayName.slice(0, 1).toUpperCase();

  const crumb =
    view === "brain"
      ? active?.title ?? "Brain"
      : view === "calendar"
      ? "Calendar"
      : view === "social"
      ? "Trust rings"
      : "Brain map";

  return (
    <div
      className="app"
      style={{
        gridTemplateColumns: `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px`,
      }}
    >
      <div className="topbar">
        <div className="tb-dots">
          <span className="tb-dot"></span>
          <span className="tb-dot"></span>
          <span className="tb-dot"></span>
        </div>
        <div className="tb-title">
          <span className="brand">otterbox</span>
          <span className="sep">·</span>
          <span>{crumb}</span>
        </div>
        <div className="tb-spacer"></div>
        <div className="tb-pills">
          {(["brain", "calendar", "social", "graph"] as View[]).map((v) => (
            <button
              key={v}
              className={`tb-pill ${view === v ? "active" : ""}`}
              onClick={() => setView(v)}
            >
              {v === "brain" ? "Brain" : v === "calendar" ? "Calendar" : v === "social" ? "Social" : "Brain map"}
            </button>
          ))}
        </div>
        <div className="tb-spacer"></div>
        <div className="tb-right">
          <TelegramLinkButton />
          <button className="tb-btn" onClick={() => setSearchOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Search
            <span className="kbd">⌘K</span>
          </button>
          <button className="tb-btn" title={user.email} onClick={logout}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "var(--accent)", color: "var(--bg)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700,
            }}>{initials}</span>
            <span>{user.displayName}</span>
          </button>
        </div>
      </div>

      <Sidebar
        view={view}
        setView={setView}
        notes={allNotes}
        activeId={active?.id ?? null}
        onOpen={openNote}
        onCreate={createNote}
        onDelete={deleteNote}
        onMoveNote={moveNote}
        user={user}
        onLogout={logout}
        onOpenSearch={() => setSearchOpen(true)}
        chatTarget={chatTarget}
        onChatWith={setChatTarget}
      />

      <Splitter
        onMouseDown={onSplitterMouseDown("left")}
        onDoubleClick={() => setLeftW(LEFT_DEFAULT)}
        title="Drag to resize · double-click to reset"
      />

      {view === "brain" ? (
        active ? (
          <NoteEditor key={active.id} note={active} onSaved={onNoteSaved} />
        ) : (
          <div className="main"><div className="main-body"><div className="empty">No note selected. Create one from the sidebar.</div></div></div>
        )
      ) : view === "calendar" ? (
        <CalendarView />
      ) : view === "social" ? (
        <SocialView />
      ) : (
        <GraphView onPick={openNote} />
      )}

      <Splitter
        onMouseDown={onSplitterMouseDown("right")}
        onDoubleClick={() => setRightW(RIGHT_DEFAULT)}
        title="Drag to resize · double-click to reset"
      />

      <ChatPanel target={chatTarget} setTarget={setChatTarget} />

      {searchOpen && (
        <SearchModal
          notes={allNotes}
          onPick={(id) => {
            setSearchOpen(false);
            void openNote(id);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

function Splitter({
  onMouseDown,
  onDoubleClick,
  title,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        cursor: "col-resize",
        background: hover ? "var(--border)" : "transparent",
        transition: "background 120ms",
        borderLeft: "1px solid var(--border-soft)",
        borderRight: "1px solid var(--border-soft)",
        zIndex: 5,
      }}
    />
  );
}
