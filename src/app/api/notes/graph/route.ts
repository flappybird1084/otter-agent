import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "untitled";
}

export async function GET() {
  try {
    const user = await requireUser();
    const notes = await prisma.note.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, slug: true, kind: true, bodyMd: true },
    });

    const bySlug = new Map<string, string>();
    const byTitleLc = new Map<string, string>();
    for (const n of notes) {
      bySlug.set(n.slug, n.id);
      byTitleLc.set(n.title.toLowerCase(), n.id);
    }

    const seen = new Set<string>();
    const edges: { a: string; b: string }[] = [];
    const re = /\[\[([^\]]+)\]\]/g;
    for (const n of notes) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(n.bodyMd)) !== null) {
        const ref = m[1].trim();
        const targetId =
          byTitleLc.get(ref.toLowerCase()) ?? bySlug.get(slugify(ref));
        if (!targetId || targetId === n.id) continue;
        const key = [n.id, targetId].sort().join("→");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: n.id, b: targetId });
      }
    }

    return NextResponse.json({
      nodes: notes.map((n) => ({ id: n.id, title: n.title, kind: n.kind })),
      edges,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
