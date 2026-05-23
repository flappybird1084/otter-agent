import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api-server";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams.get("q") || "";
    const { results } = await api.searchNotes(user.id, q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
