"use client";
import { useEditor, EditorContent, Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import TurndownService from "turndown";
import type { ActiveNote } from "./AppShell";

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
      title: { default: "" },
      slug: { default: "" },
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
  replacement: (_content: string, node: Node) => {
    const title = (node as HTMLElement).getAttribute("data-title") ?? (node as HTMLElement).textContent ?? "";
    const t = title.replace(/^\[\[/, "").replace(/\]\]$/, "");
    return `[[${t}]]`;
  },
});

// Round-trip TipTap's task list back to the GFM `- [ ]` form.
turndown.addRule("taskListItem", {
  filter: (node: HTMLElement) =>
    node.nodeName === "LI" && node.getAttribute("data-type") === "taskItem",
  replacement: (content: string, node: Node) => {
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
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBody = useRef<string>(note.bodyMd);

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
          const slug = el.getAttribute("data-slug");
          const titleAttr = el.getAttribute("data-title");
          if (slug) {
            window.location.href = `/?note=${encodeURIComponent(slug)}`;
            return true;
          }
          if (titleAttr) {
            window.location.href = `/?note=${encodeURIComponent(slugify(titleAttr))}`;
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

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 800);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, bodyMd: latestBody.current }),
    });
    setSaving(false);
    if (res.ok) {
      const j = (await res.json()) as { note: ActiveNote };
      onSaved(j.note);
    }
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
