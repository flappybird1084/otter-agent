import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, uiToBackendScope, type UiScope } from "@/lib/api-server";

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { scope?: UiScope };
    if (!body.scope) {
      return NextResponse.json({ error: "scope required" }, { status: 400 });
    }
    await api.setScope(me.id, id, uiToBackendScope(body.scope));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
