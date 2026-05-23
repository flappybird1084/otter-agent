import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, toUiActiveNote } from "@/lib/api-server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const note = await api.getNote(user.id, id);
    return NextResponse.json({ note: toUiActiveNote(note) });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      bodyMd?: string;
      kind?: string;
      status?: string;
      due_at?: string;
      sort_index?: number;
    };
    const updated = await api.updateNote(user.id, id, {
      title: body.title,
      body: body.bodyMd,
      kind: body.kind,
      status: body.status,
      due_at: body.due_at,
      sort_index: body.sort_index,
    });
    return NextResponse.json({ note: toUiActiveNote(updated) });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await api.deleteNote(user.id, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
