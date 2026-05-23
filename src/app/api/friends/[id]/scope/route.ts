import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const VALID = new Set(["acquaintance", "friend", "family", "close"]);

interface Ctx { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { scope?: string };
    if (!body.scope || !VALID.has(body.scope)) {
      return NextResponse.json({ error: "invalid scope" }, { status: 400 });
    }

    const fs = await prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { userAId: me.id, userBId: id },
          { userAId: id, userBId: me.id },
        ],
      },
    });
    if (!fs) return NextResponse.json({ error: "not friends" }, { status: 404 });

    const existing = await prisma.friendScope.findUnique({
      where: { ownerId_friendId: { ownerId: me.id, friendId: id } },
    });
    if (existing) {
      await prisma.friendScope.update({
        where: { ownerId_friendId: { ownerId: me.id, friendId: id } },
        data: { scope: body.scope },
      });
    } else {
      await prisma.friendScope.create({
        data: { ownerId: me.id, friendId: id, scope: body.scope },
      });
    }

    return NextResponse.json({ ok: true, scope: body.scope });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
