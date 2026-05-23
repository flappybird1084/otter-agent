import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
