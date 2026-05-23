import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, backendToUiScope } from "@/lib/api-server";

export async function GET() {
  try {
    const me = await requireUser();
    const data = await api.getSocial(me.id);
    return NextResponse.json({
      me: { id: data.me.id, displayName: data.me.display_name },
      friends: data.friends.map((f) => ({
        id: f.id,
        displayName: f.display_name,
        email: f.handle,
        myScope: backendToUiScope(f.my_scope_of_them),
        theirScope: backendToUiScope(
          (f.their_scope_of_me ?? "acquaintance") as
            | "acquaintance" | "friend" | "family" | "close_friend",
        ),
        visibleNotes: f.visible_notes,
      })),
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
