"use client";
import { useEffect, useMemo, useState } from "react";

interface CalEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
}

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const HOUR_PX = 56;
// Events below this rendered-height are too short for the two-line layout —
// switch to a compact single-line variant (title only, smaller padding).
const COMPACT_THRESHOLD_PX = 34;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Mon
  x.setDate(x.getDate() - day);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtHour(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function CalendarView() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CalEvent | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    setLoading(true);
    fetch(`/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j: { events: CalEvent[] }) => setEvents(j.events))
      .finally(() => setLoading(false));
  }, [weekStart, refreshTick]);

  // Refetch whenever the agent reports a calendar mutation in any chat turn.
  useEffect(() => {
    const handler = () => setRefreshTick((n) => n + 1);
    window.addEventListener("confluent:calendar-changed", handler);
    return () => window.removeEventListener("confluent:calendar-changed", handler);
  }, []);

  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();
  const todayIdx = days.findIndex(
    (d) =>
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate(),
  );

  const eventsByDay = useMemo(() => {
    const map: CalEvent[][] = Array.from({ length: 7 }, () => []);
    for (const e of events) {
      const start = new Date(e.startsAt);
      for (let i = 0; i < 7; i++) {
        const d = days[i];
        if (
          start.getFullYear() === d.getFullYear() &&
          start.getMonth() === d.getMonth() &&
          start.getDate() === d.getDate()
        ) {
          map[i].push(e);
          break;
        }
      }
    }
    return map;
  }, [events, days]);

  const monthLabel = weekStart.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="main">
      <div className="main-head">
        <div className="crumb">
          <span>Calendar</span>
          <span className="sep">/</span>
          <span className="leaf">Week of {weekStart.toISOString().slice(0, 10)}</span>
        </div>
        <div className="main-head-actions">
          <button className="tb-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
          <span className="meta" style={{ fontFamily: "var(--font-mono)" }}>{monthLabel}</span>
          <button className="tb-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
          <button className="tb-btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        </div>
      </div>

      <div className="cal-week">
        <div className="cal-week-main">
        <div className="cal-header">
          <div className="cal-gutter"></div>
          {days.map((d, i) => (
            <div key={i} className={`cal-day-head ${i === todayIdx ? "today" : ""}`}>
              <div className="dow">{DOW[i]}</div>
              <div className="dnum">{d.getDate()}</div>
            </div>
          ))}
        </div>

        <div className="cal-body">
          <div className="cal-grid">
            <div className="cal-gutter cal-hours">
              {HOURS.map((h) => (
                <div key={h} className="cal-hour-lbl" style={{ height: HOUR_PX }}>{fmtHour(h)}</div>
              ))}
            </div>

            {days.map((_, di) => (
              <div key={di} className="cal-day-col">
                {HOURS.map((h) => (
                  <div key={h} className="cal-hour-line" style={{ height: HOUR_PX }}></div>
                ))}
                {eventsByDay[di].map((e) => {
                  const start = new Date(e.startsAt);
                  const end = new Date(e.endsAt);
                  const startH = start.getHours() + start.getMinutes() / 60;
                  const endH = end.getHours() + end.getMinutes() / 60;
                  if (endH < HOURS[0] || startH > HOURS[HOURS.length - 1] + 1) return null;
                  const top = Math.max(0, (startH - HOURS[0]) * HOUR_PX);
                  const height = Math.max(22, (endH - startH) * HOUR_PX - 2);
                  const compact = height < COMPACT_THRESHOLD_PX;
                  const isSel = selected?.id === e.id;
                  return (
                    <button
                      type="button"
                      key={e.id}
                      className={`cal-evt ${isSel ? "selected" : ""} ${compact ? "compact" : ""}`}
                      onClick={() => setSelected(e)}
                      style={{
                        top, height,
                        background: "oklch(0.78 0.14 250 / .18)",
                        borderColor: "oklch(0.78 0.14 250 / .55)",
                        color: "oklch(0.92 0.06 250)",
                      }}
                      title={`${e.title} · ${fmtTime(start)}–${fmtTime(end)}${e.notes ? " · " + e.notes : ""}`}
                    >
                      {compact ? (
                        <div className="cal-evt-compact">
                          <span className="cal-evt-time">{fmtTime(start)}</span>
                          <span className="cal-evt-title">{e.title}</span>
                        </div>
                      ) : (
                        <>
                          <div className="cal-evt-title">{e.title}</div>
                          <div className="cal-evt-meta">{fmtTime(start)}–{fmtTime(end)}</div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {loading && <div className="empty"><span className="spinner" /> Loading events…</div>}
        </div>
      </div>

      {selected && (
        <div className="cal-popup-overlay" onClick={() => setSelected(null)}>
          <div className="cal-popup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="cal-popup-head">
              <span className="cal-popup-tag">event</span>
              <button className="cal-popup-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <div className="cal-popup-title">{selected.title}</div>
            <div className="cal-popup-when">
              <span className="cal-popup-when-day">
                {new Date(selected.startsAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
              <span className="cal-popup-when-time">
                {fmtTime(new Date(selected.startsAt))} – {fmtTime(new Date(selected.endsAt))}
              </span>
            </div>
            {selected.notes && (
              <div className="cal-popup-notes">
                <div className="cal-popup-notes-label">Notes</div>
                <div className="cal-popup-notes-body">{selected.notes}</div>
              </div>
            )}
            <div className="cal-popup-foot">
              <button className="tb-btn" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
