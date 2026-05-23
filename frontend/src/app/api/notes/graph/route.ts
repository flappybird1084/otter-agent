import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api-server";

export async function GET() {
  try {
    const user = await requireUser();
    const g = await api.notesGraph(user.id);
    return NextResponse.json(g);
  } catch {
    return NextResponse.json({ nodes: [], edges: [] });
  }
}
