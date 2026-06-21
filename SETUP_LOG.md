# Data_Vanta Setup Log

This log records every fix/adjustment made while bringing the stack up on a fresh local environment. Each entry: date, what changed, why.

## 2026-04-21 — Initial senior-engineer setup pass

### Preflight
- Node v22.18.0 ✅, Python 3.11.6 ✅, Docker 29.2.1 ✅
- Java / Maven not installed locally — **not required**; datalakehouse builds Java/Maven inside Docker (`api-service/Dockerfile` and `spark/worker-app/Dockerfile`).
- Port 5432 (host Postgres) and 54322–54327 (local Supabase) in use.

### Fix 1 — Frontend `.env` was missing
- **What**: Copied `Front_end/vanta-auth-ui/.env.example` → `.env`.
- **Why**: Next.js needs `NEXT_PUBLIC_*` vars at runtime; no `.env` meant the UI would default to undefined and API calls would break.

### Fix 2 — Datalakehouse Postgres host-port conflict
- **What**: Added `POSTGRES_PORT_HOST=5434` to `back_end/datalakehouse-main/.env`, and changed `docker-compose.yml` Postgres port mapping from `"${POSTGRES_PORT}:5432"` → `"${POSTGRES_PORT_HOST:-5434}:5432"`.
- **Why**: Host port 5432 is occupied by an existing local Postgres. The original compose used `POSTGRES_PORT` for *both* host-side mapping and internal container→container URLs (spark-worker reads `POSTGRES_PORT=${POSTGRES_PORT}`). Changing `POSTGRES_PORT` alone would break internal connections because the Postgres container always listens on 5432 inside its network. Separating the variables keeps internal=5432 and only remaps the externally-exposed port.

### Observation — secrets hygiene already adequate
- Root `.gitignore` already excludes `.env` (line 58).
- `git ls-files | grep '\.env$'` returns nothing — no real `.env` files are tracked. Only `.env.example` files are in git.
- Initial exploration report's claim that secrets were committed was incorrect. No rotation needed from git history.

### Observation — user-auth has its own Postgres
- `back_end/user-auth-main/docker-compose.yml` spins up its own Postgres 15 on host port 5433 with creds matching `DB_STRING` (testuser/testpass/testdb).
- We run that compose independently rather than reusing datalakehouse's iceberg Postgres. Simpler, no coupling.

### Dependency state pre-install
- `Front_end/vanta-auth-ui/node_modules` exists.
- `back_end/user-auth-main/node_modules` exists.
- `back_end/Chart-API-main/venv` exists.
- Ran `npm install` / `pip install -r requirements.txt` — all reported "up to date" / "already satisfied". No additions required.

### Fix 3 — user-auth DB seed
- Ran `npm run seed`. Owner/Admin/Member/Viewer roles + permissions created. Idempotent on subsequent runs (Sequelize `findOrCreate` pattern).

### Known blocker — Datalakehouse Java api-service & Spark worker will not build
- **Symptom**: `docker-compose up -d --build` fails with `TLS handshake timeout` pulling base images (`maven:3.9.4-eclipse-temurin-17`, `eclipse-temurin:17-jre-jammy`) from Docker Hub's Cloudflare R2 blob store (`docker-images-prod.*.r2.cloudflarestorage.com`).
- **Reproduced 3×**: initial build, retry, and bare `docker pull` all hit the same timeout.
- **Not code-fixable** — environmental. Likely causes: local firewall/AV blocking Cloudflare CDN IPs, ISP throttling, or a VPN/proxy misconfiguration in Docker Desktop.
- **Remediation options** (pick one when you get a chance):
  1. Check Docker Desktop → Settings → Proxies; ensure no stale HTTPS proxy is set.
  2. Disable any VPN/firewall temporarily and retry `docker pull eclipse-temurin:17-jre-jammy`.
  3. Switch DNS to 1.1.1.1 or 8.8.8.8 in Docker Desktop's resolver.
  4. Use a mirror registry or pre-pull on another network and `docker save`/`docker load`.
- **Infra still up**: MinIO (9000/9001), RabbitMQ (5672/15672), Redis (6379 internal / 6380 host), Postgres-iceberg (5434 host) are all running and healthy via prebuilt images that were already cached locally or pulled successfully.
- **Impact**: File upload → Spark → Iceberg flow won't run end-to-end until the Java services build. Frontend + Auth + Chart-API + LLM chart suggestion (on pre-existing data) all work.
