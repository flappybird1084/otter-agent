import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "./db";

export const COOKIE_NAME = "confluent_session";
const SEVEN_DAYS_SEC = 60 * 60 * 24 * 7;

interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = jwt.sign({ userId } satisfies JWTPayload, secret(), {
    expiresIn: SEVEN_DAYS_SEC,
  });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SEVEN_DAYS_SEC,
  });
  return token;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  let payload: JWTPayload;
  try {
    payload = jwt.verify(token, secret()) as JWTPayload;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, displayName: true },
  });
  return user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}
