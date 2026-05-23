/**
 * Confluent seed script. Idempotent: bails out early if Alice exists.
 * Creates 4 demo personas, ~15 notes each (DB + vault/<user>/<slug>.md),
 * calendar events for the next 2 weeks, and friendships with scopes.
 *
 * Also installs the FTS5 virtual table + triggers so search "just works".
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "untitled";
}

const PERSONAS = [
  { email: "alice@demo.local", displayName: "Alice" },
  { email: "bob@demo.local", displayName: "Bob" },
  { email: "carol@demo.local", displayName: "Carol" },
  { email: "dave@demo.local", displayName: "Dave" },
];

function notesFor(name: string): { title: string; body: string; kind: string; status?: string; dueAt?: Date }[] {
  const today = new Date();
  const inDays = (d: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() + d);
    return x;
  };
  return [
    { title: "Memory", body: `# About me\n\nMy name is ${name}. I use this app as a second brain.\n`, kind: "note" },
    { title: `Daily ${today.toISOString().slice(0, 10)}`, body: `# Today\n\n- morning standup\n- focus block\n`, kind: "daily" },
    { title: "Project Otter", body: `# Project Otter\n\nNotes on the otter prototype. See [[Roadmap]].\n`, kind: "note" },
    { title: "Roadmap", body: `# Roadmap\n\n- v0: notes + chat\n- v1: friends graph\n- v2: agent-to-agent\n`, kind: "note" },
    { title: "Books to read", body: `# Reading\n\n- The Beginning of Infinity\n- Seeing Like a State\n`, kind: "note" },
    { title: "Recipes", body: `# Recipes\n\n## Carbonara\nEggs, guanciale, pecorino. No cream.\n`, kind: "note" },
    { title: "Workout plan", body: `# Workout\n\nMon: pull. Tue: legs. Wed: rest. Thu: push.\n`, kind: "note" },
    { title: "Travel ideas", body: `# Travel\n\n- Lisbon spring\n- Hokkaido winter\n`, kind: "note" },
    { title: "Gift ideas", body: `# Gifts\n\n- mom: pottery class\n- dad: cast iron\n`, kind: "note" },
    { title: "Finish quarterly review", body: `Write up Q-review by Friday.`, kind: "task", status: "open", dueAt: inDays(3) },
    { title: "Buy groceries", body: `eggs, oat milk, spinach`, kind: "task", status: "open", dueAt: inDays(1) },
    { title: "Call dentist", body: `book cleaning`, kind: "task", status: "open", dueAt: inDays(5) },
    { title: "Renew passport", body: `expires next year`, kind: "task", status: "open", dueAt: inDays(10) },
    { title: "Meeting notes - kickoff", body: `# Kickoff\n\nAttendees: team.\nDecisions: ship MVP in 2 weeks.\n`, kind: "note" },
    { title: "Ideas backlog", body: `# Ideas\n\n- offline-first sync\n- per-note encryption\n`, kind: "note" },
  ];
}

function eventsFor(): { title: string; daysOut: number; hour: number; durationH: number; notes?: string }[] {
  return [
    { title: "Standup", daysOut: 0, hour: 10, durationH: 0.5 },
    { title: "Focus block", daysOut: 0, hour: 14, durationH: 2 },
    { title: "1:1 with manager", daysOut: 1, hour: 11, durationH: 0.5 },
    { title: "Dentist", daysOut: 3, hour: 9, durationH: 1, notes: "bring insurance" },
    { title: "Dinner with friends", daysOut: 5, hour: 19, durationH: 2, notes: "Italian place" },
    { title: "Gym", daysOut: 6, hour: 7, durationH: 1 },
    { title: "Project demo", daysOut: 7, hour: 15, durationH: 1 },
    { title: "Family call", daysOut: 9, hour: 18, durationH: 1 },
    { title: "Doctor checkup", daysOut: 12, hour: 10, durationH: 1 },
  ];
}

async function installFTS(): Promise<void> {
  // Idempotent FTS5 virtual table + triggers keyed on Note.rowid.
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, slug, bodyMd, content='Note', content_rowid='rowid'
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON "Note" BEGIN
      INSERT INTO notes_fts(rowid, title, slug, bodyMd) VALUES (new.rowid, new.title, new.slug, new.bodyMd);
    END;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON "Note" BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, slug, bodyMd) VALUES('delete', old.rowid, old.title, old.slug, old.bodyMd);
    END;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON "Note" BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, slug, bodyMd) VALUES('delete', old.rowid, old.title, old.slug, old.bodyMd);
      INSERT INTO notes_fts(rowid, title, slug, bodyMd) VALUES (new.rowid, new.title, new.slug, new.bodyMd);
    END;
  `);
  // Rebuild to pick up rows already inserted.
  try {
    await prisma.$executeRawUnsafe(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild');`);
  } catch {
    // ignore
  }
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "alice@demo.local" } });
  if (existing) {
    console.log("seed: alice already exists, skipping");
    await installFTS();
    return;
  }

  const passwordHash = await bcrypt.hash("demo", 10);

  const users: Record<string, { id: string; email: string; displayName: string }> = {};
  for (const p of PERSONAS) {
    const u = await prisma.user.create({
      data: { email: p.email, displayName: p.displayName, passwordHash },
    });
    users[p.displayName.toLowerCase()] = u;

    const username = p.email.split("@")[0];
    const dir = path.join(process.cwd(), "vault", username);
    await fs.mkdir(dir, { recursive: true });

    for (const n of notesFor(p.displayName)) {
      const slug = slugify(n.title);
      const note = await prisma.note.create({
        data: {
          userId: u.id,
          title: n.title,
          slug,
          bodyMd: n.body,
          kind: n.kind,
          status: n.status ?? null,
          dueAt: n.dueAt ?? null,
        },
      });
      const fp = path.join(dir, `${slug}.md`);
      const out = matter.stringify(n.body, {
        title: n.title,
        slug,
        kind: n.kind,
        status: n.status ?? null,
        dueAt: n.dueAt ? n.dueAt.toISOString() : null,
        updatedAt: new Date().toISOString(),
      });
      await fs.writeFile(fp, out, "utf8");
      await prisma.note.update({ where: { id: note.id }, data: { filePath: fp } });
    }

    for (const e of eventsFor()) {
      const start = new Date();
      start.setDate(start.getDate() + e.daysOut);
      start.setHours(e.hour, 0, 0, 0);
      const end = new Date(start.getTime() + e.durationH * 60 * 60 * 1000);
      await prisma.calendarEvent.create({
        data: {
          userId: u.id,
          title: e.title,
          startsAt: start,
          endsAt: end,
          notes: e.notes ?? null,
        },
      });
    }
  }

  // Friendships (symmetric ordering for uniqueness).
  async function friend(a: string, b: string) {
    const [x, y] = [users[a].id, users[b].id].sort();
    await prisma.friendship.create({
      data: { userAId: x, userBId: y, status: "accepted" },
    });
  }
  async function scope(owner: string, friend: string, s: string) {
    await prisma.friendScope.create({
      data: { ownerId: users[owner].id, friendId: users[friend].id, scope: s },
    });
  }

  await friend("alice", "bob");
  await scope("alice", "bob", "close");
  await scope("bob", "alice", "close");

  await friend("alice", "carol");
  await scope("alice", "carol", "family");
  await scope("carol", "alice", "close");

  await friend("alice", "dave");
  await scope("alice", "dave", "acquaintance");
  await scope("dave", "alice", "acquaintance");

  await installFTS();

  console.log("seed: done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
