"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyScope, type Scope, type Intent, type SharePayload } from "@/lib/scope-policy";

interface VisibleNote {
  id: string;
  title: string;
  slug?: string;
  kind?: string;
  share_tier?: string;
}

interface Friend {
  id: string;
  displayName: string;
  email: string;
  myScope: Scope;
  theirScope: Scope;
  visibleNotes?: VisibleNote[];
}

// Rings ordered innermost (family — deepest trust) -> outermost (acquaintance).
const SCOPES: { id: Scope; label: string; blurb: string; hue: number }[] = [
  { id: "family",       label: "Family",       blurb: "Most-trusted tier — everything Close gets, plus contact info (email, phone).", hue: 60 },
  { id: "close",        label: "Close",        blurb: "Full availability + locations, note titles + bodies, tasks. Almost everything.", hue: 145 },
  { id: "friend",       label: "Friend",       blurb: "Day-level free/busy + event names only. No location, no notes, no tasks.", hue: 220 },
  { id: "acquaintance", label: "Acquaintance", blurb: "Bio + any notes marked public. Free/busy hints at most. No event titles, no locations, no scoped notes, no tasks.", hue: 280 },
];

const INTENT_LABELS: { intent: Intent; label: string }[] = [
  { intent: "share_public_profile", label: "Read your bio + public notes" },
  { intent: "share_availability",   label: "Ask if you're free at a specific time" },
  { intent: "share_event",          label: "See details of your calendar events" },
  { intent: "share_location",       label: "Know where you'll be" },
  { intent: "share_note",           label: "Read your note titles and bodies" },
  { intent: "share_task",           label: "See what tasks are on your plate" },
  { intent: "share_contact",        label: "Get your email/phone" },
];

const SAMPLE: SharePayload = {
  startsAt: "2026-05-28T16:00:00Z",
  endsAt: "2026-05-28T17:30:00Z",
  location: "123 Lab Drive, Mountain View",
  noteTitle: "Bio outline",
  noteBody: "Working on the bio project outline.",
  taskTitle: "Send notes",
  taskDueAt: "2026-05-30T00:00:00Z",
  contact: { email: "me@example.com", phone: "+1 555 0100" },
};

function scopePermitsIntent(scope: Scope, intent: Intent): boolean {
  const out = applyScope(scope, intent, SAMPLE);
  return Object.keys(out).length > 0 && !(intent === "share_event" && out.text === "busy" && Object.keys(out).length === 1);
}

function initialsOf(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export default function SocialView() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // While dragging a friend node: { id, x, y } in stage-local coords.
  const dragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  // Per-friend local override position while dragging, before commit.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/social");
      if (r.ok) {
        const j = (await r.json()) as { friends: Friend[] };
        setFriends(j.friends);
        if (j.friends.length) setSelectedId(j.friends[0].id);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  const selected = friends.find((f) => f.id === selectedId) ?? null;

  async function commitScope(friendId: string, newScope: Scope) {
    const prev = friends.find((f) => f.id === friendId)?.myScope ?? "acquaintance";
    if (prev === newScope) return;
    setFriends((fs) => fs.map((f) => (f.id === friendId ? { ...f, myScope: newScope } : f)));
    const res = await fetch(`/api/friends/${friendId}/scope`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: newScope }),
    });
    if (!res.ok) {
      setFriends((fs) => fs.map((f) => (f.id === friendId ? { ...f, myScope: prev } : f)));
    }
  }

  const cx = size.w / 2;
  const cy = size.h / 2;
  const maxR = Math.max(120, Math.min(size.w, size.h) / 2 - 70);
  // Ring radii, innermost first. Match SCOPES order.
  const ringRadii = [maxR * 0.30, maxR * 0.52, maxR * 0.76, maxR * 1.0];

  function scopeForRadius(r: number): Scope {
    // Snap to nearest ring band — half-distance between adjacent radii.
    const distances = ringRadii.map((rr, i) => ({ i, d: Math.abs(rr - r) }));
    distances.sort((a, b) => a.d - b.d);
    return SCOPES[distances[0].i].id;
  }

  const positioned = useMemo(() => {
    const byRing: Friend[][] = [[], [], [], []];
    for (const f of friends) {
      const idx = SCOPES.findIndex((s) => s.id === f.myScope);
      byRing[idx < 0 ? 3 : idx].push(f);
    }
    const out: { f: Friend; x: number; y: number; ringIdx: number }[] = [];
    byRing.forEach((list, ringIdx) => {
      const r = ringRadii[ringIdx];
      list.forEach((f, i) => {
        // Spread friends around the ring with a small per-ring rotation so
        // they don't all line up vertically across rings.
        const angleOffset = ringIdx * 0.42;
        const a = (i / Math.max(list.length, 1)) * 2 * Math.PI - Math.PI / 2 + angleOffset;
        out.push({ f, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ringIdx });
      });
    });
    return out;
  }, [friends, cx, cy, ringRadii]);

  // While dragging, show preview position + preview scope (innermost ring
  // the cursor is hovering near).
  const dragPreview = useMemo(() => {
    if (!drag) return null;
    const dx = drag.x - cx;
    const dy = drag.y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    return { ...drag, scope: scopeForRadius(r), r };
  }, [drag, cx, cy]);

  function onNodePointerDown(e: React.PointerEvent, f: Friend) {
    if (!stageRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(f.id);
    const rect = stageRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Where is the node now (computed from layout)? Track the pointer-to-node
    // offset so the node doesn't snap to the cursor.
    const cur = positioned.find((p) => p.f.id === f.id);
    const nodeX = cur?.x ?? sx;
    const nodeY = cur?.y ?? sy;
    dragRef.current = {
      id: f.id,
      pointerId: e.pointerId,
      offsetX: sx - nodeX,
      offsetY: sy - nodeY,
    };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({ id: f.id, x: nodeX, y: nodeY });
  }

  function onStagePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setDrag({
      id: dragRef.current.id,
      x: sx - dragRef.current.offsetX,
      y: sy - dragRef.current.offsetY,
    });
  }

  function onStagePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const cur = dragRef.current;
    try { (e.target as Element).releasePointerCapture(cur.pointerId); } catch { /* noop */ }
    if (drag) {
      const dx = drag.x - cx;
      const dy = drag.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const newScope = scopeForRadius(r);
      void commitScope(cur.id, newScope);
    }
    dragRef.current = null;
    setDrag(null);
  }

  if (loading) {
    return (
      <div className="main">
        <div className="main-body"><div className="empty"><span className="spinner" /> Loading friends…</div></div>
      </div>
    );
  }

  return (
    <div className="main">
      <div className="main-head">
        <div className="crumb">
          <span>Social</span>
          <span className="sep">/</span>
          <span className="leaf">Trust rings</span>
        </div>
        <div className="main-head-actions">
          <span className="meta">{friends.length} friend{friends.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="social">
        <div
          className={`rings-stage ${drag ? "dragging" : ""}`}
          ref={stageRef}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerLeave={onStagePointerUp}
        >
          <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0 }}>
            <defs>
              {SCOPES.map((s, i) => (
                <radialGradient key={i} id={`ring-grad-${i}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`oklch(0.72 0.12 ${s.hue})`} stopOpacity="0" />
                  <stop offset="92%" stopColor={`oklch(0.72 0.12 ${s.hue})`} stopOpacity="0" />
                  <stop offset="100%" stopColor={`oklch(0.72 0.12 ${s.hue})`} stopOpacity="0.5" />
                </radialGradient>
              ))}
              <radialGradient id="you-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.55" />
              </radialGradient>
              <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>

            {/* Rings — innermost (close) drawn last so its outline sits on top */}
            {[...ringRadii].reverse().map((r, ri) => {
              const trueIdx = ringRadii.length - 1 - ri;
              const isPreview = dragPreview?.scope === SCOPES[trueIdx].id;
              const isCurrent = selected?.myScope === SCOPES[trueIdx].id;
              return (
                <g key={`ring-${trueIdx}`}>
                  {/* Soft tinted fill so the ring is visible as a band */}
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke={`oklch(0.55 0.10 ${SCOPES[trueIdx].hue} / .25)`} strokeWidth={1.2} strokeDasharray="3 6" />
                  {/* Glow when hovered by a dragged node */}
                  {isPreview && (
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={`oklch(0.78 0.18 ${SCOPES[trueIdx].hue})`} strokeWidth={3} opacity="0.7" />
                  )}
                  {isCurrent && !isPreview && (
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={`oklch(0.65 0.14 ${SCOPES[trueIdx].hue} / .8)`} strokeWidth={1.8} />
                  )}
                  {/* Ring label */}
                  <text
                    x={cx} y={cy - r - 6}
                    textAnchor="middle"
                    style={{
                      fill: isPreview ? `oklch(0.92 0.18 ${SCOPES[trueIdx].hue})` : `oklch(0.65 0.12 ${SCOPES[trueIdx].hue} / .85)`,
                      fontFamily: "var(--font-mono)",
                      fontSize: isPreview ? 12 : 10,
                      letterSpacing: ".14em",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      transition: "all .15s",
                    }}
                  >
                    {SCOPES[trueIdx].label}
                  </text>
                </g>
              );
            })}

            {/* Center "you" node */}
            <circle cx={cx} cy={cy} r={28} fill="url(#you-grad)" filter="url(#ring-glow)" opacity="0.85" />
            <circle cx={cx} cy={cy} r={22} fill="var(--bg-elev)" stroke="var(--accent)" strokeWidth={2} />
            <text x={cx} y={cy + 5} textAnchor="middle" style={{
              fill: "var(--fg)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
            }}>YOU</text>

            {/* Tether line from center to the currently-dragged or selected friend */}
            {(drag || selected) && (() => {
              const dragged = drag ? positioned.find((p) => p.f.id === drag.id) : null;
              const px = drag?.x ?? positioned.find((p) => p.f.id === selectedId)?.x;
              const py = drag?.y ?? positioned.find((p) => p.f.id === selectedId)?.y;
              if (px === undefined || py === undefined) return null;
              const hue = drag
                ? SCOPES.find((s) => s.id === (dragPreview?.scope ?? "acquaintance"))?.hue ?? 280
                : SCOPES.find((s) => s.id === selected?.myScope)?.hue ?? 280;
              void dragged;
              return (
                <line
                  x1={cx} y1={cy} x2={px} y2={py}
                  stroke={`oklch(0.72 0.16 ${hue} / .8)`}
                  strokeWidth={drag ? 2 : 1.2}
                  strokeDasharray={drag ? "0" : "4 5"}
                />
              );
            })()}

            {/* Friend nodes */}
            {positioned.map(({ f, x: lx, y: ly, ringIdx }) => {
              const isSelected = selectedId === f.id;
              const isDragging = drag?.id === f.id;
              const x = isDragging ? drag!.x : lx;
              const y = isDragging ? drag!.y : ly;
              const hue = SCOPES[ringIdx].hue;
              return (
                <g
                  key={f.id}
                  style={{ cursor: isDragging ? "grabbing" : "grab" }}
                  onPointerDown={(e) => onNodePointerDown(e, f)}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(f.id); }}
                >
                  {/* Glow under node */}
                  <circle cx={x} cy={y} r={26} fill={`oklch(0.72 0.16 ${hue})`} opacity={isDragging || isSelected ? 0.35 : 0.18} filter="url(#ring-glow)" />
                  {/* Outer ring color */}
                  <circle cx={x} cy={y} r={22} fill="var(--bg-elev)" stroke={`oklch(0.72 0.16 ${hue})`} strokeWidth={isSelected || isDragging ? 2.5 : 1.8} />
                  {/* Initials */}
                  <text x={x} y={y + 4} textAnchor="middle" style={{
                    fill: "var(--fg)", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, pointerEvents: "none",
                  }}>{initialsOf(f.displayName)}</text>
                  {/* Name label below */}
                  <text x={x} y={y + 38} textAnchor="middle" style={{
                    fill: isSelected || isDragging ? "var(--fg)" : "var(--fg-mute)",
                    fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: isSelected || isDragging ? 600 : 500,
                    pointerEvents: "none",
                  }}>{f.displayName}</text>
                </g>
              );
            })}

            {/* Scope hint while dragging */}
            {dragPreview && (
              <g pointerEvents="none">
                <rect
                  x={dragPreview.x - 70} y={dragPreview.y - 56}
                  width={140} height={22} rx={11}
                  fill="var(--bg-elev)"
                  stroke={`oklch(0.78 0.16 ${SCOPES.find((s) => s.id === dragPreview.scope)?.hue ?? 280})`}
                />
                <text
                  x={dragPreview.x} y={dragPreview.y - 41}
                  textAnchor="middle"
                  style={{
                    fill: `oklch(0.92 0.18 ${SCOPES.find((s) => s.id === dragPreview.scope)?.hue ?? 280})`,
                    fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 700,
                  }}
                >
                  → {dragPreview.scope}
                </text>
              </g>
            )}
          </svg>

          <div className="rings-help">
            <div className="rings-help-title">Trust rings</div>
            <div className="rings-help-sub">drag a friend to a ring to change scope · click to view permissions</div>
          </div>
        </div>

        <div className="social-panel">
          {selected ? (
            <>
              <div className="social-panel-head">
                <div className="sp-name">{selected.displayName}</div>
                <div className="sp-handle">{selected.email}</div>
                <div className="sp-scope-now">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}></span>
                  {selected.myScope}
                </div>
                <div style={{ marginTop: 8, fontSize: "var(--fs-xs)", color: "var(--fg-faint)" }}>
                  They scope you as <b style={{ color: "var(--fg-dim)" }}>{selected.theirScope}</b>
                </div>
              </div>

              <div className="scope-picker">
                <div className="scope-picker-label">Your scope for them</div>
                {SCOPES.map((s) => {
                  const allowed = INTENT_LABELS.filter((i) => scopePermitsIntent(s.id, i.intent)).length;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`scope-option ${selected.myScope === s.id ? "active" : ""}`}
                      onClick={() => void commitScope(selected.id, s.id)}
                    >
                      <div className="ring-icon" style={{ background: `oklch(0.72 0.16 ${s.hue})` }}></div>
                      <div className="lbl">{s.label}</div>
                      <div className="sub">{allowed}/{INTENT_LABELS.length}</div>
                    </button>
                  );
                })}
              </div>

              <div className="scope-preview">
                <div className="scope-preview-head">What their agent can ask yours</div>
                {INTENT_LABELS.map((i) => {
                  const allow = scopePermitsIntent(selected.myScope, i.intent);
                  return (
                    <div key={i.intent} className={`perm-row ${allow ? "allow" : "deny"}`}>
                      <span className="check">{allow ? "✓" : "×"}</span>
                      <span className="label">{i.label}</span>
                    </div>
                  );
                })}
                <div style={{
                  marginTop: 16, padding: "10px 12px",
                  background: "var(--bg)", border: "1px solid var(--border-soft)",
                  borderRadius: 8, fontSize: 11.5, color: "var(--fg-mute)", lineHeight: 1.5,
                }}>
                  <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 600, marginBottom: 6 }}>
                    About this scope
                  </div>
                  {SCOPES.find((s) => s.id === selected.myScope)?.blurb}
                </div>

                {/* Notes from this friend that you can read */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 600, marginBottom: 6 }}>
                    Notes from {selected.displayName.split(" ")[0]} you can read
                  </div>
                  {(selected.visibleNotes ?? []).length === 0 ? (
                    <div style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
                      None — they haven&apos;t shared any notes at this scope tier.
                    </div>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      {(selected.visibleNotes ?? []).map((n) => (
                        <li key={n.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                          <span style={{
                            fontSize: 9, color: "var(--fg-faint)", textTransform: "uppercase",
                            letterSpacing: ".06em", fontWeight: 600, minWidth: 50,
                          }}>
                            {n.share_tier ?? "public"}
                          </span>
                          <span style={{ color: "var(--fg)" }}>{n.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="empty">Select a friend to see their scope.</div>
          )}
        </div>
      </div>
    </div>
  );
}
