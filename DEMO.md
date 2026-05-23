# Confluent demo flow

## Prereqs

- `npm install` done
- `.env.local` has a real `ANTHROPIC_API_KEY`
- `npm run db:setup` has run (creates SQLite db + 4 personas + ~15 notes each)
- `npm run dev` is running on http://localhost:3000

## Personas

All four use password `demo`:

- alice@demo.local
- bob@demo.local
- carol@demo.local
- dave@demo.local

## Click-by-click

1. Open **http://localhost:3000** → redirected to **/login**.
2. Click the **Alice** quick-login button. Land on the three-pane app.
3. **Left pane (Sidebar):**
   - Type `roadmap` in the search box — top hit is "Roadmap" (FTS5).
   - Click **+ New note** — a blank "Untitled" note opens in the middle pane.
4. **Middle pane (NoteEditor):**
   - Change the title to `Demo`.
   - In the body, type: `Linking to [[Roadmap]] should be clickable.`
   - Wait ~1s — "saved" appears in the header (debounced PUT to /api/notes/[id]).
   - Click the `[[Roadmap]]` text → navigates to `/?note=roadmap`, opens that note.
   - Click `[[NewThing]]` (after adding it) → navigates and **auto-creates** the note.
5. **Right pane (ChatPanel):**
   - Type: `what's on my plate today?` and press Enter.
   - Watch streaming text appear. Tool chips render under the assistant message (e.g. `tool: brain_list_tasks ✓`, `tool: cal_list_events ✓`).
   - Try: `create a note titled Standup prep with three bullets for tomorrow's standup` — the agent calls `brain_create_note`. Refresh sidebar to see it.
   - Try: `find me a 30-minute free slot in the next 3 days` — the agent calls `cal_find_free`.
6. **Sign out** (bottom of sidebar) → back to /login.
7. **Switch persona:** click **Bob** to confirm notes are user-scoped (Alice's notes are gone).

## URLs

- `/` — main app (requires session)
- `/login` — login
- `/signup` — signup
- `/api/auth/{login,signup,logout}` — auth
- `/api/notes` — list/create
- `/api/notes/[id]` — get/update/delete
- `/api/notes/search?q=…` — FTS5 search
- `/api/chat` — POST `{message}`, returns SSE

## Known gaps (steps 4–6 stubbed)

- "Friends" tab in sidebar opens placeholder.
- No cross-user agent messaging.
- No Telegram bot.
