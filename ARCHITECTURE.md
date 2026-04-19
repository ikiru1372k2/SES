# Architecture

SES is a full-stack TypeScript monorepo with three npm workspaces: `apps/api`, `apps/web`, and `packages/domain`.

---

## Workspace layout

```
packages/domain   Pure TypeScript — audit rules, policy, notification builder,
                  schedule helpers, workbook parser. No Node.js or browser APIs.
                  Imported by both api and web.

apps/api          NestJS application. Owns the database, file storage, and all
                  server-side business logic.

apps/web          Vite + React SPA. Calls the API over HTTP and receives realtime
                  updates over Socket.IO.
```

---

## Request path (happy path)

```
Browser
  │  HTTPS REST (JSON) or WebSocket (Socket.IO)
  ▼
NestJS API  (apps/api)
  │  AuthGuard verifies the ses_token cookie on every request
  │  RequestContextMiddleware injects x-request-id into AsyncLocalStorage
  ▼
Service layer  (audits.service.ts, processes.service.ts, …)
  │  Calls domain package for pure logic (runAudit, buildNotification, …)
  │  Calls PrismaService for DB reads/writes
  │  Calls FilesService for S3 reads/writes
  ▼
PostgreSQL  (via Prisma 6)   +   S3-compatible object store
```

---

## Key modules

### Authentication (`auth.service.ts`, `auth.guard.ts`)

- Cookie-based sessions: `ses_token` is an HMAC-signed JSON payload (no JWT library).
- `AuthGuard` is applied globally via `APP_GUARD`; routes opt out with `@Public()`.
- Dev-only login path (`SES_ALLOW_DEV_LOGIN=true`) is a hard gate — never active in `NODE_ENV=production`.
- On startup, `AuthService.onModuleInit` validates `SES_AUTH_SECRET` length and throws if the secret is too short for production.

### Audit engine (`packages/domain/src/auditEngine.ts`)

- `runAudit(file, policy, options)` is a pure function: takes a `WorkbookFile` (parsed rows + sheet metadata) and returns `AuditResult`.
- `buildAuditRules(policy)` constructs the active rule set from the policy at call time.
- Rules are composable; multiple rules can fire on the same row and are sorted by severity.
- The API calls `runAudit` in `audits.service.ts`; the web client can also run it in-browser for instant previews.

### Realtime (`realtime/`)

- `RealtimeGateway` is a Socket.IO gateway (`@WebSocketGateway({ path: '/api/v1/realtime' })`).
- `PresenceRegistry` (in-memory) tracks connected members per process with heartbeat-based eviction.
- The Redis adapter (`realtime.redis.ts`) lets multiple API instances share presence state.
- The frontend `useRealtime` hook manages join/leave, heartbeat, and applies incoming envelopes to local state.

### Signed links (`signed-links/`)

- `SignedLinkTokenService` issues HMAC-SHA256 tokens for external manager links (no auth cookie required).
- `PublicResponseController` / `PublicResponseService` handle the unauthenticated response flow: managers view their issues and submit corrections.
- Tokens carry `managerId`, `processId`, `allowedActions`, expiry, and a unique `jti` to prevent replay.

### File uploads (`files.service.ts`)

- Workbook files are stored in S3 (via `@aws-sdk/client-s3`).
- Presigned GET URLs are issued for download; uploads go directly from the browser to S3 via a presigned PUT URL (no API memory pressure).

---

## Database schema (high-level)

```
Workspace  ──< Process ──< WorkbookFile ──< AuditResult ──< AuditIssue
                       ──< AuditVersion
                       ──< IssueAcknowledgment
                       ──< IssueCorrection
                       ──< IssueComment
                       ──< NotificationLog
                       ──< TrackingEntry
                       ──< SignedLink

User  ──< WorkspaceMembership ──> Workspace
```

All entities carry `createdAt`, `updatedAt`, a UUID `id`, and an optional display code (e.g., `PRC-2026-0001`).

---

## Shared types between api and web

`packages/domain/src/types.ts` defines the canonical TypeScript interfaces (`AuditResult`, `AuditIssue`, `AuditPolicy`, `WorkbookFile`, …). Both workspaces import from `@ses/domain` and stay in sync without code duplication.

---

## Security hardening

- `helmet` middleware sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and other security headers on every response.
- CORS is restricted to `SES_CORS_ORIGINS`; credentials (`withCredentials`) are required on the WebSocket handshake.
- `SES_AUTH_SECRET` must be ≥ 32 characters in production; the app refuses to start otherwise.
- All `console.*` use in the frontend follows the rules in [`docs/LOGGING.md`](docs/LOGGING.md).

---

## Logging

See [`docs/LOGGING.md`](docs/LOGGING.md) for the full conventions (NestJS Logger on the backend, structured debug events on the frontend).
