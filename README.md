# SES — Smart Escalation System

> Last updated: 2026-04-27

SES is a full-stack TypeScript platform for auditing master-data and
effort-planning Excel workbooks, flagging issues per business function,
notifying the right owner through the Manager Directory, and walking the
escalation ladder with an SLA timer when owners don't respond.

> Single-line summary: **upload workbook → function-specific audit engine
> runs → issues get assigned to the right manager via the directory →
> notifications and escalations are tracked to resolution.**

---

## Table of contents

- [At a glance](#at-a-glance)
- [Quick start (the one-minute path)](#quick-start-the-one-minute-path)
- [Architecture](#architecture)
  - [System topology](#system-topology)
  - [Request flow](#request-flow)
  - [Audit pipeline end-to-end](#audit-pipeline-end-to-end)
  - [Per-function audit engine](#per-function-audit-engine)
  - [Escalation state machine](#escalation-state-machine)
- [Repository layout](#repository-layout)
- [Key concepts](#key-concepts)
- [Development setup (detailed)](#development-setup-detailed)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Deploy script (`deploy.sh`)](#deploy-script-deploysh)
- [Docker deployment](#docker-deployment)
- [AWS EC2 deployment](#aws-ec2-deployment)
- [Scripts reference](#scripts-reference)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security and operations](#security-and-operations)
- [Contributing](#contributing)

---

## At a glance

| Layer           | Technology                                                                     |
| --------------- | ------------------------------------------------------------------------------ |
| Frontend        | React 18, Vite, React Router 7, Zustand, TanStack Query, Tailwind CSS          |
| Backend         | NestJS 11, Prisma 6, Socket.IO, Helmet, JWT-signed session cookies             |
| Shared logic    | `@ses/domain` — TypeScript workspace package                                   |
| Database        | PostgreSQL 16 (workbook bytes stored as BYTEA, no S3)                          |
| Realtime        | Redis 7 adapter for Socket.IO                                                  |
| Workbook I/O    | ExcelJS (XLSX only; legacy `.xls` rejected)                                    |
| Delivery        | SMTP for email, Microsoft Teams webhook                                        |
| Tests           | Node test runner (API + domain), Vitest + React Testing Library (web)         |

Functions shipping today:

| Function            | Rules status                                            |
| ------------------- | ------------------------------------------------------- |
| Master Data         | ✅ 11 rules (10 required fields + Project Product review) |
| Over Planning       | ✅ 7 rules (effort thresholds, missing/zero effort, etc.) |
| Missing Plan        | ⚪ No rules yet — UI shows an explicit empty state       |
| Function Rate       | ⚪ No rules yet                                          |
| Internal Cost Rate  | ⚪ No rules yet                                          |

Each function's rules live in its own module under
`packages/domain/src/functions-audit/` and are registered against
`AuditRule.functionId` in the DB. **Rules cannot leak across functions** —
a domain test (`rule catalogs are strictly separated per function`)
fails immediately if anyone ever registers a `ruleCode` under two
functions.

---

## Quick start (the one-minute path)

```bash
# One-line local bring-up (Docker + containers + seeded demo data):
./deploy.sh demo

# Open http://127.0.0.1:3210
# Log in with auditor@ses.local / admin@ses.local (demo login enabled)
```

If you don't want Docker and prefer native dev loops:

```bash
npm install                 # workspace install
cp .env.example .env        # edit if needed
docker compose up -d        # just postgres + redis
npm run prisma:generate
npm run prisma:seed
npm run dev                 # api on :3211, web on :3210
```

---

## Architecture

### System topology

```mermaid
flowchart LR
  subgraph Browser
    U[User]
    W[React SPA<br/>Vite]
  end
  subgraph NodeRuntime[Node runtime]
    API["NestJS API<br/>@ses/api"]
    DOM["@ses/domain<br/>engines + rules"]
    API --- DOM
  end
  subgraph Infra
    PG[(PostgreSQL 16<br/>workbook bytes + rows)]
    RD[(Redis 7<br/>Socket.IO adapter)]
    SMTP>SMTP]
    TEAMS>MS Teams webhook]
  end
  U --> W
  W -->|HTTPS / JSON /api/v1/*| API
  W <-->|WebSocket /api/v1/realtime| API
  API --> PG
  API --> RD
  API --> SMTP
  API --> TEAMS
```

- The **React SPA** is served by nginx in production (port 3210) or Vite
  dev server in development. All backend traffic funnels through `/api/v1/*`.
- The **NestJS API** owns auth, upload, audit runs, directory matching,
  notifications, tracking, exports, and realtime events.
- **`@ses/domain`** is the pure business layer: audit engines, rule
  catalogs, escalation state machine, workbook parsing, notification
  composition. It is import-safe from both the API and the SPA.
- **Postgres** is the only store. Workbook bytes live in `FileBlob` as
  `BYTEA` — no S3 coupling.
- **Redis** is the pub/sub fan-out for Socket.IO when the API is scaled
  horizontally.

### Request flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  User->>Web: Click "Run audit"
  Web->>API: POST /api/v1/processes/:id/audit/run
  API->>API: Authenticate (HTTP-only cookie)
  API->>API: Authorize (ProcessMember.permission)
  API->>API: Load WorkbookFile.functionId
  API->>Domain: runFunctionAudit(functionId, file, policy)
  Domain-->>API: AuditResult (issues[], sheets[])
  API->>API: resolveIssueEmailsFromDirectory (tenant-scoped)
  API->>Postgres: INSERT AuditRun + AuditIssue rows
  API->>Realtime: emit audit.completed to process room
  API-->>Web: {runCode, issues, summary}
  Web->>Web: Open Audit Results tab, render findings
```

### Audit pipeline end-to-end

```mermaid
flowchart TB
  A[User uploads .xlsx] --> B[files.service stores Bytes in FileBlob]
  B --> C[Sheets parsed;<br/>valid sheets marked isSelected=true]
  C --> D[User clicks Audit]
  D --> E{runFunctionAudit<br/>dispatch by<br/>file.functionId}

  E -->|master-data| M[masterDataAuditEngine<br/>10 required columns<br/>+ Others review]
  E -->|over-planning| O[overPlanningEngine<br/>effort thresholds<br/>+ state rules]
  E -->|missing-plan| X1[empty — no rules yet]
  E -->|function-rate| X2[empty — no rules yet]
  E -->|internal-cost-rate| X3[empty — no rules yet]

  M --> F["AuditIssue[] with ruleCode + projectManager"]
  O --> F
  F --> G[resolveIssueEmailsFromDirectory<br/>tenant-scoped name match]
  G --> H[Persist AuditRun + AuditIssue + summary]
  H --> I[Realtime: audit.completed]
  H --> J[TrackingEntry created/updated per manager]
  J --> K{Has manager email?}
  K -->|Yes| L[Notify — email / Teams]
  K -->|No| N[UI shows<br/>'Missing email — add to directory']
  L --> P[SlaEngine cron<br/>every 15 min]
  P -->|SLA breached| Q[Auto-escalate L1 → L2]
```

### Per-function audit engine

```mermaid
flowchart LR
  subgraph Domain[packages/domain/src/functions-audit]
    DISP[runFunctionAudit]
    REG[FUNCTION_AUDIT_ENGINES<br/>Record&lt;FunctionId, Engine&gt;]
    DISP --> REG
    REG --> M[master-data/engine.ts]
    REG --> O[legacy-engine.ts → over-planning]
    M --> MR[master-data/rules.ts<br/>MASTER_DATA_RULE_CATALOG]
    M --> MC[master-data/columns.ts<br/>MD_REQUIRED_COLUMNS]
    M --> BV[bad-values.ts<br/>isBadValue, isOthersToken]
    subgraph Catalog[auditRules.ts]
      RCBF[RULE_CATALOG_BY_FUNCTION]
      RCBF --> MD[master-data rules]
      RCBF --> OP[over-planning rules]
      RCBF --> MP[missing-plan: empty]
      RCBF --> FR[function-rate: empty]
      RCBF --> ICR[internal-cost-rate: empty]
    end
    MR -.feeds.-> RCBF
  end
```

Each engine implements:

```ts
interface FunctionAuditEngine {
  functionId: FunctionId;
  run(file: WorkbookFile, policy: unknown, options: FunctionAuditOptions): AuditResult;
}
```

Adding a new function means:

1. Create `packages/domain/src/functions-audit/<name>/{engine,rules,columns}.ts`.
2. Export its `<Name>_RULE_CATALOG` and engine.
3. Register under `RULE_CATALOG_BY_FUNCTION[<name>]` in `auditRules.ts`
   and under `FUNCTION_AUDIT_ENGINES[<name>]` in `functions-audit/index.ts`.
4. Add a migration that `INSERT ... ON CONFLICT DO UPDATE` seeds the new
   rule codes into `AuditRule` with the correct `functionId`.

No other function's code is touched.

### Escalation state machine

```mermaid
stateDiagram-v2
  [*] --> NEW: TrackingEntry created
  NEW --> DRAFTED: user composes
  NEW --> SENT: user sends w/o draft
  DRAFTED --> SENT: send
  SENT --> AWAITING_RESPONSE: delivery confirmed
  AWAITING_RESPONSE --> RESPONDED: manager replies
  AWAITING_RESPONSE --> NO_RESPONSE: SLA cron breach
  AWAITING_RESPONSE --> ESCALATED_L1: bulk re-escalate
  NO_RESPONSE --> ESCALATED_L1: SLA cron / bulk
  ESCALATED_L1 --> ESCALATED_L2: bulk re-escalate
  ESCALATED_L1 --> RESOLVED: issue fixed
  ESCALATED_L2 --> RESOLVED
  RESPONDED --> RESOLVED
  RESOLVED --> [*]
```

The `SlaEngine` service (`apps/api/src/sla-engine.service.ts`) runs every
15 minutes (configurable via `SLA_ENFORCER_INTERVAL_MINUTES`). It queries
`TrackingEntry` rows where `slaDueAt <= now()` and transitions them
according to this diagram.

---

## Repository layout

```text
SES/
├── apps/
│   ├── api/                         NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma        35 models, PostgreSQL
│   │   │   ├── migrations/          Ordered, append-only
│   │   │   └── seed.ts              Users, demo process, rule catalog
│   │   ├── src/
│   │   │   ├── audits.service.ts    Orchestrates runFunctionAudit + directory
│   │   │   ├── directory/           Manager Directory + email resolver
│   │   │   ├── tracking*.ts         Kanban, bulk ops, compose, SLA
│   │   │   ├── escalations*.ts      Ladder aggregator
│   │   │   ├── realtime/            Socket.IO gateway
│   │   │   └── main.ts              Nest bootstrap (port 3211)
│   │   └── test/                    API + e2e tests
│   │
│   └── web/                         Vite + React SPA
│       ├── src/
│       │   ├── pages/               Route-level screens
│       │   ├── components/          Feature + shared UI
│       │   ├── store/useAppStore    Zustand global store
│       │   ├── lib/                 Client API helpers + workers
│       │   │   ├── auditRunner.ts   Browser-side runFunctionAudit wrapper
│       │   │   └── api/             Per-feature fetch clients
│       │   └── main.tsx             SPA entry (port 3210)
│       └── test/                    Vitest + Testing Library
│
├── packages/
│   └── domain/                      Shared business logic
│       ├── src/
│       │   ├── auditRules.ts        RULE_CATALOG_BY_FUNCTION + flat catalog
│       │   ├── functions-audit/
│       │   │   ├── index.ts         Dispatcher + registry
│       │   │   ├── bad-values.ts    isBadValue, isOthersToken, BAD_VALUE_TOKENS
│       │   │   ├── policies.ts      normalizeProcessPolicies (per-function)
│       │   │   ├── master-data/     Engine + rules + columns
│       │   │   └── legacy-engine.ts Adapter for the other 4 functions
│       │   ├── escalationStages.ts  Stage enum + legal transitions
│       │   ├── managerDirectory.ts  Name normalisation + matching
│       │   ├── workbook.ts          XLSX parser + sheet detector
│       │   └── notificationBuilder.ts
│       └── test/                    Node test runner
│
├── docker/
│   └── postgres-init.sql            Enables pg_trgm on first boot
├── docker-compose.yml               Local dev: postgres + redis
├── docker-compose.prod.yml          Prod: + migrate + api + web
├── docker-compose.demo.yml          Overlay: seeds demo users, dev login on
├── Dockerfile                       Multi-stage: api-runtime, web-runtime
├── nginx.conf                       Web container reverse proxy to api:3211
├── deploy.sh                        Local / demo / EC2 deploy helper
├── .env.example                     Template for root `.env`
├── excel_sample_for_audit/          Sample Master Data file.xlsx
└── docs/
    └── AUDIT_ENGINE_REWORK.md       Senior-engineer rework plan
```

---

## Key concepts

**Process.** A recurring audit cycle (e.g., "Q2 2026 planning audit"). Has
members with permissions (owner / editor / viewer).

**Function.** One of five lanes. Every uploaded workbook belongs to
exactly one function — `WorkbookFile.functionId` — and the audit engine
dispatches by that field.

**Audit rule.** A rule code (e.g., `RUL-MD-PROJECT_PRODUCT-MISSING`) with a
severity, description, and `functionId`. Stored in `AuditRule`, owned by
exactly one function (DB-enforced FK to `SystemFunction`).

**Audit issue.** A single finding tied to `(auditRun, row, ruleCode)`.
Carries `projectManager`, `email` (resolved from the directory), and a
deterministic `issueKey` so issues re-collide across runs.

**Manager directory.** `ManagerDirectory` table stores
`(firstName, lastName, email)` with normalized token-sorted keys +
alias list. `matchRawNameToDirectoryEntries` fuzzy-matches any observed
workbook name using `fuzzball`'s `token_sort_ratio`.

**Tracking entry.** One per (process, manager). State machine walks the
escalation stages; `slaDueAt` drives the SLA engine cron.

**Escalation ladder.** NEW → SENT → AWAITING_RESPONSE → NO_RESPONSE →
ESCALATED_L1 → ESCALATED_L2 → RESOLVED. See diagram above.

---

## Development setup (detailed)

### Prerequisites

| Tool             | Version                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| Node.js          | ≥ 20.19 (22 LTS recommended; enforced in root `package.json:engines`)          |
| npm              | ≥ 10 (ships with Node 20)                                                      |
| Docker           | ≥ 24 with Compose v2                                                           |
| PostgreSQL client| Optional — only needed for manual DB inspection                                |

### First-time setup

```bash
# 1. Clone
git clone <your-fork-url> SES && cd SES

# 2. Install workspaces (domain, api, web all in one pass)
npm install

# 3. Environment
cp .env.example .env
# Edit .env if you changed ports / need SMTP / Teams webhook.

# 4. Start Postgres + Redis
docker compose up -d

# 5. Generate Prisma client + apply migrations + seed
npm run prisma:generate
npm exec --workspace @ses/api prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run prisma:seed

# 6. Start both API and web together
npm run dev
```

### Daily dev loop

```bash
npm run dev           # both api (3211) and web (3210) with live reload
npm run dev:api       # api only
npm run dev:web       # web only
npm run dev:stop      # kill any leftover listeners on 3210/3211

npm run typecheck     # whole workspace
npm run test          # whole workspace
npm run lint          # web ESLint
```

### Working on a single workspace

```bash
npm --workspace @ses/domain run build
npm --workspace @ses/api   run test
npm --workspace @ses/web   run test:components
```

---

## Environment variables

Copy `.env.example` → `.env` and fill in as needed. All variables are
read at process start via `apps/api/src/load-env.ts` (the loader walks
up to the repo root so the API finds the same file even when started
from a subdirectory).

### Required

| Variable            | Example                                                 | Notes                                                    |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`      | `postgresql://ses:ses@127.0.0.1:5432/ses`               | Prisma connection                                         |
| `REDIS_URL`         | `redis://127.0.0.1:6380`                                | Socket.IO adapter fan-out                                 |
| `SES_AUTH_SECRET`   | ≥ 32 chars in production                                | Signs session cookies; short values rejected in prod      |

### Optional

| Variable                             | Default                             | Purpose                                                |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| `HOST`                               | `127.0.0.1`                         | API bind address                                       |
| `PORT`                               | `3211`                              | API port                                               |
| `NODE_ENV`                           | unset                               | `production` enforces SES_AUTH_SECRET strength         |
| `SES_CORS_ORIGINS`                   | `http://127.0.0.1:3210,http://localhost:3210` | CSV of allowed browser origins           |
| `SES_BASE_URL`                       | unset                               | Used by the API to build absolute signed links         |
| `SES_COOKIE_SECURE`                  | `false`                             | Set `true` behind HTTPS                                |
| `SES_COOKIE_SAMESITE`                | `lax`                               | `lax` / `strict` / `none` (last requires Secure)       |
| `SES_ALLOW_DEV_LOGIN`                | unset                               | Password-less login for local/demo only                |
| `SES_SMTP_URL`                       | unset                               | Outbound escalation email                              |
| `SES_MAIL_FROM`                      | unset                               | Mail "From" header                                     |
| `SES_TEAMS_INCOMING_WEBHOOK_URL`     | unset                               | Teams escalation channel                               |
| `SLA_ENFORCER_INTERVAL_MINUTES`      | `15`                                | SLA cron cadence                                       |
| `VITE_FEATURE_TILES_DASHBOARD`       | on                                  | Set `false` for legacy `/workspace/…` URLs             |
| `VITE_FEATURE_LEGACY_TILE_TRACKING_TAB` | off                              | Show tracking tab inside each function tile           |

> **Security note.** `SES_ALLOW_DEV_LOGIN` is hard-gated: the endpoint
> refuses to respond when `NODE_ENV=production`.

---

## Database and migrations

Schema: `apps/api/prisma/schema.prisma` (35 models, PostgreSQL provider).

Helpful commands:

```bash
# Apply everything pending
npm exec --workspace @ses/api prisma migrate deploy --schema apps/api/prisma/schema.prisma

# Create a new migration after changing the schema
cd apps/api
npx prisma migrate dev --name <short-description> --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
cd ../..

# Reset local DB (destructive) and re-seed
docker compose down -v
docker compose up -d
npm exec --workspace @ses/api prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run prisma:seed
```

**Rules of engagement**

- Prefer expand/contract for risky schema work.
- Commit `schema.prisma`, the migration SQL, and the generated client as one unit.
- Never rewrite a migration that's been applied anywhere outside your laptop.
- Workbook byte storage: default limit is 25 MiB per file; size the API
  memory budget as `max_workbook_size × concurrent_uploads`.

---

## Continuous deployment (GitHub Actions)

`.github/workflows/cd.yml` fires on every push to `master` and on manual
`workflow_dispatch`. It SSHs to the production host, fetches the merged
commit, and runs `./deploy.sh local` on the server.

Required repository secrets (Settings → Secrets and variables → Actions):

| Name              | Value                                                                         |
|-------------------|-------------------------------------------------------------------------------|
| `DEPLOY_HOST`     | Hostname or IP of the production server.                                      |
| `DEPLOY_USER`     | SSH username (e.g. `ubuntu`).                                                 |
| `DEPLOY_SSH_KEY`  | Full PEM/OpenSSH private key the Action uses to SSH in.                       |
| `DEPLOY_SSH_PORT` | Optional — defaults to `22` when unset.                                       |

Optional repository variables (Settings → Secrets and variables → Variables):

| Name                | Value                                                                   |
|---------------------|-------------------------------------------------------------------------|
| `DEPLOY_DIR`        | Absolute path to the checkout on the remote host. Defaults to `$HOME/ses`. |
| `DEPLOY_PUBLIC_URL` | Used by GitHub's Environment URL badge on the deploy run.               |

The job pins the remote host key with `ssh-keyscan` before the first
connect, uses `BatchMode=yes` to fail fast on auth issues, and shreds the
SSH key at the end of the run. A `concurrency: deploy-production` group
serialises deploys so back-to-back merges don't race each other.

## Deploy script (`deploy.sh`)

`deploy.sh` is the one-stop deploy helper. It supports local docker
bring-up, a demo overlay, and one-command deployment to any SSH-reachable
EC2 host.

```
Usage:
  ./deploy.sh local          Build and run the prod docker stack locally.
  ./deploy.sh demo           Like local, but seeds demo users + enables dev login.
  ./deploy.sh stop           Stop + remove containers (preserves volumes).
  ./deploy.sh prune          Stop + remove containers AND volumes (destructive).
  ./deploy.sh logs           Tail logs of the running stack.
  ./deploy.sh status         Show service status.
  ./deploy.sh ec2 <host>     Deploy to an EC2 host over SSH.
  ./deploy.sh doctor         Check prerequisites (node, docker, compose, ports).
  ./deploy.sh help           Print this help.

Environment variables (for ec2):
  EC2_USER   SSH username (default: ubuntu)
  EC2_KEY    Path to SSH private key (default: ~/.ssh/id_rsa)
  EC2_DIR    Remote install directory (default: /opt/ses)
  SES_AUTH_SECRET_DOCKER   Passed through to the prod stack (≥ 32 chars).
  SES_BASE_URL             Public URL (e.g. https://ses.example.com).
  SES_CORS_ORIGINS         Comma-separated origins allowed by the API.

Examples:
  ./deploy.sh doctor
  ./deploy.sh local
  SES_BASE_URL=https://ses.acme.io ./deploy.sh ec2 54.210.12.34
```

**What `ec2` does**

1. Ensures `docker` and `docker compose` are installed on the host
   (runs the Docker upstream install script if missing).
2. `rsync`s the repo to `$EC2_DIR` on the host, excluding `node_modules`,
   `dist`, `.git`, `coverage`, and the docker volumes.
3. Writes a minimal `.env` on the host from your current env vars.
4. Runs `./deploy.sh local` on the remote — which builds both the
   `api-runtime` and `web-runtime` images and brings up postgres, redis,
   migrate, api, and web services.
5. Prints the public URL and a health-check curl.

**Rollback**

```bash
./deploy.sh ec2 <host>         # re-run with previous commit checked out
./deploy.sh ec2 <host> --prune # destructive reset if state is corrupt
```

---

## Docker deployment

### Local dev (Postgres + Redis only, run API/web on host)

```bash
docker compose up -d        # postgres :5432, redis :6380
npm run dev                 # api + web on the host
```

### Full prod-style stack (everything containerised)

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

| Service  | Where                               |
| -------- | ----------------------------------- |
| Web      | `http://localhost:3210` (nginx)     |
| API      | Internal only: `api:3211`           |
| Postgres | Internal only: `postgres:5432`      |
| Redis    | Internal only: `redis:6379`         |

### Demo overlay (seeded login + dev-login enabled)

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up --build -d
```

### Multi-stage `Dockerfile` targets

| Target            | Contents                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `workspace-build` | Installs deps, runs `prisma generate`, builds all workspaces.    |
| `runtime-deps`    | Prunes dev deps from the workspace build.                        |
| `api-runtime`     | `node:22-slim` + built JS + pruned deps. `EXPOSE 3211`.          |
| `web-runtime`     | `nginx:unprivileged` + built SPA + `nginx.conf`. `EXPOSE 3210`.  |

---

## AWS EC2 deployment

Bare-metal EC2 in ten minutes — no Kubernetes, no ALB, just a box.

### 1. Launch the instance

- **AMI:** Ubuntu 22.04 or 24.04 LTS.
- **Size:** t3.small (2 vCPU / 2 GiB) minimum. t3.medium for >1,000 rows
  per workbook.
- **Storage:** 20 GiB gp3.
- **Security group:** inbound TCP 22 (SSH) and 80/443 (if you terminate
  TLS on the box). Block 3210/3211 from the public — let nginx / your
  reverse proxy expose them.
- **Tag:** `Name=ses-prod` or similar.

### 2. SSH in and prepare

```bash
ssh -i ~/.ssh/id_rsa ubuntu@<host>
sudo apt update && sudo apt -y install rsync
```

### 3. Deploy from your laptop

```bash
# From your SES checkout:
SES_AUTH_SECRET_DOCKER="$(openssl rand -hex 32)"                               \
SES_BASE_URL="https://ses.example.com"                                          \
SES_CORS_ORIGINS="https://ses.example.com"                                      \
./deploy.sh ec2 <host>
```

The script installs Docker if missing, rsyncs the source, writes an
`.env`, and brings up the prod stack. Health check:

```bash
curl -fsS http://<host>:3210/healthz  && echo OK
curl -fsS http://<host>:3210/api/v1/health
```

### 4. Put TLS in front (recommended)

Either:
- Point an AWS ALB at port 3210 with an ACM cert, or
- Add nginx or Caddy on the host that proxies 443 → 3210 and injects
  `X-Forwarded-Proto=https`. Set `SES_COOKIE_SECURE=true` once TLS is
  terminated upstream.

### 5. Log access

```bash
./deploy.sh ec2 <host>                 # redeploy
ssh <host> 'cd /opt/ses && ./deploy.sh logs'
ssh <host> 'cd /opt/ses && ./deploy.sh status'
```

---

## Scripts reference

Root `package.json`:

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `npm run dev`           | Builds `@ses/domain`, starts API + web concurrently             |
| `npm run dev:api`       | Starts NestJS API on port 3211                                  |
| `npm run dev:web`       | Starts Vite on port 3210                                        |
| `npm run dev:stop`      | Frees ports 3210/3211                                           |
| `npm run build`         | Builds domain, api, and web                                     |
| `npm run typecheck`     | `tsc --noEmit` across all workspaces                            |
| `npm run test`          | Domain + API + web tests                                        |
| `npm run lint`          | ESLint on web                                                   |
| `npm run format`        | Prettier across the repo                                        |
| `npm run prisma:generate` | Regenerates the Prisma client                                 |
| `npm run prisma:seed`   | Seeds users + demo process + rule catalog                        |
| `npm run docker:up`     | `docker compose up -d` for local dev                            |
| `npm run docker:down`   | Stops local compose                                             |
| `npm run docker:prod:up`| Prod-style compose stack                                        |

---

## Testing

```bash
# Everything
npm run test

# Per workspace
npm run test --workspace @ses/domain     # Node test runner, pure TS
npm run test --workspace @ses/api        # NestJS unit + e2e
npm run test --workspace @ses/web        # Vitest + React Testing Library
npm run test:components --workspace @ses/web
```

Quality expectations (enforced by review):

- No `console.log` in committed frontend code.
- Backend logging via NestJS `Logger`.
- Prisma JSON casts isolated and commented at the boundary.
- Shared domain behavior has tests under `packages/domain/test/`.
- The invariant **"rules cannot leak across functions"** is covered by
  `packages/domain/test/master-data-audit.test.ts` — do not delete.

---

## Troubleshooting

| Symptom                                                          | What to check                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API refuses to start: "SES_AUTH_SECRET must be ≥ 32 chars"       | Set a longer secret in `.env` (production check).                                                         |
| `prisma: command not found`                                      | Run `npm install` at repo root; Prisma lives in `apps/api`.                                               |
| Audit shows effort-rule findings on a Master Data file           | Rebuild `@ses/domain` (`npm --workspace @ses/domain run build`). The client path must use `runFunctionAudit`. |
| "Missing email — add to directory" chip on every row             | Upload the manager directory first (Directory page), then re-run audit.                                   |
| Bulk send errors with 400 "Manager email is required"            | Fixed in this repo: the composer now skips missing-email entries. Redeploy latest.                        |
| SLA engine never transitions tracking entries                    | Check `sla-engine.service.ts` logs; confirm `SLA_ENFORCER_INTERVAL_MINUTES` isn't set absurdly high.       |
| Web build complains about `@ses/domain/functions-audit`          | Rebuild domain first (`npm --workspace @ses/domain run build`); web consumes `dist/`.                     |
| Docker build takes forever                                       | Pre-pull `node:22-bookworm-slim` and `nginxinc/nginx-unprivileged:1.27-alpine`.                           |
| Port 3210/3211 "already in use"                                  | `npm run dev:stop` or `lsof -iTCP:3210` + `kill`.                                                         |

---

## Security and operations

Controls in place:

- HTTP-only signed session cookie (`SES_AUTH_SECRET`, ≥ 32 chars in prod).
- Global Nest auth guard with explicit `@Public()` opt-outs.
- Helmet security headers; origin-restricted CORS with credentials.
- Upload validation (MIME + size; legacy `.xls` rejected outright).
- Notification HTML escaped; email headers sanitized.
- Request IDs surfaced via `X-Request-ID` on every response.
- Containers run as non-root (`USER node` in `api-runtime`, unprivileged
  nginx in `web-runtime`).

Operational tips:

- Backend logs: NestJS `Logger`. Grep by `X-Request-ID` to follow a
  single request across services.
- Frontend logs: use structured debug events; keep `console.warn`/`error`
  intentional and close to a recovery path.
- Metrics/observability: `/api/v1/health` returns JSON suitable for
  readiness/liveness probes.

---

## Contributing

Commit style:

| Prefix       | Use for                                  |
| ------------ | ---------------------------------------- |
| `feat:`      | User-visible features                    |
| `fix:`       | Bug fixes                                |
| `refactor:`  | Behavior-preserving code changes         |
| `test:`      | Test-only changes                        |
| `docs:`      | Documentation-only changes               |
| `chore:`     | Tooling, dependencies, maintenance       |

Engineering guidelines:

- Keep changes focused and reviewable; tiny PRs beat mega-PRs.
- Reuse existing domain functions and web components before adding new
  abstractions.
- Add or update tests for behaviour changes.
- Commit dependency changes with the matching `package-lock.json`.
- Avoid `--force` and `--legacy-peer-deps`; resolve peer conflicts.
- See `docs/AUDIT_ENGINE_REWORK.md` for the current architectural plan
  and open P1/P2 tasks.
