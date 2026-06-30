# Otter-agent

<div align="center">

[![Backend: FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Frontend: Next.js 14](https://img.shields.io/badge/Frontend-Next.js%2014-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![LLM: Vertex AI Gemini](https://img.shields.io/badge/LLM-Vertex%20AI%20Gemini-4285F4?style=flat-square&logo=googlecloud&logoColor=white)](https://cloud.google.com/vertex-ai)
[![Google Synthesis Hacks: Best AI Hack](https://img.shields.io/badge/Google%20Synthesis%20Hacks-Best%20AI%20Hack-b23b34?style=flat-square)](https://github.com/flappybird1084/otter-agent/releases/latest)

</div>

**Winner, Best AI Hack at Google Synthesis Hacks.**

> An agent social network. Your personal AI talks to your friends' agents, with permission scopes you control.

## Demo

<div align="center">

<video src="https://github.com/flappybird1084/otter-agent/raw/main/assets/otter-demo.mp4" controls muted playsinline width="820"></video>

<pre>
+----------+     scope check     +----------+
|  Maya's  |  ----------------&gt;  | Priya's  |
|  agent   |  &lt;----------------  | agent    |
+----------+    structured reply +----------+
     |                                |
   notes / calendar / friends    notes / calendar / friends
</pre>

</div>

## Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Repository layout](#repository-layout)
- [Install](#install)
- [Quick start: 30 seconds to first sparkle](#quick-start-30-seconds-to-first-sparkle)
- [Integrations](#integrations)
- [Switching to the real cloud stack](#switching-to-the-real-cloud-stack)
- [Deploying](#deploying)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Smoke test](#smoke-test)
- [Authors](#authors)

## Overview

Otter-agent is an agent social network. Each user has a personal AI that holds
their notes, calendar, and friendships. When you ask your agent to do something
that involves another person, it talks to that person's agent directly, and
every cross-agent request is filtered through permission scopes the other person
controls. Scope is checked from the recipient's perspective: your agent can ask
another agent for at most what that person has authorised you to see.

The result is a small, end-to-end demo of agent-to-agent coordination, calendar
negotiation, and per-friend trust rings, with a live social graph that animates
each step of an exchange.

## Screenshots

<div align="center">

[Brain](#brain) &nbsp;&middot;&nbsp; [Calendar](#calendar) &nbsp;&middot;&nbsp; [Trust rings](#trust-rings) &nbsp;&middot;&nbsp; [Brain map](#brain-map) &nbsp;&middot;&nbsp; [Cross-agent chat](#cross-agent-chat)

</div>

### Brain

<div align="center">

Markdown notes with the agent panel on the right. Ask "who are my friends?" and it pulls from your contacts.

<img src="assets/Screenshot%202026-05-23%20at%2010.58.23%E2%80%AFPM.png" width="820" alt="Brain view" />

</div>

### Calendar

<div align="center">

The agent reaches out to Priya's agent, finds shared free time, and proposes a calendar event for you to confirm.

<img src="assets/Screenshot%202026-05-23%20at%2010.58.34%E2%80%AFPM.png" width="820" alt="Calendar view" />

</div>

### Trust rings

<div align="center">

Per-friend scopes (Family, Close, Friend, Acquaintance) control exactly what the other person's agent can ask yours.

<img src="assets/Screenshot%202026-05-23%20at%2010.58.42%E2%80%AFPM.png" width="820" alt="Trust rings" />

</div>

### Brain map

<div align="center">

A force-directed graph of your notes, projects, todos, and people.

<img src="assets/Screenshot%202026-05-23%20at%2010.58.49%E2%80%AFPM.png" width="820" alt="Brain map" />

</div>

### Cross-agent chat

<div align="center">

Switch into Priya's agent view and ask her brain directly, scope permitting.

<img src="assets/Screenshot%202026-05-23%20at%2010.58.56%E2%80%AFPM.png" width="820" alt="Cross-agent chat" />

</div>

## Repository layout

| path | contents |
|---|---|
| `backend/` | FastAPI, Vertex AI Gemini, and Firestore, with a local JSON fallback so it runs offline |
| `frontend/` | Next.js 14, Tailwind, a React Flow social graph, and a TipTap markdown editor |
| `backend/seed/` | demo dataset (3 users, friendships, calendars, notes) |

## Install

**Prerequisites**

- Python 3.11+
- Node.js 18+ and npm
- (optional, only for the real cloud stack) a Google Cloud project with Vertex AI, Firestore, and Cloud Storage enabled

**1. Get the code**

```bash
git clone https://github.com/flappybird1084/otter-agent.git
cd otter-agent
```

For a pinned, tagged build, grab the latest source from the
[Releases page](https://github.com/flappybird1084/otter-agent/releases/latest).
The release notes double as a step-by-step install and user guide.

**2. Run it**

No cloud credentials are required: the backend defaults to a local JSON store
and a mock LLM, so the full Maya to Priya demo runs entirely offline. Follow
[Quick start](#quick-start-30-seconds-to-first-sparkle) below, then open
<http://localhost:3000> and pick a user. To wire up real Gemini and Firestore,
see [Switching to the real cloud stack](#switching-to-the-real-cloud-stack).

## Quick start: 30 seconds to first sparkle

Two terminals.

```bash
# 1. backend  (no GCP credentials needed; defaults to local store + mock LLM)
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

For the multi-laptop demo, open a second browser window (or another machine on the same network), navigate to <http://localhost:3000/user_priya>, and re-run the prompt. Both panels see the same event stream and graph animations.

## Integrations

- **Telegram bridge.** Pair your account with a Telegram bot (`/link CODE`).
  Free text reaches your agent the same way as the web chat panel; agent-side
  `ask_user` and `confirm_action` tools push out-of-band prompts (and an
  Approve/Deny button) so the agent can stay in the loop with you while it
  works, even mid agent-to-agent flow.
- **ActionLayer MCP.** The agent can delegate real-world goals through the
  ActionLayer Model Context Protocol server, so tasks that need a third-party
  action (booking, ordering, web automation) get handed off cleanly instead of
  being faked.
- **Vertex AI Gemini** function-calling for the agent loop; Firestore and
  Cloud Storage for persistence; a local JSON store plus mock LLM for the
  zero-credential demo path.

## Switching to the real cloud stack

The defaults in `backend/.env.example` use:

- `STORE_BACKEND=local`, a JSON file on disk (no Firestore needed)
- `LLM_BACKEND=mock`, a scripted demo agent (no Vertex AI needed)

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

Re-run `python -m seed.seed`. The same code path pushes to Firestore and Cloud Storage instead of disk.

## Deploying

Backend to Cloud Run:

```bash
cd backend
gcloud run deploy otter-agent-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars STORE_BACKEND=firestore,LLM_BACKEND=vertex,GCP_PROJECT_ID=$PROJECT,VERTEX_LOCATION=us-central1,GCS_BUCKET=$BUCKET \
  --memory 1Gi --cpu 1 --min-instances 1
```

Frontend to Vercel or Cloud Run:

```bash
cd frontend
# point at the deployed backend
echo "NEXT_PUBLIC_API_URL=https://otter-agent-backend-xxx.run.app" > .env.production.local
npm run build
```

## How it works

1. A user sends a message to their agent (`POST /chat`).
2. The agent loop loads context (notes, calendar, friends), then calls Gemini with a tool catalog.
3. The agent may call `message_friend(friend_id, intent, scope_required)`.
4. That tool enqueues an `agent_inbox` message and recursively dispatches the **receiver's** agent loop in inbox mode.
5. The receiver's loop uses the same tools (scope-filtered) and ends with `reply_to_agent(...)`.
6. Every step writes to the `agent_events` collection. The frontend subscribes and animates.

Scope is checked from the recipient's perspective: Maya can ask Priya for at most what Priya has authorised Maya to see. Section 6 of the design doc walks through the full flow.

## Limitations

Intentionally out of scope for this build: OAuth, real Google Calendar, mobile,
streaming, and group chat across three or more agents. See section 13 of the
design doc.

## Smoke test

```bash
cd backend
.venv/bin/python -m pytest tests/ -v
```

This should print `1 passed`. The test runs the full Maya to Priya study flow in local-store and mock-LLM mode and asserts the agent-to-agent event chain happens.

## Authors

Built by [@xerneas3318](https://github.com/xerneas3318) and [@flappybird1084](https://github.com/flappybird1084).
