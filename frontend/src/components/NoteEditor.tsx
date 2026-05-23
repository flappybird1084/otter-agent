"use client";
import { useEditor, EditorContent, Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import TurndownService from "turndown";
import type { ActiveNote, ShareTier } from "./AppShell";

const SHARE_TIERS: { id: ShareTier; label: string; sub: string; hue: number }[] = [
  { id: "private", label: "Private", sub: "only you",                hue: 280 },
  { id: "public",  label: "Public",  sub: "anyone, even strangers",  hue: 200 },
];

// Display normalization: anything stored as friends/close_friends/family
// (seed data or legacy notes) is collapsed to "public" in the UI. The user
// can re-pick private/public to commit a new tier.
function displayTier(t: ShareTier): "private" | "public" {
  return t === "private" ? "private" : "public";
}

function tierMeta(t: ShareTier) {
  const id = displayTier(t);
  return SHARE_TIERS.find((s) => s.id === id) ?? SHARE_TIERS[0];
}

// ─── TipTap custom node: wiki links ──────────────────────────────────────
// Renders as a clickable [[Title]] chip in the editor; on click navigates
// to /?note=<slug>, creating the note if absent.
const WikiLink = Node.create({
  name: "wikiLink",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title as string }),
      },
      slug: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-slug") ?? "",
        renderHTML: (attrs) => ({ "data-slug": attrs.slug as string }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-wiki-link]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "true",
        class: "wiki-link",
        "data-title": node.attrs.title as string,
        "data-slug": (node.attrs.slug || slugify(node.attrs.title as string)) as string,
      }),
      `[[${node.attrs.title as string}]]`,
    ];
  },
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "untitled";
}

// ─── Markdown ↔ HTML ────────────────────────────────────────────────────
// marked handles full CommonMark + GFM (headings, lists, tables, fenced
// code, etc). We post-process its output to replace [[wiki-links]] with our
// custom node, and to normalize task list markup into the shape TipTap's
// TaskList/TaskItem extensions expect (ul data-type="taskList").

marked.use({
  gfm: true,
  breaks: true,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

// Preserve wiki-link spans as `[[Title]]` when converting HTML back to MD.
turndown.addRule("wikiLink", {
  filter: (node: HTMLElement) =>
    node.nodeName === "SPAN" && node.getAttribute("data-wiki-link") === "true",
  replacement: (_content: string, node: unknown) => {
    const el = node as HTMLElement;
    const title = el.getAttribute("data-title") ?? el.textContent ?? "";
    const t = title.replace(/^\[\[/, "").replace(/\]\]$/, "");
    return `[[${t}]]`;
  },
});

// Round-trip TipTap's task list back to the GFM `- [ ]` form.
turndown.addRule("taskListItem", {
  filter: (node: HTMLElement) =>
    node.nodeName === "LI" && node.getAttribute("data-type") === "taskItem",
  replacement: (content: string, node: unknown) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    const text = content.replace(/\n+/g, " ").trim();
    return `- [${checked ? "x" : " "}] ${text}\n`;
  },
});
turndown.addRule("taskList", {
  filter: (node: HTMLElement) =>
    node.nodeName === "UL" && node.getAttribute("data-type") === "taskList",
  replacement: (content: string) => `\n${content}\n`,
});

function mdToHtml(md: string): string {
  // Pre-pass: convert [[Wiki]] into our placeholder so marked doesn't mangle it.
  const wikiPlaceholders: string[] = [];
  const stashed = md.replace(/\[\[([^\]]+)\]\]/g, (_m, title: string) => {
    const i = wikiPlaceholders.length;
    wikiPlaceholders.push(title);
    return `[[WIKI:${i}]]`;
  });
  let html = marked.parse(stashed, { async: false }) as string;
  // Restore wiki-links as our TipTap node markup.
  html = html.replace(/\[\[WIKI:(\d+)\]\]/g, (_m, idxStr: string) => {
    const title = wikiPlaceholders[parseInt(idxStr, 10)] ?? "";
    const slug = slugify(title);
    return `<span data-wiki-link="true" class="wiki-link" data-title="${escapeAttr(title)}" data-slug="${slug}">[[${escapeAttr(title)}]]</span>`;
  });
  // marked emits checkbox task lists like:
  //   <ul>
  //   <li><input checked="" disabled="" type="checkbox"> foo</li>
  //   </ul>
  // The attribute order and whitespace vary across versions, so the regex is
  // lenient: any <li> whose first child is a checkbox <input> becomes a TipTap
  // taskItem; any <ul> containing taskItem children becomes a taskList.
  html = html.replace(
    /<li[^>]*>\s*<input([^>]*)>\s*([\s\S]*?)<\/li>/g,
    (m, attrs: string, body: string) => {
      if (!/type\s*=\s*["']?checkbox/i.test(attrs)) return m;
      const checked = /\bchecked(\b|=)/i.test(attrs);
      return `<li data-type="taskItem" data-checked="${checked}"><p>${body.trim()}</p></li>`;
    },
  );
  html = html.replace(
    /<ul[^>]*>(\s*(?:<li data-type="taskItem"[\s\S]*?<\/li>\s*)+)<\/ul>/g,
    (_m, body: string) => `<ul data-type="taskList">${body}</ul>`,
  );
  return html;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlToMd(html: string): string {
  return turndown.turndown(html);
}

export default function NoteEditor({
  note,
  onSaved,
}: {
  note: ActiveNote;
  onSaved: (n: ActiveNote) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [shareTier, setShareTier] = useState<ShareTier>(note.shareTier);
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBody = useRef<string>(note.bodyMd);
  // True for one tick after onSaved runs, so the parent's note-prop update
  // (which carries OUR just-saved body) doesn't re-trigger setContent and
  // clobber any keystrokes the user typed during the save round-trip.
  const fromSaveRef = useRef(false);

  useEffect(() => {
    setTitle(note.title);
    setShareTier(note.shareTier);
    latestBody.current = note.bodyMd;
  }, [note.id, note.title, note.shareTier, note.bodyMd]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      WikiLink,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: mdToHtml(note.bodyMd),
    editorProps: {
      attributes: {
        class: "ProseMirror",
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null;
        if (target && target.closest("[data-wiki-link]")) {
          const el = target.closest("[data-wiki-link]") as HTMLElement;
          let slug = el.getAttribute("data-slug") || "";
          let titleAttr = el.getAttribute("data-title") || "";
          // Recover from data lost on round-trip: fall back to the rendered
          // [[Title]] text, then derive the missing piece from the other.
          if (!titleAttr) {
            const m = (el.textContent || "").match(/^\s*\[\[(.+?)\]\]\s*$/);
            if (m) titleAttr = m[1];
          }
          if (!slug && titleAttr) slug = slugify(titleAttr);
          if (slug) {
            const url = titleAttr
              ? `/?note=${encodeURIComponent(slug)}&title=${encodeURIComponent(titleAttr)}`
              : `/?note=${encodeURIComponent(slug)}`;
            window.location.href = url;
            return true;
          }
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML();
      latestBody.current = htmlToMd(html);
      scheduleSave();
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // When the parent passes new bodyMd (e.g., agent updated the note via a
  // tool), sync TipTap's content. Skip if the change came from our own save
  // — otherwise we'd clobber keystrokes typed during the save round-trip.
  useEffect(() => {
    if (!editor) return;
    if (fromSaveRef.current) {
      fromSaveRef.current = false;
      return;
    }
    const incoming = mdToHtml(note.bodyMd);
    if (editor.getHTML() === incoming) return;
    // `false` for emitUpdate so onUpdate doesn't fire and re-save what we
    // just pulled in.
    editor.commands.setContent(incoming, false);
  }, [editor, note.bodyMd]);

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 800);
  }

  async function save(extra?: Partial<{ shareTier: ShareTier }>) {
    setSaving(true);
    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        bodyMd: latestBody.current,
        shareTier: extra?.shareTier ?? shareTier,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const j = (await res.json()) as { note: ActiveNote };
      // Mark before onSaved so the prop-driven useEffect that fires on the
      // next render sees the flag and skips the setContent refresh.
      fromSaveRef.current = true;
      onSaved(j.note);
    }
  }

  async function changeShareTier(next: ShareTier) {
    setShareTier(next);
    setTierMenuOpen(false);
    await save({ shareTier: next });
  }

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleSave();
  }

  const dueLabel = note.dueAt ? new Date(note.dueAt).toISOString().slice(0, 10) : null;

  return (
    <div className="main">
      <div className="main-head">
        <div className="crumb">
          <span>{capitalize(note.kind ?? "note")}</span>
          <span className="sep">/</span>
          <span className="leaf">{title}</span>
        </div>
        <div className="main-head-actions">
          <span className="meta">{saving ? "saving…" : "saved"}</span>
        </div>
      </div>
      <div className="main-body">
        <div className="note-doc">
          <div className="note-frontmatter">
            <span className="fm-chip">
              <span className="dot"></span>
              <b>kind:</b><span className="v">{note.kind}</span>
            </span>
            {note.status && (
              <span className="fm-chip">
                <span className={`dot ${note.status}`}></span>
                <b>status:</b><span className="v">{note.status}</span>
              </span>
            )}
            {dueLabel && (
              <span className="fm-chip">
                <b>due:</b><span className="v">{dueLabel}</span>
              </span>
            )}
            <span style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                className="fm-chip"
                onClick={() => setTierMenuOpen((v) => !v)}
                title="Click to change who can see this note"
                style={{
                  cursor: "pointer", background: "transparent",
                  border: `1px solid oklch(0.55 0.12 ${tierMeta(shareTier).hue} / .55)`,
                }}
              >
                <span
                  className="dot"
                  style={{
                    background: `oklch(0.72 0.16 ${tierMeta(shareTier).hue})`,
                  }}
                ></span>
                <b>share:</b>
                <span className="v">{tierMeta(shareTier).label.toLowerCase()}</span>
                <span style={{ color: "var(--fg-faint)", marginLeft: 2, fontSize: 9 }}>▾</span>
              </button>
              {tierMenuOpen && (
                <>
                  <div
                    onClick={() => setTierMenuOpen(false)}
                    style={{
                      position: "fixed", inset: 0, zIndex: 30,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0,
                      zIndex: 31, minWidth: 220,
                      background: "var(--bg-elev)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.4)",
                      padding: 4, display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    {SHARE_TIERS.map((s) => {
                      const active = s.id === displayTier(shareTier);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => void changeShareTier(s.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                            background: active ? "var(--bg)" : "transparent",
                            border: active
                              ? `1px solid oklch(0.55 0.12 ${s.hue} / .6)`
                              : "1px solid transparent",
                            textAlign: "left",
                          }}
                        >
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: `oklch(0.72 0.16 ${s.hue})`,
                          }} />
                          <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                            <span style={{ color: "var(--fg)", fontSize: 12, fontWeight: 600 }}>
                              {s.label}
                            </span>
                            <span style={{ color: "var(--fg-faint)", fontSize: 10 }}>
                              {s.sub}
                            </span>
                          </span>
                          {active && (
                            <span style={{ color: "var(--accent)", fontSize: 11 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </span>
          </div>
          <input
            className="note-title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Untitled"
          />
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
