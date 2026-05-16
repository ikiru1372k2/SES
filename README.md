# SES — Smart Escalation System

SES is a full-stack TypeScript platform for auditing master-data and
effort-planning Excel workbooks. It flags issues per business function,
assigns each to the right owner via the Manager Directory, notifies them,
and walks an SLA-timed escalation ladder until the issue is resolved.

> **Flow:** upload `.xlsx` → function-specific audit engine runs → issues
> matched to a manager → notifications sent (email / Teams) → escalations
> tracked to resolution with an SLA timer.

---

## Stack

| Layer          | Technology                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| Frontend       | React 18, Vite, React Router 7, Zustand, TanStack Query, Tailwind          |
| Backend        | NestJS 11, hand-written SQL migrations + `pg`, Socket.IO, JWT cookie auth  |
| Shared logic   | `@ses/domain` — framework-free TypeScript workspace package                |
| Database       | PostgreSQL 16 (SQL migrations are the schema authority)                    |
| Object storage | S3-compatible — MinIO locally, AWS S3 in prod (env-only switch)            |
| Realtime       | Redis 7 adapter for Socket.IO                                              |
| AI sidecar     | Python FastAPI/gRPC service wrapping Ollama (`services/ai-sidecar/`)       |
| Workbook I/O   | ExcelJS (XLSX only)                                                        |
| Tests          | node test runner (domain + api), Vitest + RTL (web)                        |

Requires **Node ≥ 20.19** and Docker (for Postgres/Redis/MinIO).

---

## Quick start

```bash
# Brings up Postgres + MinIO + Redis + AI sidecar + API + web,
# applies SQL migrations, seeds reference data, prints all URLs.
./scripts/dev.sh start

./scripts/dev.sh status      # per-service port + health
./scripts/dev.sh logs api    # tail one service (api|web|ai|db|minio|redis|all)
./scripts/dev.sh stop        # clean shutdown
./scripts/dev.sh restart
./scripts/dev.sh reset       # drop local DB + bucket, reapply (typed confirm)
./scripts/dev.sh erase       # destructive local cleanup (typed-phrase confirm)

# Then open http://127.0.0.1:3210
```

First run copies `.env.example` → `.env`. Edit it before exposing the app
anywhere shared (see [Environment](#environment)).

### Service ports

| Service              | URL / Port                         |
| -------------------- | ---------------------------------- |
| Web (Vite)           | http://127.0.0.1:3210              |
| API (NestJS)         | http://127.0.0.1:3211/api/v1       |
| AI sidecar (FastAPI) | http://127.0.0.1:8000 (gRPC :50051) |
| MinIO S3 / console   | http://127.0.0.1:9000 / :9001      |
| PostgreSQL           | `127.0.0.1:5432` (db/user `ses`)   |
| Redis                | `127.0.0.1:6380`                   |

---

## Commands

All commands run from the repo root (npm workspaces).

```bash
npm run dev              # build domain, then run API + web together
npm run dev:api          # API only       npm run dev:web   # web only
npm run build            # build domain → api → web
npm run typecheck        # domain build + api & web typecheck
npm run lint             # web ESLint
npm test                 # domain + api + web unit/component suites
npm run test:components  # web component tests only
npm run format           # prettier --write .

npm run db:migrate       # apply pending SQL migrations
npm run db:seed          # idempotent reference data

# Docker stacks
npm run docker:up | docker:down | docker:logs            # local
npm run docker:prod:up | docker:prod:down | docker:prod:logs
npm run docker:demo:up | docker:demo:down | docker:demo:logs
```

API end-to-end tests (need a running Postgres + MinIO):

```bash
npm run test:e2e --workspace @ses/api
```

---

## Environment

Copy `.env.example` → `.env`; it is documented inline. Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (defaults match `docker-compose.yml`) |
| `REDIS_URL` | Socket.IO adapter |
| `SES_AUTH_SECRET` | Cookie signing; **required & ≥32 chars when `NODE_ENV=production`** |
| `SES_CORS_ORIGINS` | Comma-separated allowed browser origins |
| `SES_COOKIE_SECURE` / `SES_COOKIE_SAMESITE` | Cookie hardening (set `secure=true` behind HTTPS) |
| `SES_ALLOW_DEV_LOGIN` | Demo login — never enable in production |
| `SES_SMTP_URL` / `SES_MAIL_FROM` / `SES_TEAMS_INCOMING_WEBHOOK_URL` | Outbound escalation delivery |
| `AI_SERVICE_URL`, `AI_*_MODEL`, `OLLAMA_NUM_PARALLEL` | AI sidecar / Ollama |
| `OBJECT_STORAGE_*` | S3/MinIO driver, endpoint, per-purpose buckets |

The same object-storage code targets MinIO and AWS S3 — switching is an
env-only change. Provider switch details and the recommended IAM policy
live in **[`docs/object-storage.md`](docs/object-storage.md)** (kept as a
focused operational reference; everything else is in this README).

---

## Repository layout

```
apps/
  api/    @ses/api  — NestJS backend
    src/
      main.ts  app.module.ts  load-env.ts
      common/  db/  realtime/  repositories/   # cross-cutting & infra
      modules/<feature>/                       # one folder per feature,
        <feature>.module.ts + controllers/services/dto
    db/migrations/  *.sql                      # schema authority
    proto/ai_pilot/v1/                         # gRPC wire contract
    test/                                      # e2e + integration specs
  web/    @ses/web  — React + Vite SPA
    src/  components/ pages/ hooks/ store/ realtime/ lib/
packages/
  domain/ @ses/domain — framework-free business logic
    src/  core/ audit/ escalation/ notifications/ reporting/
          workbook/ project/ functions-audit/ ai-pilot/ analytics/
          index.ts                              # stable public barrel
services/
  ai-sidecar/  — Python FastAPI/gRPC sidecar (start-ai.sh / stop-ai.sh)
scripts/  dev.sh (local stack) · dev-free-ports.sh · guard-prod-not-running.sh
deploy.sh · expose.sh · docker-compose{,.prod,.demo}.yml · Dockerfile
```

Per-function audit engines live under
`packages/domain/src/functions-audit/<function>/` and are registered in
`functions-audit/index.ts`. Rule catalogs are strictly partitioned per
function — a domain test fails if a rule code is registered under two
functions.

### Architecture in one paragraph

The React SPA talks to the NestJS API over `/api/v1/*` (and a Socket.IO
channel for realtime). The API authenticates via signed HTTP-only
cookies, authorizes per `ProcessMember`, dispatches uploaded workbooks to
the matching `@ses/domain` audit engine, persists `AuditRun`/`AuditIssue`
rows, resolves owners through the tenant-scoped directory, and creates
`TrackingEntry` rows that the SLA cron escalates on breach. Postgres is
the only datastore; object storage holds uploaded file bytes.

---

## Database & migrations

Hand-written SQL under `apps/api/db/migrations/NNNN_*.sql` is the schema
authority (no ORM-managed history). Each file runs in one transaction
under `pg_advisory_xact_lock`; applied versions are tracked in
`_schema_migrations`.

```bash
npm run db:migrate                                  # apply pending
npm run db:migrate:dryrun  --workspace @ses/api     # preview
npm run db:baseline        --workspace @ses/api     # mark all applied (prod adopt only)
npm run db:seed                                     # idempotent reference data
```

Add a migration as the next sequential `NNNN_short_name.sql` with a
header comment describing intent and a manual rollback recipe.

---

## Deployment

- `deploy.sh local` — pull + rebuild + restart the prod compose stack on
  the host (used by the `cd.yml` GitHub Actions workflow over SSH).
- `docker-compose.prod.yml` — production stack; `docker-compose.demo.yml`
  layers a demo build on top.
- `expose.sh` — publish the running prod stack via a Cloudflare quick
  tunnel (uses the `cloudflare/cloudflared` Docker image).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit + e2e tests,
`npm audit`, and the production build against real Postgres + MinIO.

---

## Maintenance

**2026-05 cleanup (branch `asv/remove-deadcode`):** removed the unused
`legacy-engine`, `notificationTemplates`, and two unused DTO files;
untracked an 18 MB vendored `cloudflared.deb` and runtime `.logs/*.pid`;
pruned stale/redundant docs (completed migration/rework plans, issue
work-notes, stale component READMEs). This README is now the single
source of truth for getting started; `docs/object-storage.md` is the only
retained satellite doc (focused operational IAM reference, linked above).

### Known leftovers / TBD

- `excel_sample_for_audit/` is local sample data (git-ignored via the
  `*.xlsx` rule, not committed) — handy for manual testing, not wired
  into automated tests.
- Six fs/DB-integration specs remain in `apps/api/test/` rather than
  co-located, because of `__dirname`/migration-runner coupling; revisit
  if that coupling is refactored.
- Audit-engine follow-up tasks formerly tracked in `docs/AUDIT_ENGINE_
  REWORK.md` now belong in the issue tracker.
