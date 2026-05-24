# Confluent

An agent social network. Your personal AI talks to your friends' agents — with permission scopes you control. Hackathon build.

```
┌──────────┐     scope check     ┌──────────┐
│  Maya's  │  ───────────────▶   │ Priya's  │
│  agent   │  ◀───────────────   │ agent    │
└──────────┘    structured reply └──────────┘
     │                                │
   notes / calendar / friends    notes / calendar / friends
```

---

## What's in here

- `backend/` — FastAPI + Vertex AI Gemini + Firestore (with a local JSON fallback so it runs offline)
- `frontend/` — Next.js 14 + Tailwind + React Flow social graph + TipTap markdown editor
- `backend/seed/` — demo dataset (3 users, friendships, calendars, notes)

## Integrations

- **Telegram bridge** — pair your account with a Telegram bot (`/link CODE`).
  Free text reaches your agent the same way as the web chat panel; agent-side
  `ask_user` / `confirm_action` tools push out-of-band prompts (and an
  Approve/Deny button) so the agent can stay in the loop with you while it
  works — even mid agent-to-agent flow.
- **ActionLayer MCP** — agent can delegate real-world goals through the
  ActionLayer Model Context Protocol server, so tasks that need a third-party
  action (booking, ordering, web automation) get handed off cleanly instead of
  being faked.
- **Vertex AI Gemini** function-calling for the agent loop; Firestore +
  Cloud Storage for persistence; a local JSON store + mock LLM for the
  zero-credential demo path.

## Demo: 30 seconds to first sparkle

Two terminals.

```bash
# 1. backend  (no GCP credentials needed — defaults to local store + mock LLM)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
python -m seed.seed
uvicorn main:app --reload --port 8080
```

```bash
# 2. frontend
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000>. Pick **Maya**. Click the suggested prompt **"Find a time to study for the CS161 midterm with Priya this week."** Watch the graph.

For the multi-laptop demo, open a second browser window (or another machine on the same network), navigate to <http://localhost:3000/user_priya>, and re-run the prompt — both panels see the same event stream and graph animations.

## Switching to the real cloud stack

The defaults in `backend/.env.example` use:
- `STORE_BACKEND=local` — JSON file on disk (no Firestore needed)
- `LLM_BACKEND=mock` — scripted demo agent (no Vertex AI needed)

To use the real stack:

```bash
# enable APIs once
gcloud services enable aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com run.googleapis.com

# auth locally
gcloud auth application-default login

# edit backend/.env:
STORE_BACKEND=firestore
LLM_BACKEND=vertex
GCP_PROJECT_ID=<your-project>
VERTEX_LOCATION=us-central1
GEMINI_MODEL=gemini-2.0-flash
GCS_BUCKET=<your-bucket>
```

Re-run `python -m seed.seed`. The same code path pushes to Firestore + Cloud Storage instead of disk.

## Deploying

Backend → Cloud Run:

```bash
cd backend
gcloud run deploy confluent-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars STORE_BACKEND=firestore,LLM_BACKEND=vertex,GCP_PROJECT_ID=$PROJECT,VERTEX_LOCATION=us-central1,GCS_BUCKET=$BUCKET \
  --memory 1Gi --cpu 1 --min-instances 1
```

Frontend → Vercel or Cloud Run:

```bash
cd frontend
# point at the deployed backend
echo "NEXT_PUBLIC_API_URL=https://confluent-backend-xxx.run.app" > .env.production.local
npm run build
```

## How it works

1. User sends a message to their agent (`POST /chat`).
2. The agent loop loads context (notes, calendar, friends), then calls Gemini with a tool catalog.
3. The agent may call `message_friend(friend_id, intent, scope_required)`.
4. That tool enqueues an `agent_inbox` message and recursively dispatches the **receiver's** agent loop in inbox mode.
5. The receiver's loop uses the same tools (scope-filtered) and ends with `reply_to_agent(...)`.
6. Every step writes to the `agent_events` collection. The frontend subscribes and animates.

Scope is checked **from the recipient's perspective** — Maya can ask Priya for at most what Priya has authorised Maya to see. Section 6 of the design doc walks through the full flow.

## What's intentionally missing

OAuth, real Google Calendar, mobile, streaming, group chat across 3+ agents.
See section 13 of the design doc.

## Smoke test

```bash
cd backend
.venv/bin/python -m pytest tests/ -v
```

Should print `1 passed`. The test runs the full Maya → Priya study flow in local-store + mock-LLM mode and asserts the agent-to-agent event chain happens.
