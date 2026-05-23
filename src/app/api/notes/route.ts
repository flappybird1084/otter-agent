import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/vault";

export async function GET() {
  try {
    const user = await requireUser();
    const notes = await prisma.note.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, slug: true, kind: true, updatedAt: true },
    });
    return NextResponse.json({ notes });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      bodyMd?: string;
      kind?: string;
    };
    const title = body.title ?? "Untitled";
    const slug = slugify(title);
    const note = await prisma.note.create({
      data: {
        userId: user.id,
        title,
        slug,
        bodyMd: body.bodyMd ?? `# ${title}\n\n`,
        kind: body.kind ?? "note",
      },
    });
    return NextResponse.json({ note });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
