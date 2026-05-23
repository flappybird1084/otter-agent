"use client";
import { useCallback, useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import NoteEditor from "./NoteEditor";
import ChatPanel from "./ChatPanel";
import SocialView from "./SocialView";
import CalendarView from "./CalendarView";
import GraphView from "./GraphView";
import SearchModal from "./SearchModal";

export type View = "brain" | "calendar" | "social" | "graph";

export interface NoteSummary {
  id: string;
  title: string;
  slug: string;
  kind: string;
  status: string | null;
  dueAt: string | null;
  updatedAt: string;
}

export interface ActiveNote {
  id: string;
  title: string;
  slug: string;
  bodyMd: string;
  kind: string;
  status: string | null;
  dueAt: string | null;
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

  const openNote = useCallback(async (id: string) => {
    const res = await fetch(`/api/notes/${id}`);
    if (!res.ok) return;
    const j = (await res.json()) as { note: ActiveNote };
    setActive(j.note);
    setView("brain");
  }, []);

  async function createNote() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    if (!res.ok) return;
    const j = (await res.json()) as { note: ActiveNote & { updatedAt: string } };
    setAllNotes((cur) => [
      {
        id: j.note.id, title: j.note.title, slug: j.note.slug, kind: j.note.kind,
        status: j.note.status, dueAt: j.note.dueAt, updatedAt: j.note.updatedAt,
      },
      ...cur,
    ]);
    setActive(j.note);
    setView("brain");
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
          ? { ...n, title: updated.title, kind: updated.kind, status: updated.status, dueAt: updated.dueAt, updatedAt: new Date().toISOString() }
          : n,
      ),
    );
  }

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
    <div className="app">
      <div className="topbar">
        <div className="tb-dots">
          <span className="tb-dot"></span>
          <span className="tb-dot"></span>
          <span className="tb-dot"></span>
        </div>
        <div className="tb-title">
          <span className="brand">Synapse</span>
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
        user={user}
        onLogout={logout}
        onOpenSearch={() => setSearchOpen(true)}
        chatTarget={chatTarget}
        onChatWith={setChatTarget}
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
