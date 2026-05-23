"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CalendarEvent } from "@/lib/types";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  // YYYY-MM-DD in local time
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    .toISOString()
    .slice(0, 10);
}

function dayLabel(key: string) {
  const d = new Date(key + "T00:00:00");
  const weekday = d.toLocaleDateString([], { weekday: "long" });
  const md = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    .toISOString()
    .slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowKey = new Date(
    tomorrow.getFullYear(),
    tomorrow.getMonth(),
    tomorrow.getDate(),
  )
    .toISOString()
    .slice(0, 10);
  if (key === todayKey) return { primary: "Today", secondary: md };
  if (key === tomorrowKey) return { primary: "Tomorrow", secondary: md };
  return { primary: weekday, secondary: md };
}

export function CalendarView({ userId }: { userId: string }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  async function refresh() {
    try {
      const ev = await api.getCalendar(userId);
      setEvents(ev);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Group by day, keep only today onward, sort ascending.
  const todayKey = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
      .toISOString()
      .slice(0, 10);
  })();

  const byDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (!ev.start) continue;
    const k = dayKey(ev.start);
    if (k < todayKey) continue;
    const arr = byDay.get(k) || [];
    arr.push(ev);
    byDay.set(k, arr);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }
  const dayKeys = Array.from(byDay.keys()).sort();

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-900 text-xs uppercase tracking-wider text-zinc-500 flex items-center justify-between">
        <span>Calendar</span>
        <span className="text-[10px] normal-case tracking-normal text-zinc-600">
          next 7+ days
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {dayKeys.length === 0 && (
          <div className="px-4 py-6 text-sm text-zinc-600">
            No upcoming events.
          </div>
        )}
        {dayKeys.map((key) => {
          const { primary, secondary } = dayLabel(key);
          return (
            <div key={key} className="border-b border-zinc-900/60">
              <div className="px-4 py-1.5 bg-zinc-950/60 sticky top-0 flex items-baseline gap-2">
                <div className="text-sm font-medium text-zinc-200">
                  {primary}
                </div>
                <div className="text-xs text-zinc-500">{secondary}</div>
              </div>
              <ul>
                {byDay.get(key)!.map((ev) => {
                  const proposed = ev.status === "proposed";
                  return (
                    <li
                      key={ev.id}
                      className={
                        "px-4 py-2 flex items-start gap-3 border-l-2 " +
                        (proposed
                          ? "border-emerald-500 bg-emerald-900/10"
                          : "border-transparent hover:bg-zinc-900/40")
                      }
                    >
                      <div className="font-mono text-xs text-zinc-400 w-24 shrink-0 pt-0.5">
                        {fmtTime(ev.start)}
                        <div className="text-[10px] text-zinc-600">
                          {fmtTime(ev.end)}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-100 flex items-center gap-2">
                          <span className="truncate">
                            {ev.title || "(busy)"}
                          </span>
                          {proposed && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 border border-emerald-700/60">
                              proposed
                            </span>
                          )}
                        </div>
                        {ev.location && (
                          <div className="text-xs text-zinc-500 truncate">
                            {ev.location}
                          </div>
                        )}
                        {ev.attendees && ev.attendees.length > 0 && (
                          <div className="text-[10px] text-zinc-600 mt-0.5">
                            with {ev.attendees.length} other
                            {ev.attendees.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
