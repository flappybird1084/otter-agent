import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api, toUiUser } from "@/lib/api-server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!body.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  let user;
  try {
    user = await api.getUser(body.userId);
  } catch {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const ui = toUiUser(user);
  const c = await cookies();
  c.set("confluent_user", JSON.stringify(ui), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ user: ui });
}
