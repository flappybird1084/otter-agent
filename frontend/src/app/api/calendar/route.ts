import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, toUiCalendarEvent } from "@/lib/api-server";

export async function GET() {
  try {
    const user = await requireUser();
    const events = await api.getCalendar(user.id);
    return NextResponse.json({ events: events.map(toUiCalendarEvent) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
