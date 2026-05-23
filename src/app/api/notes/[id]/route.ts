import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const note = await prisma.note.findFirst({
      where: { id, userId: user.id },
    });
    if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ note });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      bodyMd?: string;
      status?: string;
    };
    const existing = await prisma.note.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.bodyMd !== undefined ? { bodyMd: body.bodyMd } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return NextResponse.json({ note });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const existing = await prisma.note.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.note.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
