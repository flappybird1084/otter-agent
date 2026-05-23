import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { api, toUiNoteSummary, toUiActiveNote, type BackendNote } from "@/lib/api-server";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; title?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const sp = await searchParams;

  let notesRaw: BackendNote[] = [];
  try {
    notesRaw = await api.getNotes(user.id);
  } catch {
    notesRaw = [];
  }
  // Backend already returns notes sorted by sort_index ascending (with
  // updated_at desc fallback for notes that don't have one yet). Keep that.
  const notes = notesRaw.map(toUiNoteSummary);

  let activeNote = null;
  const wantSlug = sp?.note;
  const wantTitle = sp?.title;
  if (wantSlug) {
    try {
      const n = await api.getNoteBySlug(user.id, wantSlug);
      activeNote = toUiActiveNote(n);
    } catch {
      // Autocreate by slug if not found — wiki-link click into an unknown note.
      // Pass the human-readable title when available so casing/punctuation is
      // preserved instead of falling back to slug.title-cased.
      try {
        const created = await api.createNote(user.id, {
          slug: wantSlug,
          title: wantTitle || undefined,
        });
        activeNote = toUiActiveNote(created);
      } catch {
        activeNote = null;
      }
    }
  } else if (notes.length > 0) {
    try {
      const first = await api.getNote(user.id, notes[0].id);
      activeNote = toUiActiveNote(first);
    } catch {
      activeNote = null;
    }
  }

  return <AppShell user={user} notes={notes} initialNote={activeNote} />;
}
