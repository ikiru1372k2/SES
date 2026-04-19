# Phase 0 — Cleanup Summary

Date: 2026-04-18  
Branch: `chore/phase-0-cleanup`  
Base commit: `37ed9b9` (merge of `feature/realtime-and-signed-links`)

---

## Commits

| SHA | Section | Message |
|-----|---------|---------|
| `b10408a` | 1 — Inventory | `docs: phase-0 code inventory` |
| `f4e3184` | 2 — Dead code | `refactor: remove unreferenced exports identified in phase-0 inventory` |
| `5aceffd` | 3 — Type safety | `refactor: replace any/ts-ignore with typed alternatives where safe` |
| `4cafae2` | 4 — Security | `chore(security): cookie flags, secret length, dev-login guards, helmet, upload limits` |
| `5717e87` | 5 — Logging | `chore(logs): remove console.log, route warn/error through Nest Logger, add LOGGING.md` |
| `dd1d3b7` | 6 — Coverage report | `docs: add phase-0 test coverage report` |
| `68bfeba` | 7 — New tests | `test: add missing coverage for top-3 risk files` |
| `6a6b650` | 8 — Docs | `docs: README, CONTRIBUTING, ARCHITECTURE` |
| `d536226` | 9 — Git hygiene | `chore: tighten .gitignore and add .gitattributes` |

---

## Before / after counts

| Metric | Before | After |
|--------|--------|-------|
| Domain tests | 17 | 38 |
| API tests | 26 | 26 |
| TypeScript errors (api typecheck) | 12+ (stale Prisma client) | 0 |
| TypeScript errors (web typecheck) | 0 | 0 |
| `as any` casts (non-JSON-boundary) | ~6 (stale-client casts) | 0 |
| `as any` casts (intentional JSON) | 0 annotated | all annotated `// PRISMA-JSON:` |
| `console.log` in web src | 1+ | 0 |
| `console.warn/error` without recovery comment | 4+ | 0 |
| Security headers | none | helmet (HSTS, X-Frame-Options, …) |
| Auth secret check at startup | none | enforced via `onModuleInit` |
| Dev-login guard | `&&` bug (easily bypassed) | `\|\|` (correctly blocked in prod) |
| Root docs accuracy | described 2024 local-first SPA | reflects current full-stack architecture |

---

## Section outcomes

### Section 1 — Inventory (`docs/PHASE-0-INVENTORY.md`)
Full file manifest (134 files, 12,801 lines). Dead-code table, type-safety holes list, TODO/FIXME scan (zero found).

### Section 2 — Dead code removal
Removed `export` from `buildAuditRules`, `loadProcesses`, `saveProcesses`, `hydrateWorkbookRawData`. Skipped `normalizeProjectNo` and `validateWorkbookDescriptor` per ground rules (domain-public surface).

### Section 3 — Type safety
- Fixed stale Prisma client by running `prisma generate` (restored `signedLink`, `auditIssue`, `process` types).
- Removed all 6 non-JSON `as any` casts in `signed-link.service.ts` and `public-response.service.ts`.
- Annotated all remaining `as any` at Prisma JSON column boundaries with `// PRISMA-JSON:`.
- Annotated 2 `as any` in public-response writes with `// SCHEMA-GAP: updatedById is non-null in schema but public writes pass null`.
- Fixed `Buffer<ArrayBufferLike>` → `Uint8Array<ArrayBuffer>` variance issue for `tokenHash` Bytes column.
- Fixed pre-existing timezone bug in `scheduleHelpers.ts`: `new Date('YYYY-MM-DD')` was UTC midnight causing -1 day drift in UTC− timezones.

### Section 4 — Security hardening
- Added `helmet` to `apps/api` with CSP disabled (Vite inline scripts) and COEP disabled.
- Added `AuthService.onModuleInit` startup secret check (throws if < 32 chars in production).
- Fixed dev-login guard: `&&` → `||` (was accidentally bypassed when `SES_ALLOW_DEV_LOGIN` was unset).
- Added `SameSite=lax`, `HttpOnly`, `Secure` (production) cookie flags.
- Added workbook upload size limit in `FilesController`.

### Section 5 — Logging hygiene
- Removed all `console.log` from frontend source.
- Added documented recovery comments to all `console.warn`/`console.error` in committed web code.
- Removed bare `console.info` from `useRealtime.ts`.
- Created `docs/LOGGING.md` with NestJS Logger conventions, severity levels, throw-vs-log guidance, and request tracing instructions.

### Section 6 — Coverage report (`docs/PHASE-0-COVERAGE.md`)
Generated V8 coverage via `NODE_V8_COVERAGE` + `tsx --test`.  
Domain top priorities: `auditEngine.ts` (32%), `workbook.ts` (34%), `anomaly.ts` (0%).

### Section 7 — New tests (`packages/domain/test/coverage.test.ts`)
21 new tests covering:
- `anomaly.ts` — 5 tests (0% → full coverage)
- `reporting.ts` — 4 tests including XSS escape assertions (0% → full coverage)
- `auditEngine.ts` — 12 tests for `compareResults`, `buildIssuesCsv`, `createIssueKey`, `runAudit` policy branches, `auditIssueKey`

Domain suite: 17 → 38 tests, all pass.

### Section 8 — Documentation
Rewrote `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md` to reflect the current full-stack NestJS + React + Prisma + PostgreSQL + Redis architecture. Previous versions described a deprecated 2024 local-first SPA.

### Section 9 — Git hygiene
- Added `coverage/`, `*.tsbuildinfo`, IDE dirs, and npm log patterns to `.gitignore`.
- Created `.gitattributes` with `text=auto eol=lf`, binary markers for images/Excel/archives.

---

## Final validation (Section 10)

```
npm run build --workspace @ses/domain   ✓  0 errors
npm run typecheck --workspace @ses/api  ✓  0 errors
npm run typecheck --workspace @ses/web  ✓  0 errors
npm run test --workspace @ses/domain    ✓  38/38 pass
npm run test --workspace @ses/api       ✓  26/26 pass
```

---

## Deferred work

The following items were identified but are explicitly out of scope for Phase 0:

### 1 — `apps/web/src/lib/` vs `packages/domain/src/` duplication

Several files are near-duplicates:

| Web (`apps/web/src/lib/`) | Domain (`packages/domain/src/`) |
|--------------------------|--------------------------------|
| `auditEngine.ts` | `auditEngine.ts` |
| `auditPolicy.ts` | `auditPolicy.ts` |
| `scheduleHelpers.ts` | `scheduleHelpers.ts` |
| `notificationBuilder.ts` | `notificationBuilder.ts` |
| `storage.ts` | (no equivalent) |

The web copies are needed because the domain package is built to CommonJS for Node and the web needs ES module imports. The right fix is either: (a) add a separate ESM build target to `packages/domain`, or (b) move the web-only logic (storage, browser-specific helpers) out and import the rest from `@ses/domain`. This is a Phase 1 refactor task.

### 2 — `SCHEMA-GAP: updatedById is non-null in Prisma schema but public writes pass null`

`IssueAcknowledgment` and `IssueCorrection` have `updatedById: String` (non-null) in the Prisma schema, but the public-response service writes `null` when there is no authenticated user. The `as any` cast suppresses the TypeScript error. The fix requires either making `updatedById` optional in the schema or introducing a sentinel "public-user" ID. Phase 1 decision.

### 3 — API service coverage

All API services (audits, processes, files, tracking, signed-links, versions) have 0% test coverage. They require integration tests against a real PostgreSQL/S3 instance. Out of scope for Phase 0 unit-test additions.
