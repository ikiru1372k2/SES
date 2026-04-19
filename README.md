# SES — Smart Escalation System

SES is a full-stack web application for auditing effort-planning Excel workbooks, identifying overplanning and missing-planning risks, preparing manager notifications, and tracking escalation progress.

## Table of contents

- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Core workflow](#core-workflow)
- [Run locally](#run-locally)
- [Environment variables](#environment-variables)
- [Build and test](#build-and-test)
- [Database](#database)
- [Architecture overview](#architecture-overview)

---

## Tech stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API | NestJS 10 | REST endpoints, auth, jobs, WebSocket gateway |
| Frontend | React 18 + Vite | SPA client |
| Routing | React Router v7 | Dashboard, workspace, compare, public-response pages |
| State | Zustand | Process, file, audit, version, tracking state |
| Database | PostgreSQL 16 + Prisma 6 | Persistent storage for all server-side entities |
| Cache / pub-sub | Redis 7 | Socket.IO multi-instance adapter |
| Realtime | Socket.IO | Collaborative presence, audit notifications |
| Excel parsing | ExcelJS | Read uploaded workbooks, generate audited downloads |
| Storage | S3-compatible | Workbook file uploads |
| Auth | Cookie-based session (HMAC) | HTTP-only `ses_token` cookie |
| Tests | Node test runner + tsx | Unit tests for domain and API |
| Language | TypeScript | End-to-end type safety |

---

## Project structure

```
apps/
  api/                  NestJS backend
    src/
      auth.*            Login, session verification
      audits.*          Audit run creation and retrieval
      files.*           Workbook upload to S3
      processes.*       Process CRUD
      tracking.*        Issue tracking stage management
      versions.*        Saved audit version management
      issues.*          Issue queries
      exports.*         CSV / HTML report generation
      signed-links/     Manager public-response flow
      realtime/         Socket.IO gateway + presence registry
      common/           Guards, filters, Prisma, request context
      dto/              Zod-validated request/response shapes
    prisma/
      schema.prisma     Database schema
      migrations/       Prisma migration history
      seed.ts           Development seed data
    test/               Unit tests (presence, realtime, token service)

  web/                  Vite + React frontend
    src/
      components/       Shared and feature-level UI components
      pages/            Route-level page components
      store/            Zustand store slices
      lib/              Domain logic (audit engine, workbook parser, etc.)
      realtime/         Socket.IO client hook + types
      api/              Typed API client functions

packages/
  domain/               Shared pure-logic package
    src/                Audit rules, policy, notifications, schedule helpers
    test/               38 unit tests

docs/
  ARCHITECTURE.md
  CONTRIBUTING.md
  LOGGING.md
  PHASE-0-COVERAGE.md
  PHASE-0-INVENTORY.md
```

---

## Core workflow

1. **Create a process** — name, description, audit policy.
2. **Upload a workbook** — Excel file is stored in S3; metadata in PostgreSQL.
3. **Run an audit** — the API applies the audit rules to the workbook rows and stores the result.
4. **Review issues** — browse flagged rows by severity, sheet, and manager.
5. **Prepare notifications** — generate per-manager emails with issue summaries.
6. **Track responses** — signed links let managers submit corrections without an account.
7. **Save a version** — snapshot the current audit result for comparison across cycles.
8. **Compare cycles** — see new, resolved, and changed issues between two versions.

---

## Run locally

### Prerequisites

- Node.js 22 LTS (`node -v`)
- Docker Desktop (for PostgreSQL and Redis)

### 1 — Start infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6380`

### 2 — Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` match the Docker Compose service credentials. Edit `SES_AUTH_SECRET` to any 32-character string for local dev.

### 3 — Install dependencies

```bash
npm install
```

### 4 — Apply migrations and seed

```bash
cd apps/api
npx prisma migrate deploy --schema prisma/schema.prisma
npm run prisma:seed
cd ../..
```

### 5 — Start the API

```bash
npm run dev:api
```

API runs on `http://localhost:3000`.

### 6 — Start the frontend

In a second terminal:

```bash
npm run dev:web
```

Frontend runs on `http://localhost:3210` and proxies `/api` to port 3000.

---

## Environment variables

See [`.env.example`](.env.example) for the full list with comments. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | postgres://ses:ses@127.0.0.1:5432/ses | Prisma connection string |
| `REDIS_URL` | Yes | redis://127.0.0.1:6380 | Redis for Socket.IO adapter |
| `SES_AUTH_SECRET` | Yes in prod | — | Cookie signing secret (≥ 32 chars in production) |
| `SES_CORS_ORIGINS` | No | localhost:3210 | Comma-separated allowed origins |
| `SES_ALLOW_DEV_LOGIN` | No | — | Set to `true` in dev to enable password-free login |
| `SES_COOKIE_SECURE` | No | false | Set to `true` behind HTTPS |

---

## Build and test

```bash
# Type-check all workspaces
npm run typecheck

# Run all unit tests
npm run test --workspace @ses/domain
npm run test --workspace @ses/api

# Build all workspaces
npm run build
```

---

## Database

Prisma manages schema changes. To create a new migration after editing `schema.prisma`:

```bash
cd apps/api
npx prisma migrate dev --name <description> --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
```

---

## Architecture overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed description of the system layers, request flow, and key design decisions.
