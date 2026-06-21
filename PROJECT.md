# Vanta

> **Chat with your data. Get answers, not dashboards.**

Vanta is a chat-driven analytics platform. Connect any source (CSV,
Excel, or one of eight databases), ask in plain English, and the
assistant writes code, runs it, and shows you the insight — visual or
deep-dive, your call.

- **Visual mode** — the agent picks the right chart from 20+ types and
  renders it live (ECharts).
- **Thinking mode** — the agent writes pandas / matplotlib code,
  executes it in an isolated subprocess sandbox, and explains the
  reasoning inline via SSE.
- **13 LLMs** — 5 paid frontier models (Claude 4.7, GPT-5, Gemini 2.5
  Pro, Llama 4 Maverick, Claude Sonnet 4.6) and 8 free models
  (MiniMax M2.5, Nemotron 3, Gemma 4, Arcee Trinity, LiquidAI LFM 2.5,
  plus the OpenRouter free router). Switch per message.
- **Dashboards** — pin any chat-generated chart. Drag-layout grid.
  Share via signed read-only link at `/d/<token>`.
- **Notifications** — in-app bell with SSE live updates.
- **8 connectors** — PostgreSQL, MySQL/MariaDB, SQL Server, Oracle,
  BigQuery, Snowflake, Redshift, MongoDB. AES-256-GCM sealed creds.
- **Teams** — owner/admin/member/viewer RBAC with invites.

---

## Architecture

```
                      ┌─────────────────┐
                      │  Next.js 16     │  localhost:3000
                      │  (Frontend)     │
                      └──────┬──┬───────┘
                             │  │
            auth, chat,      │  │  chat, /data/upload,
            dashboards,      │  │  /execute-code-prompt (SSE),
            notifications,   │  │  /connectors/*
            connectors-crud  │  │
                             ▼  ▼
         ┌──────────────┐  ┌──────────────────┐
         │ user-auth    │  │ Chart-API        │  localhost:8000
         │ (Node/Express)  │ (FastAPI)        │
         │ :5000        │  │                  │
         │              │  │  ┌────────────┐  │
         │              │  │  │ DuckDB     │  │   ./data/warehouse/
         │              │  │  │ engine +   │  │   ./data/catalog.sqlite
         │              │  │  │ Parquet    │  │
         │              │  │  │ warehouse  │  │
         │              │  │  └────────────┘  │
         │              │  │                  │
         │              │  │  ┌────────────┐  │
         │              │  │  │ Thinking-  │  │   subprocess Python
         │              │  │  │ mode agent │  │   sandbox (RLIMIT_*, denylist)
         │              │  │  │ + sandbox  │  │
         │              │  │  └──────┬─────┘  │
         │              │  │         │        │
         │              │  │    OpenRouter    │
         │              │  │    (13 models)   │
         └──────┬───────┘  └──────────────────┘
                │
                ▼
         ┌──────────────┐
         │ Postgres 15  │  localhost:5433
         │ (user-auth)  │
         │ users,       │
         │ sessions,    │
         │ messages,    │
         │ teams,       │
         │ memories,    │
         │ dashboards,  │
         │ notifications,│
         │ connector_   │
         │ credentials  │
         └──────────────┘
```

**What's not here anymore** (retired April 2026 — see
[`back_end/datalakehouse-main/DEPRECATED.md`](back_end/datalakehouse-main/DEPRECATED.md)):
the Spring `api-service`, Spark worker, Iceberg on Postgres, RabbitMQ,
MinIO, Redis. All replaced by the DuckDB engine.

---

## Quick start (one command)

```bash
# One-time
docker-compose -f back_end/user-auth-main/docker-compose.yml pull
npm install
( cd back_end/Chart-API-main && python -m venv venv && ./venv/Scripts/pip install -r requirements.txt )

# Every day
npm run dev
```

`npm run dev` boots the `user-auth-postgres` container, then runs
user-auth (`:5000`), Chart-API (`:8000`), and the Next.js frontend
(`:3000`) in parallel. Cold-start is under 30 seconds on a warm cache.

Open `http://localhost:3000` → sign up (dev auto-verifies) → dashboard.

| Script | What it does |
|---|---|
| `npm run dev` | Full stack |
| `npm run dev:infra` | Just user-auth-postgres |
| `npm run dev:stop` | Stop the postgres container |
| `npm run dev:auth` | user-auth only |
| `npm run dev:chart` | Chart-API only |
| `npm run dev:front` | Frontend only |
| `npm run smoke` | Hits `/health` on every service |

---

## Features

| Area | Status | Files |
|---|---|---|
| Landing (theme-aware, neon hero, viz gallery, pricing) | ✅ | [`app/(public)/page.tsx`](Front_end/vanta-auth-ui/app/(public)/page.tsx), [`components/landing/*`](Front_end/vanta-auth-ui/components/landing) |
| Auth (signup/login/forgot/reset/verify, dev auto-verify) | ✅ | [`app/(auth)/*`](Front_end/vanta-auth-ui/app/(auth)), [`back_end/user-auth-main/src/api/auth`](back_end/user-auth-main/src/api/auth) |
| Files page (upload, list, per-table alias + description) | ✅ | [`app/(dashboard)/dashboard/files/page.tsx`](Front_end/vanta-auth-ui/app/(dashboard)/dashboard/files/page.tsx), [`components/dashboard/TableMetadataDialog.tsx`](Front_end/vanta-auth-ui/components/dashboard/TableMetadataDialog.tsx) |
| Visual chat (ECharts, 20+ chart types) | ✅ | [`app/(dashboard)/dashboard/page.tsx`](Front_end/vanta-auth-ui/app/(dashboard)/dashboard/page.tsx), [`components/charts/ChartRenderer.tsx`](Front_end/vanta-auth-ui/components/charts/ChartRenderer.tsx) |
| Thinking mode (SSE + sandboxed code agent) | ✅ | [`back_end/Chart-API-main/agent/*`](back_end/Chart-API-main/agent), [`components/dashboard/ThinkingStream.tsx`](Front_end/vanta-auth-ui/components/dashboard/ThinkingStream.tsx) |
| Multi-model picker (13 models) | ✅ | [`back_end/Chart-API-main/models.yaml`](back_end/Chart-API-main/models.yaml), [`components/dashboard/ModelPicker.tsx`](Front_end/vanta-auth-ui/components/dashboard/ModelPicker.tsx) |
| Chat history sidebar (rename, delete, URL-based switching) | ✅ | [`components/dashboard/Sidebar.tsx`](Front_end/vanta-auth-ui/components/dashboard/Sidebar.tsx) |
| Per-chat system prompt drawer | ✅ | [`components/dashboard/ChatSettingsDrawer.tsx`](Front_end/vanta-auth-ui/components/dashboard/ChatSettingsDrawer.tsx) |
| Global memory (prepended to every session) | ✅ | [`components/dashboard/MemoryEditor.tsx`](Front_end/vanta-auth-ui/components/dashboard/MemoryEditor.tsx), [`back_end/user-auth-main/src/api/memory`](back_end/user-auth-main/src/api/memory) |
| Dashboards (widgets, drag-grid, share via signed link) | ✅ | [`app/(dashboard)/dashboard/boards/*`](Front_end/vanta-auth-ui/app/(dashboard)/dashboard/boards), [`app/d/[token]/page.tsx`](Front_end/vanta-auth-ui/app/d/[token]/page.tsx) |
| Pin-to-dashboard from chat | ✅ | [`components/dashboard/PinToDashboard.tsx`](Front_end/vanta-auth-ui/components/dashboard/PinToDashboard.tsx) |
| Notifications (SSE + bell UI) | ✅ | [`components/dashboard/NotificationBell.tsx`](Front_end/vanta-auth-ui/components/dashboard/NotificationBell.tsx), [`back_end/user-auth-main/src/api/notification`](back_end/user-auth-main/src/api/notification) |
| Teams + invites | ✅ | [`components/dashboard/TeamsModal.tsx`](Front_end/vanta-auth-ui/components/dashboard/TeamsModal.tsx) |
| **Connectors (8 types, real ingest)** | ✅ | [`app/(dashboard)/dashboard/connectors/page.tsx`](Front_end/vanta-auth-ui/app/(dashboard)/dashboard/connectors/page.tsx), [`back_end/Chart-API-main/engine/connectors.py`](back_end/Chart-API-main/engine/connectors.py) |
| Multi-source chat attachments (files + connector tables in one session) | ✅ | [`back_end/user-auth-main/src/api/chat/chatSessionAttachment.model.js`](back_end/user-auth-main/src/api/chat/chatSessionAttachment.model.js), [`Front_end/vanta-auth-ui/contexts/AttachmentsContext.tsx`](Front_end/vanta-auth-ui/contexts/AttachmentsContext.tsx) |
| Thinking-mode persistence (events + result + chart paths restored on reload) | ✅ | [`back_end/Chart-API-main/agent/code_agent.py`](back_end/Chart-API-main/agent/code_agent.py), [`components/dashboard/ThinkingStream.tsx`](Front_end/vanta-auth-ui/components/dashboard/ThinkingStream.tsx) |
| Dashboard drag-resize (`react-grid-layout`) + add-widget menu | ✅ | [`app/(dashboard)/dashboard/boards/[id]/page.tsx`](Front_end/vanta-auth-ui/app/(dashboard)/dashboard/boards/[id]/page.tsx), [`components/dashboard/AddWidgetMenu.tsx`](Front_end/vanta-auth-ui/components/dashboard/AddWidgetMenu.tsx) |
| Custom widget type registry (chart / markdown / iframe / big-number) | ✅ | [`components/dashboard/widgets/`](Front_end/vanta-auth-ui/components/dashboard/widgets) |
| Bulk-delete chats (`DELETE /chat/sessions`) | ✅ | [`back_end/user-auth-main/src/api/chat/chat.controller.js`](back_end/user-auth-main/src/api/chat/chat.controller.js), [`components/dashboard/Sidebar.tsx`](Front_end/vanta-auth-ui/components/dashboard/Sidebar.tsx) |
| Per-chart Download PNG + CSV; thinking-mode artifact downloads | ✅ | [`components/charts/ChartRenderer.tsx`](Front_end/vanta-auth-ui/components/charts/ChartRenderer.tsx), [`components/dashboard/ThinkingStream.tsx`](Front_end/vanta-auth-ui/components/dashboard/ThinkingStream.tsx) |
| ECharts LTTB sampling + dataZoom for series >2000 points | ✅ | [`components/charts/ChartRenderer.tsx`](Front_end/vanta-auth-ui/components/charts/ChartRenderer.tsx) |
| Markdown rendering (react-markdown + remark-gfm) | ✅ | [`components/ui/Markdown.tsx`](Front_end/vanta-auth-ui/components/ui/Markdown.tsx) |
| Server-side row cap on `/data/query` (env-tunable, with `download=true` escape) | ✅ | [`back_end/Chart-API-main/main.py`](back_end/Chart-API-main/main.py) |

---

## Connectors

All credentials are AES-256-GCM sealed with `CRED_ENCRYPTION_KEY` in
user-auth. Only non-secret metadata (id, type, name, test status) is
ever returned from the API. Credentials never round-trip through the
browser: the UI posts `{type, name, config}` once, user-auth encrypts
and stores, subsequent test/ingest calls decrypt server-side and
forward to Chart-API.

| Type | Driver | Ingest strategy | Status |
|---|---|---|---|
| PostgreSQL | `psycopg2` + `pandas.read_sql` → Parquet | `SELECT * FROM "schema"."table"` per picked table | Ready |
| MySQL / MariaDB | `PyMySQL` + `pandas.read_sql` → Parquet | `SELECT * FROM \`table\`` | Ready |
| SQLite | stdlib `sqlite3` | `SELECT * FROM "table"` | Ready |
| Redshift | `psycopg2` (Postgres wire) | Same as Postgres | Wired, untested |
| MS SQL Server | `pyodbc` + `pandas.read_sql` | Requires `msodbcsql18` on host | Wired, untested |
| Oracle | `oracledb` (thin mode) | `SELECT * FROM "schema"."table"` | Wired, untested |
| MongoDB | `pymongo` + `pd.json_normalize` | Collections → tables, flattened once | Ready |
| BigQuery | `google-cloud-bigquery` + service-account JSON | `SELECT * FROM \`project.ds.table\`` → `to_dataframe()` | Wired, untested (needs creds) |
| Snowflake | `snowflake-connector-python` | `fetch_pandas_all()` | Wired, untested (needs creds) |

"Wired, untested" = code path is complete and the test/list/ingest
endpoints are live, but I haven't run it against a real remote account.
First user to try gets to shake out any driver quirks.

### Pretty brand icons

- Simple Icons (via `react-icons/si`) for Postgres, MySQL, MongoDB,
  Snowflake, BigQuery.
- Tabler (via `react-icons/tb`) tinted with brand colors for Oracle,
  Redshift, MSSQL (Simple Icons doesn't ship authentic marks for these).
- See [`ConnectorIcons.tsx`](Front_end/vanta-auth-ui/components/dashboard/ConnectorIcons.tsx).

---

## Thinking mode

```
User: "why are Q3 sales dropping in the northeast?"
     │
     ▼
FastAPI /execute-code-prompt (SSE)
     │
     ├─ fetches rows + schema via DuckDB engine (user-scoped)
     │
     ├─ LLM call #1 with tools [run_python, final_answer]
     │    ↓
     │  thought → "let me group by region & month"
     │  run_python: df.groupby(["region","month"])["revenue"].sum()
     │    ↓
     │  spawn subprocess (20s CPU, 2GB RAM on Unix; timeout-only on Windows)
     │    – AST-level import denylist (no socket/requests/subprocess/ctypes)
     │    – HTTP proxy env nullified
     │    – stdin: DataFrame loaded from Parquet via VANTA_DATA_PATH
     │    – any matplotlib fig auto-saved as PNG
     │    ↓
     │  stdout + chart PNG → SSE event
     │
     ├─ LLM call #2 sees the stdout, may run another snippet, …
     │
     └─ final_answer(markdown) → SSE 'result' event → 'done'
```

SSE event types: `ready` · `thought` · `code` · `stdout` · `stderr` ·
`chart` · `result` · `error` · `done`.

---

## Dashboards + sharing

Widget types today: `chart`, `markdown`, `big-number`.

Every chart in chat has a **Pin** button. It opens a modal; pick an
existing board or type a new name; a `DashboardWidget` is inserted with
the full chart spec preserved in `config.chartSpec`.

Flip a dashboard's visibility to `public-link` and a 32-char hex
`share_token` is issued. `/d/<token>` is whitelisted by middleware and
renders a read-only, brand-stripped version.

---

## Notifications

Table: `notifications (id, user_id, type, title, body, data, read_at,
created_at)`. Event sources today are manual; producers for
`upload.completed`, `connector.ingest`, `team.invite` are scaffolded
but not auto-firing yet (see Roadmap).

Transport: `GET /notifications/stream` — SSE, server polls every 10
seconds and emits rows created since the last check. Fallback polling
is not needed in practice; browsers hold the connection open.

Bell UI ([NotificationBell.tsx](Front_end/vanta-auth-ui/components/dashboard/NotificationBell.tsx))
subscribes once on mount; badge count stays live.

---

## Ports & env vars

### Services

| Service | Port | Notes |
|---|---|---|
| Frontend (Next.js) | 3000 | `npm run dev:front` |
| user-auth (Node) | 5000 | `npm run dev:auth` |
| Chart-API (FastAPI) | 8000 | `npm run dev:chart` |
| user-auth-postgres | 5433 | docker-compose, credentials `testuser/testpass/testdb` |

### Required env

**`back_end/user-auth-main/.env`**

```
PORT=5000
DB_STRING=postgres://testuser:testpass@localhost:5433/testdb
JWT_SECRET=<random 32+ bytes>
AUTO_VERIFY_USERS=true            # dev only; refuses production boot
CRED_ENCRYPTION_KEY=<32 bytes hex, e.g. openssl rand -hex 32>
DATA_ENGINE_URL=http://localhost:8000/api/v1
EMAIL_USER=you@example.com         # optional (verification emails)
APP_PASS=gmail-app-password        # optional
```

**`back_end/Chart-API-main/.env`**

```
OPENROUTER_API_KEY=<required>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6  # default
USER_AUTH_BASE_URL=http://localhost:5000/api/v1
DUCKDB_WAREHOUSE_PATH=./data       # optional, default is ./data
```

**`Front_end/vanta-auth-ui/.env`**

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_LAKEHOUSE_URL=http://localhost:8000/api/v1  # historical name
NEXT_PUBLIC_DATA_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_CHART_API_URL=http://127.0.0.1:8000
CHART_API_URL=http://localhost:8000
CHAT_API_URL=http://localhost:5000/api/v1
```

---

## API reference

### user-auth (`/api/v1`)

- **Auth** — `POST /auth/signup`, `POST /auth/signin`, `GET /auth/me`,
  `GET /auth/verify-email`, `POST /auth/resend-verification`,
  `POST /auth/forget-password`, `POST /auth/change-password`.
- **Profile** — `GET/PUT /profile/*`, `GET/POST/DELETE /profile/memories`.
- **Files** — `POST /file/upload`, `GET /file/`, `GET /file/:id`,
  `DELETE /file/:id`.
- **Chat** — `POST /chat`, `POST /chat/sessions`, `GET /chat/sessions`,
  `GET /chat/sessions/:id`, `PUT /chat/sessions/:id`,
  `PATCH /chat/sessions/:id/settings`, `DELETE /chat/sessions/:id`,
  `GET /chat/preview/:fileId`, `GET /chat/preview/lakehouse/:jobId`.
- **Teams** — `POST /team`, `GET /team`, `GET /team/:id`,
  `PUT /team/:id`, `DELETE /team/:id`, plus members sub-resource.
- **Tables** — `GET/PUT /tables/:projectId/:tableName/metadata`.
- **Dashboards** — `GET/POST /dashboards`, `GET/PATCH/DELETE
  /dashboards/:id`, widgets sub-resource,
  `GET /dashboards/public/:token` (unauthenticated).
- **Notifications** — `GET /notifications`, `GET /notifications/stream`
  (SSE), `POST /notifications/:id/read`, `POST /notifications/read-all`,
  `DELETE /notifications/:id`.
- **Connectors** — `GET/POST /connectors`, `GET/PATCH/DELETE
  /connectors/:id`, `POST /connectors/:id/test`,
  `POST /connectors/:id/tables`, `POST /connectors/:id/ingest`.

### Chart-API (`http://localhost:8000`)

- **Health & models** — `GET /health`, `GET /models`.
- **Data engine** — `POST /data/upload`, `POST /data/query`,
  `GET /data/tables/:projectId`,
  `GET /data/schema/:projectId/:tableName`,
  `DELETE /data/tables/:projectId/:tableName`.
- **Compat shim (deprecated)** — `POST /api/v1/upload`,
  `POST /api/v1/query`, `GET /api/v1/query/:jobId`,
  `GET /api/v1/schema/:projectId/:tableName`,
  `GET /api/v1/jobs/:jobId`.
- **Connectors (server-to-server)** — `POST /connectors/test`,
  `POST /connectors/list-tables`, `POST /connectors/ingest`,
  `GET /connectors/types`.
- **Chart suggestion** — `POST /suggest-charts`, `POST /build-queries`,
  `POST /execute-prompt`.
- **Thinking mode** — `POST /execute-code-prompt` (SSE).

---

## Security notes

- `CRED_ENCRYPTION_KEY` must decode to 32 bytes or user-auth refuses
  to encrypt. Hex (64 chars), base64 (44 chars), or raw utf-8 (32
  chars) all work.
- `AUTO_VERIFY_USERS=true` forbids boot when `NODE_ENV=production`.
- Chart-API verifies every `x-auth-token` with user-auth `/auth/me`
  (with a 30s cache) before any data operation.
- Sandbox: AST-level import denylist covers `socket`, `urllib`, `http`,
  `requests`, `httpx`, `aiohttp`, `ctypes`, `subprocess`,
  `multiprocessing`. `HTTP_PROXY`/`HTTPS_PROXY` are nullified.
- Parquet paths are user-scoped by regex-sanitised `user_id`,
  `project_id`, `table_name` at the storage layer
  ([`storage.py`](back_end/Chart-API-main/engine/storage.py)).

---

## Roadmap / deferred

- **Drag-resize widget layout** — backend accepts `gridX/Y/W/H`
  already; UI renders but doesn't drag.
- **Automatic notification producers** — schema + stream are live;
  need to call `Notification.create(...)` from the upload completion
  and connector ingest paths.
- **Team-scoped data** — dashboards support `team_id` already;
  per-connector sharing not wired.
- **Scheduled dashboard refresh** — flagged out of scope.
- **Large-file streaming upload** — today we buffer to tempfile and
  read with pandas. >1 GB uploads would want a streaming reader.
- **Row-level security / column masking**.
- **SSO / SAML, billing** — not planned.

---

## Q2 2026 changes

The Q2 overhaul focused on making chat sessions feel like first-class
analytical workspaces (multi-source, persistent, downloadable) and on
turning dashboards into something you can actually shape from the UI.

### Multi-source chat attachments

A chat session can now hold a mix of uploaded files and connector
tables simultaneously. Backed by a new join table:

```
chat_session_attachments (
  session_id, source_type, source_id, alias, position
)
```

- `POST /chat/sessions/:id/attachments`, `GET …/attachments`,
  `DELETE …/attachments/:attachmentId` (all controller-validated).
- Frontend hydrates and persists via `AttachmentsContext`; the
  current dataset and per-session attachments survive page reload via
  `localStorage`.
- Connector tables use `local:` -prefixed attachment ids so the
  persistence path can round-trip them.
- Chart-API receives the attachments + per-table aliases on every
  prompt and threads them into the system prompt (including the
  fallback path).

### Thinking-mode persistence

SSE events, the final result, and any generated chart paths are now
written into `chat_messages.metadata.thinking`. Run artifacts (the
generated `.py`, the rendered `.md`, and chart `.png`s) live under
`data/runs/{user_id}/{run_id}/` and are served by a new
`GET /runs/{user_id}/{run_id}/{file}` route. On session reload the
`ThinkingStream` component rehydrates from `metadata.thinking` so the
full transcript and chart are visible again.

A reactive UI bug along the way: the previous `onDone` callback's
identity changed on every render, causing a duplicate request. Fixed
by stabilising it via `useCallback` and using an accumulator pattern
for streamed chunks (`fix(thinking): stabilise onDone identity to
prevent double-request`).

### Bulk-delete chats

`DELETE /chat/sessions` cascades through messages and attachments for
the calling user. Sidebar exposes a confirmation-gated "Delete all
chats" action.

### Dashboards: drag-resize + widget registry

- `react-grid-layout` drives drag and resize; the backend was already
  storing `gridX/Y/W/H`, so this was purely a renderer swap.
- An add-widget menu lives inside the dashboard itself (chart /
  markdown / big-number).
- `components/dashboard/widgets/*` is a small registry that pairs a
  widget `type` with a renderer. Markdown widgets now render through
  the shared Markdown component (no more `<pre>`-text fallback). An
  iframe widget is registered but not yet creatable from the UI menu.

### Server-side guardrails + chart UX

- `/data/query` caps results at 50,000 rows by default
  (`CHART_API_MAX_ROWS`). Pass `download=true` to bypass and stream
  the full file.
- ECharts large-series mode + LTTB sampling + dataZoom kicks in past
  2,000 points so the browser stays responsive on long time series.
- A `ResizeObserver` drives chart resizing instead of window-level
  listeners; charts now follow their container in the grid.
- Per-chart **Download PNG** and **Download CSV** buttons.
- Thinking-mode artifact downloads (.py / .md / .png).

### Markdown everywhere it should be

A shared `components/ui/Markdown.tsx` (react-markdown + remark-gfm,
with consistent heading / table / blockquote styling) is now used by
both the thinking-mode `result`/`error` events and the dashboard
markdown widgets.

### Files page + uploads

- The Files page now reads real data from user-auth + Chart-API
  (previously it was reading an empty `localStorage.datasets`).
- Robust to network errors: `Promise.allSettled` + a `__failed` tag
  surfaces a soft-error banner instead of a blank page.
- Upload cap raised from 10 MB to 100 MB.

### Connector → chat integration

- Post-ingest "Open in chat" CTA appears beside each freshly ingested
  table.
- Per-card "Chat" dropdown lets you pick a previously-ingested table
  and start a chat scoped to it.
- Chart-API alias plumbing wires connector aliases into the prompt the
  same way file aliases are.
- Same-type fallback tightened so we never accidentally route a
  connector table through a different connector's adapter.

### Header + dataset selector

- Real dropdown listing files + connector tables.
- Dropped redundant `onDatasetChange` calls that were re-triggering
  state updates on every selection.
- Guard against wiping `chartSpecs` during a session-restore render
  pass.

---

## Deferred / follow-ups

- **B9 — strip base64 from persisted thinking events.** Blocked by an
  architectural URL/auth issue with the `/runs/...` route (the browser
  needs a same-origin authenticated path to load run artifacts).
  Stashed; revisit once a Next.js proxy route lands.
- **AddWidgetMenu is hardcoded to chart / markdown / big-number.** The
  iframe widget is in the registry but not reachable from the UI; a
  small follow-up is to make the menu registry-driven so any
  registered widget type can be added.
- **Concurrent thinking-mode runs may race on session creation** (B7
  reviewer note). First-run-wins is acceptable today; a single-flight
  guard is the proper fix.
- **Cross-tab divergence** in `currentDataset` and `chatAttachments`:
  there is no `storage` event listener, so two tabs can drift after a
  reload. Add a listener to keep them synced.
- **Chart-picker (F3)** sequentially fetches sessions and at the
  50-session cap can take 7-15 s; parallelise when convenient.

---

## Rollback

The pre-DuckDB Spring+Spark stack is preserved under
[`back_end/datalakehouse-main/`](back_end/datalakehouse-main) with a
[`DEPRECATED.md`](back_end/datalakehouse-main/DEPRECATED.md).
Git tag `lakehouse-era` points at the last commit before the refactor.
If ever needed:

```bash
git checkout lakehouse-era
cd back_end/datalakehouse-main && docker-compose up -d --build
# flip NEXT_PUBLIC_LAKEHOUSE_URL back to http://localhost:8888/api/v1
```

---

## Contributing

- `npm run smoke` must pass before opening a PR.
- `tsc --noEmit` and `eslint` must be clean.
- Commits use the existing footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
