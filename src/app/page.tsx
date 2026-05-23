import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }> | { note?: string };
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  // Next.js 15+: searchParams may be a Promise
  const sp = (await Promise.resolve(searchParams)) as { note?: string };

  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, slug: true, kind: true, status: true, dueAt: true, updatedAt: true },
    take: 500,
  });

  let activeNote = null;
  const wantSlug = sp?.note;
  if (wantSlug) {
    activeNote = await prisma.note.findUnique({
      where: { userId_slug: { userId: user.id, slug: wantSlug } },
    });
    if (!activeNote) {
      const title = wantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      activeNote = await prisma.note.create({
        data: {
          userId: user.id,
          title,
          slug: wantSlug,
          bodyMd: `# ${title}\n\n`,
          kind: "note",
        },
      });
    }
  } else if (notes[0]) {
    activeNote = await prisma.note.findUnique({ where: { id: notes[0].id } });
  }

  return (
    <AppShell
      user={user}
      notes={notes.map((n) => ({
        id: n.id,
        title: n.title,
        slug: n.slug,
        kind: n.kind,
        status: n.status,
        dueAt: n.dueAt ? n.dueAt.toISOString() : null,
        updatedAt: n.updatedAt.toISOString(),
      }))}
      initialNote={
        activeNote
          ? {
              id: activeNote.id,
              title: activeNote.title,
              slug: activeNote.slug,
              bodyMd: activeNote.bodyMd,
              kind: activeNote.kind,
              status: activeNote.status,
              dueAt: activeNote.dueAt ? activeNote.dueAt.toISOString() : null,
            }
          : null
      }
    />
  );
}
