import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    displayName?: string;
  };
  const { email, password, displayName } = body;
  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ error: "email taken" }, { status: 409 });
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, displayName },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
