# SES — Smart Escalation System

Upload Excel workbooks → audit engine flags issues per business function → notify the right manager → track escalations to resolution. AI Pilot can generate audit rules from sample data using a local LLM.

---

## How it works — end to end

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SES  —  End-to-End Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐   upload .xlsx    ┌──────────────────────────────────────────┐
  │   User   │ ───────────────►  │              React SPA  :3210            │
  └──────────┘                   │  Dashboard → Workspace → Audit Results   │
        ▲                        └──────────────────┬───────────────────────┘
        │  realtime events                          │  REST /api/v1/*
        │  (Socket.IO)                              │  WS  /api/v1/realtime
        │                                           ▼
        │                        ┌──────────────────────────────────────────┐
        │                        │            NestJS API  :3211             │
        │                        │                                          │
        │                        │  ┌──────────┐  ┌────────────────────┐   │
        │                        │  │  Auth /  │  │   Audit Service    │   │
        │                        │  │  Upload  │  │  + Directory Match │   │
        │                        │  └──────────┘  └────────┬───────────┘   │
        │                        │                         │ runFunctionAudit│
        │                        │  ┌──────────────────────▼───────────┐   │
        │                        │  │       @ses/domain package        │   │
        │                        │  │  • master-data engine (11 rules) │   │
        │                        │  │  • over-planning engine (7 rules)│   │
        │                        │  │  • escalation state machine      │   │
        │                        │  │  • workbook parser (ExcelJS)     │   │
        │                        │  └──────────────────────────────────┘   │
        │                        │                                          │
        │                        │  ┌──────────┐  ┌────────────────────┐   │
        │                        │  │ SLA Cron │  │  Notifications     │   │
        │                        │  │ (15 min) │  │  SMTP / MS Teams   │   │
        │                        │  └──────────┘  └────────────────────┘   │
        │                        └────────┬─────────────────────────────────┘
        │                                 │
        └─────────────────────────────────┤
                                          ▼
                        ┌─────────────────────────────────┐
                        │  PostgreSQL :5432   Redis :6380  │
                        │  (all data)         (WS fan-out) │
                        └─────────────────────────────────┘
```

---

## App screens

```
 Dashboard (tiles view)
 ┌─────────────────────────────────────────────────────────┐
 │  ◈ Master Data    ◈ Over Planning    ◈ Missing Plan     │
 │  ◈ Function Rate  ◈ Internal Cost Rate                  │
 │                                                         │
 │  Each tile = one business function.                     │
 │  Click → opens that function's Workspace.               │
 └─────────────────────────────────────────────────────────┘

 Workspace (per function)
 ┌──────────┬──────────────────────────────────────────────┐
 │  Files   │  Upload Workbook (.xlsx)                     │
 │  Audit   │  Run Audit  →  Audit Results tab             │
 │  Tracking│  Escalation Kanban + SLA timers              │
 │  Versions│  Compare two audit run snapshots             │
 │  Members │  Manage process members + permissions        │
 └──────────┴──────────────────────────────────────────────┘

 Escalation Center
 ┌─────────────────────────────────────────────────────────┐
 │  All active escalations across all functions            │
 │  Bulk select → compose → send email / Teams message     │
 │  SLA breach indicators, stage pills                     │
 └─────────────────────────────────────────────────────────┘
```

---

## Audit pipeline

```
  User uploads .xlsx
        │
        ▼
  Validate (MIME + size, .xls rejected)
        │
        ▼
  Parse sheets with ExcelJS
  → mark isSelected=true for valid sheets
        │
        ▼
  User clicks "Run Audit"
        │
        ▼
  dispatch by WorkbookFile.functionId
  ┌──────────────────────────────────────────┐
  │  master-data  →  masterDataAuditEngine   │
  │  over-planning →  overPlanningEngine     │
  │  (other functions: no rules yet)         │
  └──────────────────────────────────────────┘
        │
        ▼
  AuditIssue[] — each has:
    ruleCode, severity, projectManager, row, sheetName
        │
        ▼
  resolveIssueEmailsFromDirectory
  (fuzzy-match names against ManagerDirectory)
        │
        ▼
  Persist: AuditRun + AuditIssue rows in Postgres
        │
        ├──► Realtime event → web updates instantly
        │
        └──► TrackingEntry created per manager
                │
                ├── manager found  → notify via SMTP / Teams
                └── no email found → UI shows "Add to directory"
```

---

## Escalation state machine

```
  [NEW] ──────────────────────────────────► [SENT]
    │                                          │
    └──► [DRAFTED] ──────────────────────────►─┤
                                               │
                                     [AWAITING_RESPONSE]
                                       │       │       │
                              manager  │       │       │  SLA
                              replies  │       │       │  breach
                                       ▼       │       ▼
                                 [RESPONDED]   │   [NO_RESPONSE]
                                       │       │       │
                                       │    bulk│       │
                                       │ escalate       │
                                       │       ▼       ▼
                                       │  [ESCALATED_L1]
                                       │       │
                                       │       ▼
                                       │  [ESCALATED_L2]
                                       │       │
                                       └──────►┴──► [RESOLVED]

  SlaEngine cron runs every 15 min (SLA_ENFORCER_INTERVAL_MINUTES).
  Channel gate: 2 Outlook sends → 1 Teams send → repeat cycle.
```

---

## AI Pilot — how it works

AI Pilot lets you generate new audit rules from a sample Excel file using a local LLM (Ollama). Rules are tested in a sandbox before being saved to the database.

```
  AI Pilot flow (SandboxModal)
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  Step 1: Upload sample .xlsx                             │
  │     │                                                    │
  │     ▼                                                    │
  │  Step 2: Pick the relevant sheet                         │
  │     │                                                    │
  │     ▼                                                    │
  │  Step 3: Describe what you want to flag                  │
  │     │    "Flag rows where effort > 100 and status=NEW"   │
  │     │                                                    │
  │     ▼                                                    │
  │  Step 4: AI generates rule code (TypeScript)             │
  │     │    FastAPI → Ollama (qwen2.5:7b local LLM)         │
  │     │                                                    │
  │     ▼                                                    │
  │  Step 5: Review generated rule                           │
  │     │                                                    │
  │     ▼                                                    │
  │  Step 6: Preview — run rule against your sample data     │
  │     │    See exactly which rows would be flagged         │
  │     │                                                    │
  │     ▼                                                    │
  │  Save → rule stored in AuditRule table, active on        │
  │  next audit run for that function                        │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  Stack:
    NestJS API ──► FastAPI :8000 ──► Ollama :11434 (local LLM)
                                          └── model: qwen2.5:7b
```

You can also manage existing AI-generated rules from the AI Pilot panel: enable/disable rules, view audit logs, and see what each rule flags.

---

## Architecture

```
  SES/
  ├── apps/
  │   ├── api/                  NestJS 11 backend
  │   │   ├── prisma/
  │   │   │   ├── schema.prisma      35 models, PostgreSQL
  │   │   │   ├── migrations/        Ordered, append-only
  │   │   │   └── seed.ts            Demo users + rule catalog
  │   │   └── src/
  │   │       ├── modules/
  │   │       │   ├── audit/         Audit run orchestration
  │   │       │   ├── process/       Process + file management
  │   │       │   ├── directory/     Manager Directory + resolver
  │   │       │   └── compose/       Notification composition
  │   │       ├── ai-pilot/
  │   │       │   ├── ai-pilot.service.ts        Health + specs
  │   │       │   ├── ai-pilot-rules.service.ts  Rule CRUD
  │   │       │   └── ai-pilot-sandbox.service.ts Sandbox workflow
  │   │       ├── tracking*.ts       Escalation Kanban + SLA
  │   │       ├── sla-engine.service.ts  15-min cron
  │   │       └── realtime/          Socket.IO gateway
  │   │
  │   └── web/                  Vite + React 18 SPA
  │       └── src/
  │           ├── pages/             Route-level screens
  │           ├── components/        Feature UI components
  │           │   ├── workspace/     Workspace tabs + panels
  │           │   ├── escalations/   Composer, EscalationCenter
  │           │   └── ai-pilot/      SandboxModal, rules panel
  │           ├── store/             Zustand slices
  │           └── lib/api/           Per-feature fetch clients
  │
  ├── packages/
  │   └── domain/               Shared TypeScript business logic
  │       └── src/
  │           ├── functions-audit/
  │           │   ├── index.ts            Engine registry + dispatcher
  │           │   ├── master-data/        Engine + 11 rules
  │           │   └── legacy-engine.ts    Over-planning + others
  │           ├── types/                  Shared type definitions
  │           ├── escalationStages.ts     Stage enum + transitions
  │           ├── managerDirectory.ts     Fuzzy name matching
  │           └── workbook.ts             XLSX parser
  │
  ├── docker-compose.yml        Local dev: Postgres + Redis only
  ├── Dockerfile                Developer build (not prod-hardened)
  ├── dev.sh                    One-stop dev helper (see below)
  └── .env.example              All configurable variables
```

---

## Quick start

### Prerequisites

| Tool    | Version        |
|---------|----------------|
| Node.js | ≥ 20.19 (22 LTS recommended) |
| npm     | ≥ 10           |
| Docker  | ≥ 24 + Compose v2 |

### First time setup

```bash
git clone https://github.com/ikiru1372k2/SES.git && cd SES

npm install
cp .env.example .env        # tweak ports/secrets if needed

./dev.sh up                 # starts postgres + redis + migrations + seed + dev servers
```

Open **http://localhost:3210** — log in with the seeded demo accounts.

### With AI Pilot (Ollama)

```bash
# Install Ollama: https://ollama.ai
ollama pull qwen2.5:7b

# Set up FastAPI service in ~/ses-ai-test (see AI Pilot docs)
# Then:
./dev.sh ai                 # same as 'up' but also starts FastAPI at :8000
```

---

## dev.sh reference

```
./dev.sh up          Full bring-up: docker + migrations + seed + dev servers
./dev.sh down        Stop dev servers + docker containers
./dev.sh start       Start dev servers only (docker already running)
./dev.sh stop        Alias for 'down'
./dev.sh reset       Wipe DB volume, re-migrate, re-seed, restart (DESTRUCTIVE)
./dev.sh erase-db    Drop + recreate ses database in Postgres (no volume wipe)
./dev.sh ai          Like 'up' but also starts FastAPI AI Pilot at :8000
./dev.sh status      Show what's running (docker, API, web, AI, Ollama)
./dev.sh logs        Tail docker compose logs
./dev.sh migrate     Run prisma generate + migrate deploy only
./dev.sh seed        Run prisma seed only
./dev.sh install     npm install across workspace
./dev.sh help        Print all commands
```

---

## Environment variables

Copy `.env.example` → `.env`. All variables are optional except `DATABASE_URL`, `REDIS_URL`, and `SES_AUTH_SECRET`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://ses:ses@127.0.0.1:5432/ses` | Prisma connection |
| `REDIS_URL` | `redis://127.0.0.1:6380` | Socket.IO adapter |
| `SES_AUTH_SECRET` | *(set in .env.example)* | Signs session cookies; ≥ 32 chars in prod |
| `SES_ALLOW_DEV_LOGIN` | unset | Password-less login; disabled when `NODE_ENV=production` |
| `SES_SMTP_URL` | unset | Outbound email for escalations |
| `SES_TEAMS_INCOMING_WEBHOOK_URL` | unset | MS Teams escalation channel |
| `AI_SERVICE_URL` | `http://localhost:8000` | FastAPI AI Pilot endpoint |
| `AI_MODEL` | `qwen2.5:7b` | Ollama model to use |
| `SLA_ENFORCER_INTERVAL_MINUTES` | `15` | SLA cron cadence |

---

## Database

Schema: `apps/api/prisma/schema.prisma` (35 models).

```bash
# Create a new migration after editing schema.prisma
cd apps/api
npx prisma migrate dev --name describe-your-change --schema prisma/schema.prisma
cd ../..

# Apply migrations (what dev.sh does automatically)
./dev.sh migrate

# Full reset (wipes everything)
./dev.sh reset

# Erase DB only (no volume wipe, faster)
./dev.sh erase-db
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router 7, Zustand, TanStack Query, Tailwind CSS |
| Backend | NestJS 11, Prisma 6, Socket.IO, JWT-signed session cookies |
| Shared | `@ses/domain` — TypeScript workspace package |
| Database | PostgreSQL 16 |
| Cache / realtime | Redis 7 (Socket.IO adapter) |
| Workbook I/O | ExcelJS (XLSX only) |
| Delivery | SMTP, Microsoft Teams incoming webhook |
| AI | FastAPI + Ollama (local LLM, default: qwen2.5:7b) |
| Tests | Node test runner (API + domain), Vitest + React Testing Library (web) |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Port 3210/3211 already in use | `./dev.sh stop` then `./dev.sh up` |
| Prisma client out of date | `./dev.sh migrate` (regenerates client) |
| Audit shows wrong function rules | Rebuild domain: `npm run build --workspace @ses/domain` |
| "Missing email" on all audit rows | Upload the manager directory first (Directory page) |
| SLA cron not running | Check `SLA_ENFORCER_INTERVAL_MINUTES` in `.env` |
| FastAPI not starting | Check `$AI_DIR/ai-service.log`; confirm Ollama is running |
| `ollama: model not found` | Run `ollama pull qwen2.5:7b` |
| Postgres container unhealthy | `./dev.sh logs` to see container output |
