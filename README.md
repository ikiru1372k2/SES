# SES - Smart Escalation System

SES is a full-stack TypeScript application for auditing effort-planning Excel workbooks, finding planning risks, generating manager notifications, tracking responses, and comparing audit cycles.

## Contents

- [Capabilities](#capabilities)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Architecture](#architecture)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Database And Migrations](#database-and-migrations)
- [Scripts](#scripts)
- [Testing And Quality Gates](#testing-and-quality-gates)
- [Docker Deployment](#docker-deployment)
- [Security And Operations](#security-and-operations)
- [Manual QA Checklist](#manual-qa-checklist)
- [Contributing](#contributing)

## Capabilities

- Process dashboard for recurring audit cycles.
- Function tile workspace for Master Data, Over Planning, Missing Plan, Function Rate, and Internal Cost Rate.
- Excel upload, sheet selection, preview, audit execution, issue review, and workbook download.
- PostgreSQL-backed file persistence, file versions, and file drafts.
- Audit policies, deterministic issue keys, comments, corrections, acknowledgments, and saved versions.
- Per-manager notification drafts, signed response links, send logging, and tracking board.
- Socket.IO realtime events and presence for collaborative workflows.
- CSV/HTML report export and version comparison.
- **Escalation Center** (`/processes/:id/escalations` and `/workspace/:id/escalations` when tiles routing is off): read-only roll-up of open findings per manager, SLA, and deep links back into tiles. Per-tile **Tracking** is hidden unless `VITE_FEATURE_LEGACY_TILE_TRACKING_TAB=true`. Tile **Notifications** no longer exposes Outlook/Teams/send actions (copy and `.eml` export remain).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, React Router 7, Zustand, TanStack Query, Tailwind CSS |
| Backend | NestJS 11, Prisma 6, Socket.IO |
| Shared Logic | `@ses/domain` TypeScript workspace |
| Database | PostgreSQL 16 |
| Realtime Adapter | Redis 7 |
| Workbook Handling | ExcelJS |
| Auth | HTTP-only cookie session signed with `SES_AUTH_SECRET` |
| Tests | Node test runner, tsx, Vitest, Testing Library |

## Repository Layout

```text
apps/
  api/                  NestJS API
    prisma/             Prisma schema, migrations, seed
    src/                Controllers, services, auth, realtime, DTOs, common infrastructure
    test/               API and service tests

  web/                  Vite React app
    src/components/     Shared and feature UI
    src/pages/          Route-level pages
    src/store/          Zustand application state
    src/lib/            Browser helpers and compatibility re-exports from @ses/domain
    src/realtime/       Socket.IO client
    test/               Web and component tests

packages/
  domain/               Shared audit rules, workbook parsing, notifications, schedules, types

docker/                 Postgres init scripts
```

## Architecture

The browser talks to the NestJS API over `/api/v1/*` and to Socket.IO over `/api/v1/realtime`. The API owns persistence, authorization, uploads, audit runs, signed links, activity logs, and exports. Pure business logic lives in `packages/domain` and is imported by both the API and the web app.

Request flow:

```text
Browser -> NestJS controller -> service -> Prisma/Postgres
                         \-> @ses/domain for audit, notification, schedule, and workbook logic
```

Important design rules:

- Keep audit and notification business logic in `packages/domain`.
- Keep browser-only behavior in `apps/web/src/lib`.
- Keep database access inside API services/repositories.
- Do not duplicate workspace implementations per function tile; route every function through the reusable workspace shell.
- Store workbook bytes in PostgreSQL (`Bytes`/BYTEA), not S3.

## Local Development

Prerequisites:

- Node.js 20.19 or newer. Node 22.12+ LTS is recommended.
- Docker Desktop or compatible Docker engine.

Set up the project:

```bash
npm install
cp .env.example .env
docker compose up -d
npm run prisma:generate
npm run prisma:seed
```

Start both API and web:

```bash
npm run dev
```

Or start them separately:

```bash
npm run dev:api
npm run dev:web
```

Local services:

| Service | URL |
| --- | --- |
| Web | `http://127.0.0.1:3210` |
| API | `http://127.0.0.1:3211/api/v1` |
| Postgres | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6380` |

## Environment Variables

Copy `.env.example` to `.env` for local development. Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Prisma PostgreSQL connection string |
| `REDIS_URL` | Redis URL for Socket.IO adapter |
| `SES_AUTH_SECRET` | Cookie signing secret; must be at least 32 chars in production |
| `SES_CORS_ORIGINS` | Comma-separated allowed web origins |
| `SES_BASE_URL` | Public web base URL used for generated links |
| `SES_COOKIE_SECURE` | Set `true` behind HTTPS |
| `SES_COOKIE_SAMESITE` | Cookie SameSite mode: `lax`, `strict`, or `none` |
| `SES_ALLOW_DEV_LOGIN` | Enables dev login only outside production |
| `VITE_FEATURE_TILES_DASHBOARD` | Frontend flag. Any value except `false` uses `/processes/...`; `false` keeps legacy-primary `/workspace/...` URLs |
| `VITE_FEATURE_LEGACY_TILE_TRACKING_TAB` | When `true`, shows the **Tracking** tab inside each function tile workspace. Default (unset) hides it in favor of the Escalation Center |

## Database And Migrations

Prisma schema and migrations live in `apps/api/prisma`.

Apply existing migrations:

```bash
npm exec --workspace @ses/api prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Create a new migration after changing `schema.prisma`:

```bash
cd apps/api
npx prisma migrate dev --name <short-description> --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
cd ../..
```

Migration guidance:

- Prefer expand/contract changes for risky schema work.
- Commit `schema.prisma`, migration SQL, and generated lock changes together.
- Do not rewrite applied migration history unless the deployment owner explicitly approves it.
- Workbook upload memory should be sized around `max workbook size x concurrent uploads`; the default app limit is 25 MiB per workbook.

## Scripts

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build domain, start API and web together |
| `npm run dev:api` | Start NestJS API on port 3211 |
| `npm run dev:web` | Start Vite web app on port 3210 |
| `npm run dev:stop` | Stop local API/web ports |
| `npm run build` | Build domain, API, and web |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Run web ESLint |
| `npm run test` | Run domain, API, and web tests |
| `npm run format` | Format the repository with Prettier |
| `npm run docker:up` | Start local Postgres and Redis |
| `npm run docker:down` | Stop local Postgres and Redis |
| `npm run docker:prod:up` | Start the production-style Docker stack |

## Testing And Quality Gates

Before merging production code, run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Focused commands:

```bash
npm run test --workspace @ses/domain
npm run test --workspace @ses/api
npm run test --workspace @ses/web
npm run test:components --workspace @ses/web
```

Quality expectations:

- No `console.log` in committed frontend code.
- Backend logging should use NestJS `Logger`.
- `console.warn` and `console.error` in the frontend need a recovery path nearby in code.
- Prisma JSON casts should stay isolated and documented at the Prisma boundary.
- Shared domain behavior should have tests in `packages/domain/test`.

## Docker Deployment

Production-style local stack:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Services:

| Service | Address |
| --- | --- |
| Web | `http://localhost:3210` |
| API | Internal Docker host `api:3211` |
| Postgres | Internal Docker host `postgres:5432` |
| Redis | Internal Docker host `redis:6379` |

Useful commands:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

Demo stack with seeded demo login:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up --build -d
```

Production checklist:

- Set `SES_AUTH_SECRET_DOCKER` to a long random value.
- Set `SES_BASE_URL` to the HTTPS hostname.
- Set `SES_COOKIE_SECURE=true` behind HTTPS.
- Restrict `SES_CORS_ORIGINS` to the deployed web origin.
- Confirm migrations complete before opening traffic.

## Security And Operations

Current controls:

- HTTP-only signed session cookie.
- Production startup refuses short `SES_AUTH_SECRET` values.
- Global NestJS auth guard with explicit public-route opt-outs.
- Helmet security headers.
- Origin-restricted CORS with credentials.
- Upload validation for workbook type and size.
- Escaped notification HTML and sanitized email headers.
- Request IDs via `X-Request-ID`.
- Non-root Docker runtime.

Security reporting:

For private deployments, report issues directly to the maintainer with the affected commit, reproduction steps, expected impact, and whether workbook data is involved.

Operational logging:

- Backend: use `Logger` from `@nestjs/common`.
- Frontend: use structured debug events for user-support diagnostics and keep browser console usage intentional.
- Correlate API failures with the `X-Request-ID` response header.

## Manual QA Checklist

Use this checklist before promoting changes that touch routing, uploads, drafts, versions, auth, or realtime:

1. Log in and confirm the dashboard lists accessible processes.
2. Create a process and confirm it opens the function tile page.
3. Open each function tile or a representative subset.
4. Upload a valid workbook and confirm it appears in the sidebar.
5. Refresh the page and confirm the uploaded file persists.
6. Download the original workbook from the UI.
7. Run an audit and confirm results, severity counts, and filters render correctly.
8. Add a comment, correction, and acknowledgment to an issue.
9. Generate notification drafts and verify invalid manager emails block send actions.
10. Save a version and confirm it appears in version history.
11. Compare two versions and confirm new, resolved, and changed issues are correct.
12. Sign out, sign back in, and confirm files and versions hydrate from the server.
13. For collaboration changes, test with a second user and verify process access isolation.

## Contributing

Commit style:

| Prefix | Use For |
| --- | --- |
| `feat:` | User-visible features |
| `fix:` | Bug fixes |
| `refactor:` | Behavior-preserving code changes |
| `test:` | Test-only changes |
| `docs:` | Documentation-only changes |
| `chore:` | Tooling, dependencies, maintenance |

Engineering guidelines:

- Keep changes focused and reviewable.
- Reuse existing components, API helpers, and domain functions before adding new abstractions.
- Add or update tests for behavior changes.
- Commit dependency changes with the matching `package-lock.json`.
- Avoid `--force` and `--legacy-peer-deps`; resolve dependency conflicts explicitly.
