import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");

    const now = new Date();
    const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const to = toStr ? new Date(toStr) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);

    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        startsAt: { gte: from, lte: to },
      },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true, endsAt: true, notes: true },
    });

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        notes: e.notes,
      })),
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
