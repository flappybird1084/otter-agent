import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, toUiNoteSummary, toUiActiveNote } from "@/lib/api-server";

export async function GET() {
  try {
    const user = await requireUser();
    const notes = await api.getNotes(user.id);
    return NextResponse.json({ notes: notes.map(toUiNoteSummary) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      slug?: string;
      bodyMd?: string;
      kind?: string;
    };
    const created = await api.createNote(user.id, {
      title: body.title,
      slug: body.slug,
      body: body.bodyMd,
      kind: body.kind,
    });
    return NextResponse.json({ note: toUiActiveNote(created) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
