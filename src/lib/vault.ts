import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import { prisma } from "./db";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "untitled";
}

export function vaultPath(username: string): string {
  return path.join(process.cwd(), "vault", username);
}

interface NoteLike {
  title: string;
  slug: string;
  bodyMd: string;
  kind?: string | null;
  status?: string | null;
  dueAt?: Date | null;
  updatedAt?: Date;
}

interface UserLike {
  email: string;
}

function usernameFromEmail(email: string): string {
  return email.split("@")[0] ?? "user";
}

export async function writeNote(user: UserLike, note: NoteLike): Promise<string> {
  const dir = vaultPath(usernameFromEmail(user.email));
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${note.slug}.md`);
  const fm = {
    title: note.title,
    slug: note.slug,
    kind: note.kind ?? "note",
    status: note.status ?? null,
    dueAt: note.dueAt ? note.dueAt.toISOString() : null,
    updatedAt: (note.updatedAt ?? new Date()).toISOString(),
  };
  const out = matter.stringify(note.bodyMd ?? "", fm);
  await fs.writeFile(fp, out, "utf8");
  return fp;
}

export interface ParsedNote {
  title: string;
  slug: string;
  bodyMd: string;
  kind: string;
  status: string | null;
  dueAt: Date | null;
}

export async function readNote(filepath: string): Promise<ParsedNote> {
  const raw = await fs.readFile(filepath, "utf8");
  const { data, content } = matter(raw);
  return {
    title: typeof data.title === "string" ? data.title : path.basename(filepath, ".md"),
    slug: typeof data.slug === "string" ? data.slug : slugify(path.basename(filepath, ".md")),
    bodyMd: content,
    kind: typeof data.kind === "string" ? data.kind : "note",
    status: typeof data.status === "string" ? data.status : null,
    dueAt: typeof data.dueAt === "string" ? new Date(data.dueAt) : null,
  };
}

export async function syncNoteFromFile(userId: string, filepath: string): Promise<void> {
  const parsed = await readNote(filepath);
  await prisma.note.upsert({
    where: { userId_slug: { userId, slug: parsed.slug } },
    create: {
      userId,
      title: parsed.title,
      slug: parsed.slug,
      bodyMd: parsed.bodyMd,
      kind: parsed.kind,
      status: parsed.status,
      dueAt: parsed.dueAt,
      filePath: filepath,
    },
    update: {
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      kind: parsed.kind,
      status: parsed.status,
      dueAt: parsed.dueAt,
      filePath: filepath,
    },
  });
}
