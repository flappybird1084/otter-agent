import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Scope = "acquaintance" | "friend" | "family" | "close";

export async function GET() {
  try {
    const me = await requireUser();
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ userAId: me.id }, { userBId: me.id }],
        status: "accepted",
      },
      include: {
        userA: { select: { id: true, email: true, displayName: true } },
        userB: { select: { id: true, email: true, displayName: true } },
      },
    });

    const otherIds = friendships.map((f) => (f.userAId === me.id ? f.userBId : f.userAId));

    const myScopes = await prisma.friendScope.findMany({
      where: { ownerId: me.id, friendId: { in: otherIds } },
    });
    const theirScopes = await prisma.friendScope.findMany({
      where: { friendId: me.id, ownerId: { in: otherIds } },
    });
    const myScopeMap = new Map<string, Scope>(myScopes.map((s) => [s.friendId, s.scope as Scope]));
    const theirScopeMap = new Map<string, Scope>(theirScopes.map((s) => [s.ownerId, s.scope as Scope]));

    const friends = friendships.map((f) => {
      const other = f.userAId === me.id ? f.userB : f.userA;
      return {
        id: other.id,
        email: other.email,
        displayName: other.displayName,
        myScope: (myScopeMap.get(other.id) ?? "acquaintance") as Scope,
        theirScope: (theirScopeMap.get(other.id) ?? "acquaintance") as Scope,
      };
    });

    return NextResponse.json({
      me: { id: me.id, displayName: me.displayName },
      friends,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
