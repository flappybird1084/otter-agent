import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (!q) return NextResponse.json({ results: [] });

    try {
      const rows = await prisma.$queryRawUnsafe<
        { id: string; title: string; slug: string; snippet: string }[]
      >(
        `SELECT n.id, n.title, n.slug, snippet(notes_fts, 2, '[', ']', '...', 8) AS snippet
         FROM notes_fts JOIN "Note" n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ? AND n.userId = ?
         LIMIT 20`,
        q,
        user.id,
      );
      return NextResponse.json({ results: rows });
    } catch {
      const rows = await prisma.note.findMany({
        where: {
          userId: user.id,
          OR: [{ title: { contains: q } }, { bodyMd: { contains: q } }],
        },
        take: 20,
        select: { id: true, title: true, slug: true, bodyMd: true },
      });
      return NextResponse.json({
        results: rows.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          snippet: r.bodyMd.slice(0, 160),
        })),
      });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
