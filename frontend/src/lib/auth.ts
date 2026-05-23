/**
 * Auth shim — no real auth. The selected user lives in a cookie that the
 * picker on /login sets. Server-only helpers; do not import in a client component.
 *
 * The cookie holds { id, email, displayName } JSON; we read it for both
 * server pages and api routes.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "confluent_user";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const c = await cookies();
  const raw = c.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (parsed && parsed.id) return parsed;
  } catch {}
  return null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new Error("unauthorized");
  return u;
}

export async function requireUserOrRedirect(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) redirect("/login");
  return u;
}

export { COOKIE as USER_COOKIE };
