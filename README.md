# Confluent

A second-brain agent: notes, chat, calendar — local SQLite, Google Gemini-powered.

## Setup

```bash
npm install
cp .env.local.example .env.local   # or edit the existing .env.local
# Put your real Google AI Studio key in GOOGLE_API_KEY=
npm run db:setup                   # runs prisma migrate + seeds demo personas
npm run dev
```

Open http://localhost:3000 — you'll be redirected to /login. In demo mode (default), use one of the persona buttons.

## What works (MVP steps 1–3)

1. **Auth** — bcrypt + JWT in httpOnly cookie. Sign up / sign in / sign out.
2. **Notes + vault** — Prisma-backed notes, TipTap editor with wiki-links (`[[Title]]`), markdown files in `vault/<username>/<slug>.md`, FTS5 search.
3. **Agent chat** — streaming Gemini (`gemini-2.0-flash`) chat with tools (search, get/create/update notes, daily note, calendar list/find-free/create). SSE in `/api/chat`.

## Stubbed (steps 4–6)

- **Friends graph / scope policy** — `src/lib/scope-policy.ts` is implemented + heavily commented, but no UI hooks it up. `SocialView` is a placeholder.
- **Agent-to-agent messaging** — `AgentMessage` model exists, no flow.
- **Telegram bot** — only env var + `scripts/dev.sh` placeholder.
- **Approval inbox** — `ApprovalRequest` model exists, no UI.

## Scripts

| script | purpose |
|---|---|
| `npm run dev` | next dev |
| `npm run build` / `npm start` | production build |
| `npm run db:setup` | migrate + seed |
| `npm run db:seed` | re-run seed (idempotent) |
