import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api, toUiFriend } from "@/lib/api-server";

export async function GET() {
  try {
    const me = await requireUser();
    const [friends, all] = await Promise.all([
      api.getFriends(me.id),
      api.getAllFriendships(),
    ]);
    const reciprocalByFriend = new Map(
      all
        .filter((f) => f.friend_id === me.id)
        .map((f) => [f.owner_id, f]),
    );
    const uiFriends = friends.map((f) =>
      toUiFriend(f, reciprocalByFriend.get(f.friend_id)),
    );
    return NextResponse.json({
      me: { id: me.id, displayName: me.displayName },
      friends: uiFriends,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
