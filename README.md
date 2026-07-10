# Personal AI Assistant

A self-hosted, fully configurable personal AI assistant with real-time voice
conversation, web access, tool calling, and persistent memory.

- **Frontend**: React + TypeScript (Vite), clean chat UI with streaming
  responses and four selectable voice modes.
- **Backend**: Node.js + TypeScript (Express), JWT auth, OpenAI integration,
  modular permissioned tool system, SQLite/PostgreSQL storage.

---

## Features

- 💬 **Streaming chat** with OpenAI (`gpt-4o-mini` by default — cheap and fast).
- 🎙️ **Four voice modes**, selectable per-user in Settings:
  - **Realtime** – live, low-latency voice conversation over WebRTC
    (OpenAI Realtime API).
  - **Pipeline** – record audio in the browser, transcribed via Whisper,
    replies spoken via OpenAI TTS.
  - **Browser** – Web Speech API for speech-to-text, OpenAI TTS for replies.
  - **Native** – fully on-device speech recognition + synthesis (zero API
    cost, works offline-ish, browser-dependent).
- 🛠️ **Tool calling** with a permissioned, extensible framework:
  - `web_search` – Tavily (if configured) or free DuckDuckGo fallback.
  - `remember` / `recall` / `forget` – long-term per-user key/value memory.
  - `calculator` – safe math evaluation via `mathjs`.
  - `placeholder_api` – template for wiring up your own external API.
- 🧠 **Memory**: short-term (recent conversation history) + long-term
  (persisted facts injected into the system prompt).
- 🕸️ **Orchestration Hub**: register your different LLM accounts (OpenAI,
  Anthropic/Claude, Google/Gemini, or any OpenAI-compatible API) as agents
  and let them talk to each other — the hub relays the conversation
  automatically, no copy-pasting prompts between tabs.
- 🎭 **Fully configurable personality** – edit name, description, and system
  prompt from Settings. Ships with a near-blank-slate default persona.
- 🔒 **Security**: API keys never reach the browser, JWT auth, rate limiting,
  Helmet security headers, structured logging, per-tool permission checks.
- 🗄️ **Storage abstraction**: SQLite by default (zero config, local files),
  or PostgreSQL by setting `DATABASE_URL` (recommended for cloud deploys).

---

## Project structure

```
.
├── backend/                 # Express + TypeScript API server
│   ├── src/
│   │   ├── config/          # env validation, default persona
│   │   ├── db/              # DatabaseAdapter (SQLite + Postgres impls)
│   │   ├── middleware/       # auth, rate limiting, error handling
│   │   ├── routes/           # auth, chat, memory, settings, voice
│   │   ├── services/         # OpenAI client, conversation/streaming, realtime
│   │   ├── tools/             # tool definitions + registry
│   │   └── utils/
│   ├── tests/                # Vitest test suite
│   ├── .env.example
│   └── Dockerfile
├── frontend/                 # React + TypeScript (Vite) chat UI
│   ├── src/
│   │   ├── api/              # typed fetch client
│   │   ├── components/       # Sidebar, ChatWindow, SettingsPanel, etc.
│   │   ├── context/          # Auth + Settings React contexts
│   │   ├── voice/             # 4 voice-mode hooks + realtime WebRTC session
│   │   └── styles/
│   ├── .env.example
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml        # local dev/prod orchestration
└── README.md
```

---

## Prerequisites

- Node.js 20+ and npm
- An [OpenAI API key](https://platform.openai.com/api-keys)
- (Optional) A [Tavily API key](https://tavily.com) for higher-quality web
  search results
- (Optional) Docker + Docker Compose for containerized runs
- (Optional) A PostgreSQL database for production deployments

---

## Running locally (without Docker)

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set OPENAI_API_KEY, JWT_SECRET, APP_USERNAME, APP_PASSWORD
npm install
npm run dev
```

The API server starts on `http://localhost:4000`. On first boot it seeds a
single user from `APP_USERNAME` / `APP_PASSWORD` and creates a local SQLite
database at `SQLITE_PATH` (default `./backend/data/app.db`).

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` requests
to the backend (configurable via `VITE_API_BASE_URL`). Log in with the
`APP_USERNAME` / `APP_PASSWORD` you set in `backend/.env`.

---

## Running with Docker Compose

```bash
# from the repo root
export OPENAI_API_KEY=sk-...
export JWT_SECRET=$(openssl rand -hex 32)
export APP_USERNAME=admin
export APP_PASSWORD=change-me
docker compose up --build
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:8080` (nginx serves the static build and
  proxies `/api` to the backend container)

SQLite data persists in the `backend-data` Docker volume. Override any
variable in `docker-compose.yml` via a `.env` file in the repo root or your
shell environment.

---

## Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full,
documented list. Highlights:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | **Required.** Never exposed to the frontend. |
| `OPENAI_MODEL` | Chat model (default `gpt-4o-mini`). |
| `OPENAI_REALTIME_MODEL` | Model used for live voice sessions. |
| `JWT_SECRET` | Long random string signing auth tokens. |
| `APP_USERNAME` / `APP_PASSWORD` | Seeds the single app user on first boot. |
| `DATABASE_URL` | If set, uses PostgreSQL. Otherwise SQLite (`SQLITE_PATH`). |
| `TAVILY_API_KEY` | Optional, improves `web_search` tool results. |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins. |
| `VITE_API_BASE_URL` (frontend) | Backend URL. Empty = same-origin/proxy. |

---

## Deployment

### Backend (Render / Railway / Fly.io / any Docker host)

1. Provision a PostgreSQL database and copy its connection string into
   `DATABASE_URL` (the app auto-creates its schema on boot). If deploying to
   Render via the included `render.yaml` blueprint, this is already wired up
   for you — skip this step. Render's free web instances have an ephemeral
   filesystem, so leaving `DATABASE_URL` unset and relying on the default
   SQLite path will lose all data on every restart/redeploy.
2. Deploy `backend/` using its `Dockerfile`, or run `npm run build && npm start`
   on a Node 20+ host.
3. Set all required env vars from `backend/.env.example` (especially
   `OPENAI_API_KEY`, `JWT_SECRET`, `APP_USERNAME`, `APP_PASSWORD`,
   `CORS_ORIGIN` pointing at your deployed frontend URL).

### Frontend (Vercel / Netlify / static hosting)

1. Set `VITE_API_BASE_URL` to your deployed backend's URL (build-time env var).
2. Build command: `npm run build`, output directory: `dist/`.
3. Alternatively, deploy `frontend/`'s `Dockerfile` (nginx) anywhere that
   runs containers, passing `VITE_API_BASE_URL` as a build arg.

Because the frontend is a static SPA, the OpenAI API key and all secrets stay
server-side in the backend — the browser only ever talks to your backend
(and, for **Realtime** voice mode, directly to OpenAI using a short-lived
ephemeral token minted by the backend).

---

## Changing the assistant's personality

Open **Settings** in the app (gear icon in the sidebar) and edit:

- **Name** – shown in the UI.
- **Description** – a note to yourself about the persona (not sent to the model).
- **System prompt** – the actual instructions sent to the model on every
  request. This is where you define tone, role, constraints, etc.

Changes are saved per-user in the database and take effect on the next
message. The default persona (`backend/src/config/persona.ts`) is an
intentionally blank-slate assistant.

---

## Orchestration Hub

The hub lets your different LLM accounts collaborate autonomously. Open
**Orchestration Hub** from the sidebar, then:

1. **Add agents** — each agent is one LLM account: a provider, an API key, a
   model, and an optional persona. Supported providers:

   | Provider | Notes |
   | --- | --- |
   | OpenAI | `gpt-4o-mini`, `gpt-4o`, ... |
   | Anthropic (Claude) | `claude-sonnet-4-5`, ... |
   | Google (Gemini) | `gemini-2.5-flash`, ... |
   | OpenAI-compatible | Anything speaking the OpenAI chat-completions API — Grok/xAI, Mistral, Groq, OpenRouter, DeepSeek, local Ollama, ... Requires a base URL (e.g. `https://api.x.ai/v1`). |

   Agent API keys are encrypted at rest (AES-256-GCM, key derived from
   `JWT_SECRET`) and are never sent to the browser. Note: rotating
   `JWT_SECRET` invalidates stored agent keys — re-enter them afterwards.

2. **Create a session** — give the agents a shared goal, pick a mode, the
   number of rounds, and which agents participate:
   - **Discussion** — agents collaborate toward the goal, building on and
     critiquing each other's contributions.
   - **Debate** — agents take positions and challenge each other directly.
   - **Pipeline** — each agent improves the previous agent's draft, assembly-
     line style.

3. **Run** — the backend orchestrates the rounds: every agent sees the full
   speaker-labeled transcript and contributes in turn, live-streamed to the
   UI. Optionally the run ends with a **synthesis** turn that merges the
   whole conversation into one final answer.

4. **Interject & continue** — between runs you can add your own guidance to
   the transcript and press *Continue* for more rounds; agents see your notes
   as `[User]` messages.

Transcripts persist in the database, so sessions can be revisited and
continued any time. If one agent's provider errors mid-round (bad key, rate
limit), the failure is noted in the transcript and the other agents keep
going.

---

## IR Remote (phone IR blaster app)

The repo also ships a standalone, installable web app for controlling TVs and
other appliances with a **headphone-jack IR blaster** plugged into your phone.
It lives at **`/ir/`** on the deployed frontend (e.g.
`https://your-frontend.vercel.app/ir/`) — no login required, and it works
fully offline once loaded (PWA: open it in your phone browser and use
*Add to Home screen* to install it like a native app).

How it works: audio-jack IR blasters are just IR LEDs powered by the
headphone signal. The app renders each IR command as a stereo waveform at
half the carrier frequency with the right channel inverted — the dongle's
two anti-parallel LEDs conduct on alternate half-cycles, reproducing the
full 36–40 kHz carrier — and plays it with the Web Audio API.

Features:

- **Multiple remotes** with a touch-friendly button grid (2–4 columns), all
  stored locally on the device (plus JSON export/import for backup).
- **Brand presets** to start from: Samsung TV, LG TV, Sony TV, Philips
  (RC5), and the standard 24-key LED strip remote.
- **Flipper Zero `.ir` import**: paste or upload a `.ir` file (e.g. from the
  community [Flipper-IRDB](https://github.com/Flipper-XFW/Flipper-IRDB)
  database) and get a ready-made remote — covers projectors, soundbars,
  lights, fans, ACs, and thousands of other devices. Supported protocols
  convert automatically; unsupported records are skipped with a note.
- **Protocols**: NEC, Samsung, Sony SIRC (12/15/20-bit), Philips RC5, raw
  microsecond timings, and Pronto hex — so you can paste codes from any
  public IR database (e.g. LIRC configs, irdb).
- **Edit mode** (✏️) to add/edit/delete buttons and remotes.

For a reliable signal: set media volume to **100%**, turn off Bluetooth
audio and any equalizer/sound effects, and plug the blaster in firmly.
Note this drives *passive audio-jack blasters*; phones with a built-in IR
port (ConsumerIrManager) or proprietary USB-C dongles need their native
apps instead.

---

## Adding a new tool

1. Create a new file in `backend/src/tools/`, e.g. `myTool.ts`, exporting a
   `ToolDefinition`:

   ```ts
   import type { ToolDefinition } from "./types.js";

   export const myTool: ToolDefinition = {
     name: "my_tool",
     description: "Explain what this does and when the model should use it.",
     permission: "external_api", // or "web_access" | "memory" | "compute"
     parameters: {
       type: "object",
       properties: {
         input: { type: "string", description: "..." },
       },
       required: ["input"],
     },
     async execute(args, ctx) {
       // ctx.userId is available for per-user scoping
       return "result string fed back to the model";
     },
   };
   ```

2. Register it in `backend/src/tools/registry.ts` by adding it to the
   `ALL_TOOLS` array.
3. It will automatically appear in **Settings → Tools**, where users can
   enable/disable it. Tools are enabled by default.

---

## Voice modes explained

| Mode | STT | TTS | Cost | Notes |
| --- | --- | --- | --- | --- |
| `realtime` | OpenAI Realtime (WebRTC) | OpenAI Realtime | $$ | Lowest latency, true live conversation, interruptible. Not saved to chat history (v1). |
| `pipeline` | Whisper API | OpenAI TTS API | $ | Record → transcribe → send → speak reply. |
| `browser` | Web Speech API | OpenAI TTS API | $ (TTS only) | Browser STT, server-side TTS. |
| `native` | Web Speech API | `window.speechSynthesis` | Free | Fully on-device, quality varies by browser/OS. |

Switch modes anytime in **Settings → Voice mode**.

---

## Testing

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

Both use [Vitest]. Backend tests cover auth, the database adapters, the tool
registry, and the calculator tool. Frontend tests cover core chat UI
components.

---

## Security notes

- The OpenAI API key and all other secrets live only in the backend's
  environment — never in frontend code or bundles.
- All `/api/*` routes (except `/api/auth/login` and `/api/health`) require a
  valid JWT bearer token.
- General and auth-specific rate limiting is enabled by default
  (`RATE_LIMIT_*` env vars).
- Tools run with per-user, per-permission-scope checks; disabled tools are
  rejected server-side even if the model attempts to call them.
- Helmet sets standard security headers; CORS is restricted to
  `CORS_ORIGIN`.
