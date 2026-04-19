# Phase 0 — Code Inventory

Generated: 2026-04-18

---

## File Manifest

### `apps/api/src` — NestJS backend

| Path | Lines | Last Modified | Purpose |
|------|------:|--------------|---------|
| `apps/api/src/activity.controller.ts` | 65 | 2026-04-18 | Controller for activity log search and filtering by request |
| `apps/api/src/app.module.ts` | 101 | 2026-04-18 | Root NestJS module wiring all controllers, services, and throttling |
| `apps/api/src/audits.controller.ts` | 46 | 2026-04-18 | Controller for audit run endpoints with throttling and CSV/PDF export |
| `apps/api/src/audits.service.ts` | 435 | 2026-04-18 | Core audit execution: workbook parsing, issue detection, snapshot storage |
| `apps/api/src/auth.controller.ts` | 54 | 2026-04-18 | Dev-login, logout, and current-user endpoints |
| `apps/api/src/auth.guard.ts` | 13 | 2026-04-18 | CanActivate guard that validates JWT session cookie |
| `apps/api/src/auth.service.ts` | 164 | 2026-04-18 | JWT generation, validation, and cookie session management |
| `apps/api/src/common/activity-log.service.ts` | 50 | 2026-04-18 | Appends activity-log entries to the database |
| `apps/api/src/common/current-user.ts` | 6 | 2026-04-18 | Parameter decorator that extracts the current user from the request |
| `apps/api/src/common/filters/http-exception.filter.ts` | 42 | 2026-04-18 | Global exception filter for consistent JSON error responses |
| `apps/api/src/common/http.ts` | 29 | 2026-04-18 | HTTP utilities: content-disposition, If-Match parsing, date conversion |
| `apps/api/src/common/identifier.service.ts` | 116 | 2026-04-18 | Generates human-readable display codes (e.g. `PRC-001`) for entities |
| `apps/api/src/common/prisma.service.ts` | 13 | 2026-04-18 | Prisma ORM client wrapper with lifecycle hooks |
| `apps/api/src/common/process-access.service.ts` | 83 | 2026-04-18 | Authorisation service checking user permissions on processes |
| `apps/api/src/common/request-context.ts` | 29 | 2026-04-18 | AsyncLocalStorage context carrying request ID and current user |
| `apps/api/src/common/security/workbook-upload.ts` | 21 | 2026-04-18 | Validates and extracts buffer from a Multer file upload |
| `apps/api/src/dto/audits.dto.ts` | 8 | 2026-04-18 | DTO for audit run requests |
| `apps/api/src/dto/auth.dto.ts` | 21 | 2026-04-18 | DTO for dev-login credentials |
| `apps/api/src/dto/issues.dto.ts` | 38 | 2026-04-18 | DTOs for issue comments, corrections, and acknowledgments |
| `apps/api/src/dto/processes.dto.ts` | 40 | 2026-04-18 | DTOs for process create/update and sheet-selection |
| `apps/api/src/dto/versions.dto.ts` | 19 | 2026-04-18 | DTO for version creation |
| `apps/api/src/exports.controller.ts` | 31 | 2026-04-18 | Controller exposing bulk-export endpoints |
| `apps/api/src/exports.service.ts` | 73 | 2026-04-18 | Builds CSV/PDF export payloads |
| `apps/api/src/files.controller.ts` | 87 | 2026-04-18 | REST controller for workbook file upload, download, and deletion |
| `apps/api/src/files.service.ts` | 337 | 2026-04-18 | File storage, parsing, and sheet-update logic |
| `apps/api/src/issues.controller.ts` | 80 | 2026-04-18 | Controller for issue comments, corrections, and acknowledgments |
| `apps/api/src/issues.service.ts` | 311 | 2026-04-18 | Manages audit issue lifecycle (comment, correct, acknowledge) |
| `apps/api/src/jobs.controller.ts` | 16 | 2026-04-18 | Controller stub for background-job status endpoints |
| `apps/api/src/jobs.service.ts` | 45 | 2026-04-18 | Retrieves background job records with process-access guard |
| `apps/api/src/load-env.ts` | 20 | 2026-04-18 | Loads `.env` file before NestJS bootstrap |
| `apps/api/src/main.ts` | 60 | 2026-04-18 | NestJS bootstrap: CORS, cookie-parser, global filters, listen |
| `apps/api/src/process-activity.controller.ts` | 25 | 2026-04-18 | Controller for process-scoped activity-log endpoint |
| `apps/api/src/processes.controller.ts` | 81 | 2026-04-18 | REST controller for process CRUD and audit-policy updates |
| `apps/api/src/processes.service.ts` | 374 | 2026-04-18 | Process lifecycle: create, update, policy versioning, member management |
| `apps/api/src/realtime/presence.registry.ts` | 86 | 2026-04-18 | In-memory presence registry for connected users per process |
| `apps/api/src/realtime/realtime.gateway.ts` | 329 | 2026-04-18 | Socket.IO gateway: room joining, presence, event broadcasting |
| `apps/api/src/realtime/realtime.redis.ts` | 44 | 2026-04-18 | Redis adapter factory for Socket.IO horizontal scaling |
| `apps/api/src/realtime/realtime.types.ts` | 97 | 2026-04-18 | TypeScript types for all WebSocket event payloads |
| `apps/api/src/rules.controller.ts` | 19 | 2026-04-18 | Controller exposing the audit rule catalogue |
| `apps/api/src/rules.service.ts` | 32 | 2026-04-18 | Returns the in-memory audit rule catalogue |
| `apps/api/src/signed-links/public-response.controller.ts` | 68 | 2026-04-18 | Public controller for manager responses via signed links (no auth) |
| `apps/api/src/signed-links/public-response.service.ts` | 268 | 2026-04-18 | Processes public manager feedback submissions |
| `apps/api/src/signed-links/signed-link-token.service.ts` | 143 | 2026-04-18 | Generates and verifies JWTs embedded in signed links |
| `apps/api/src/signed-links/signed-link.service.ts` | 212 | 2026-04-18 | Creates, validates, and expires signed links for external stakeholders |
| `apps/api/src/templates.controller.ts` | 29 | 2026-04-18 | Controller for notification template CRUD |
| `apps/api/src/templates.service.ts` | 121 | 2026-04-18 | Manages per-process notification templates |
| `apps/api/src/tracking.controller.ts` | 57 | 2026-04-18 | Controller for manager follow-up tracking and status updates |
| `apps/api/src/tracking.service.ts` | 225 | 2026-04-18 | Manages tracking pipeline: upsert, event append, status |
| `apps/api/src/versions.controller.ts` | 36 | 2026-04-18 | Controller for audit version history |
| `apps/api/src/versions.service.ts` | 209 | 2026-04-18 | Stores and retrieves audit run version snapshots |

**API subtotal: 49 files, 3,854 lines**

---

### `apps/web/src` — React frontend

| Path | Lines | Last Modified | Purpose |
|------|------:|--------------|---------|
| `apps/web/src/App.tsx` | 66 | 2026-04-18 | Root React component with React Router setup |
| `apps/web/src/main.tsx` | 13 | 2026-04-18 | React entry point |
| `apps/web/src/vite-env.d.ts` | 1 | 2026-04-18 | Vite environment type shim |
| `apps/web/src/components/auth/AuthGate.tsx` | 78 | 2026-04-18 | Auth wrapper; fetches session and redirects unauthenticated users |
| `apps/web/src/components/dashboard/AuditSchedule.tsx` | 57 | 2026-04-18 | Shows upcoming audit schedule buckets |
| `apps/web/src/components/dashboard/CompareProcesses.tsx` | 98 | 2026-04-18 | Side-by-side audit result comparison across processes |
| `apps/web/src/components/dashboard/CreateProcessModal.tsx` | 54 | 2026-04-18 | Modal form for creating a new audit process |
| `apps/web/src/components/dashboard/ProcessCard.tsx` | 154 | 2026-04-18 | Card showing process summary, metrics, and schedule state |
| `apps/web/src/components/layout/AppShell.tsx` | 72 | 2026-04-18 | Main application layout with sidebar and navigation |
| `apps/web/src/components/layout/TopBar.tsx` | 210 | 2026-04-18 | Header with process info, audit-due badge, and user menu |
| `apps/web/src/components/shared/Badge.tsx` | 13 | 2026-04-18 | Badge component with tone variants |
| `apps/web/src/components/shared/BrandMark.tsx` | 13 | 2026-04-18 | Application logo/brand component |
| `apps/web/src/components/shared/Button.tsx` | 38 | 2026-04-18 | Reusable button with size and variant props |
| `apps/web/src/components/shared/EmptyState.tsx` | 11 | 2026-04-18 | Empty-state message component |
| `apps/web/src/components/shared/ErrorBoundary.tsx` | 41 | 2026-04-18 | React error boundary that logs to debugLog |
| `apps/web/src/components/shared/MetricCard.tsx` | 9 | 2026-04-18 | Single-metric display card |
| `apps/web/src/components/shared/PresenceBar.tsx` | 89 | 2026-04-18 | Shows real-time presence avatars for connected users |
| `apps/web/src/components/shared/ProgressBar.tsx` | 10 | 2026-04-18 | Simple progress indicator bar |
| `apps/web/src/components/shared/Skeleton.tsx` | 3 | 2026-04-18 | Loading skeleton placeholder |
| `apps/web/src/components/shared/StatusBadge.tsx` | 7 | 2026-04-18 | Status indicator badge |
| `apps/web/src/components/workspace/AnalyticsTab.tsx` | 78 | 2026-04-18 | Analytics tab showing per-manager stats and effort anomalies |
| `apps/web/src/components/workspace/AuditResultsTab.tsx` | 426 | 2026-04-18 | Audit issues table with filtering, corrections, and export |
| `apps/web/src/components/workspace/FilesSidebar.tsx` | 136 | 2026-04-18 | Sidebar listing uploaded workbook files |
| `apps/web/src/components/workspace/MembersPanel.tsx` | 218 | 2026-04-18 | Process membership management and role assignment |
| `apps/web/src/components/workspace/NotificationsTab.tsx` | 208 | 2026-04-18 | Notification composer with template selection and sending |
| `apps/web/src/components/workspace/PreviewTab.tsx` | 89 | 2026-04-18 | Preview tab for raw workbook data |
| `apps/web/src/components/workspace/SheetList.tsx` | 64 | 2026-04-18 | Sheet selection toggle list within a workbook |
| `apps/web/src/components/workspace/TabPanel.tsx` | 19 | 2026-04-18 | Scrollable tab panel container |
| `apps/web/src/components/workspace/TemplateEditor.tsx` | 113 | 2026-04-18 | Template editor with per-theme customisation |
| `apps/web/src/components/workspace/TrackingTab.tsx` | 341 | 2026-04-18 | Manager follow-up pipeline with status columns |
| `apps/web/src/components/workspace/VersionHistoryTab.tsx` | 89 | 2026-04-18 | Audit version history with diff summary |
| `apps/web/src/components/workspace/WorkspaceShell.tsx` | 29 | 2026-04-18 | Workspace container with tab routing |
| `apps/web/src/components/workspace/notifications/BroadcastComposer.tsx` | 95 | 2026-04-18 | Composes a broadcast notification to all managers |
| `apps/web/src/components/workspace/notifications/DraftCard.tsx` | 80 | 2026-04-18 | Card displaying a single notification draft |
| `apps/web/src/components/workspace/notifications/NotificationPreview.tsx` | 91 | 2026-04-18 | HTML preview renderer for a notification draft |
| `apps/web/src/components/workspace/notifications/PerManagerDrafts.tsx` | 199 | 2026-04-18 | Per-manager notification drafts with actions |
| `apps/web/src/hooks/useKeyboardShortcut.ts` | 17 | 2026-04-18 | Hook registering a keyboard shortcut via document listener |
| `apps/web/src/hooks/useSidebarCollapsed.ts` | 28 | 2026-04-18 | Hook managing sidebar collapse state in localStorage |
| `apps/web/src/lib/anomaly.ts` | 22 | 2026-04-18 | Effort-anomaly detection (local copy mirrors `@ses/domain`) |
| `apps/web/src/lib/api/auditsApi.ts` | 62 | 2026-04-18 | API client for audit run and issue endpoints |
| `apps/web/src/lib/api/filesApi.ts` | 68 | 2026-04-18 | API client for file upload, download, and deletion |
| `apps/web/src/lib/api/membersApi.ts` | 48 | 2026-04-18 | API client for process member management |
| `apps/web/src/lib/api/processesApi.ts` | 102 | 2026-04-18 | API client for process CRUD |
| `apps/web/src/lib/api/trackingApi.ts` | 60 | 2026-04-18 | API client for tracking upsert and event append |
| `apps/web/src/lib/auditEngine.ts` | 246 | 2026-04-18 | Client-side audit engine (local copy; diverged from `@ses/domain`) |
| `apps/web/src/lib/auditPolicy.ts` | 39 | 2026-04-18 | Audit policy defaults (exact copy of `@ses/domain`) |
| `apps/web/src/lib/auditRunner.ts` | 24 | 2026-04-18 | Async audit wrapper that spawns a Web Worker |
| `apps/web/src/lib/auditWorker.ts` | 13 | 2026-04-18 | Web Worker message types for audit processing |
| `apps/web/src/lib/blobStore.ts` | 15 | 2026-04-18 | OPFS/IndexedDB blob store for raw workbook data |
| `apps/web/src/lib/debugLog.ts` | 35 | 2026-04-18 | Debug event ring-buffer stored in localStorage |
| `apps/web/src/lib/excelParser.ts` | 241 | 2026-04-18 | Excel workbook parsing and annotated-workbook export |
| `apps/web/src/lib/id.ts` | 5 | 2026-04-18 | ID generation with optional prefix |
| `apps/web/src/lib/managerAnalytics.ts` | 44 | 2026-04-18 | Manager statistics computation (exact copy of `@ses/domain`) |
| `apps/web/src/lib/notificationBuilder.ts` | 267 | 2026-04-18 | Notification draft builder and HTML renderer (exact copy of `@ses/domain`) |
| `apps/web/src/lib/reportExporter.ts` | 39 | 2026-04-18 | Opens audit HTML report in a new browser tab |
| `apps/web/src/lib/scheduleHelpers.ts` | 64 | 2026-04-18 | Audit schedule calculation utilities (exact copy of `@ses/domain`) |
| `apps/web/src/lib/sessionWorkspace.ts` | 17 | 2026-04-18 | Clears browser workspace when session user changes |
| `apps/web/src/lib/severity.ts` | 13 | 2026-04-18 | Severity-level styling constants (exact copy of `@ses/domain`) |
| `apps/web/src/lib/storage.ts` | 328 | 2026-04-18 | LocalStorage + IndexedDB persistence layer |
| `apps/web/src/lib/tracking.ts` | 47 | 2026-04-18 | Tracking pipeline constants and helpers (exact copy of `@ses/domain`) |
| `apps/web/src/lib/types.ts` | 235 | 2026-04-18 | Frontend type definitions (partially diverged from `@ses/domain`) |
| `apps/web/src/pages/Dashboard.tsx` | 99 | 2026-04-18 | Dashboard page |
| `apps/web/src/pages/Debug.tsx` | 34 | 2026-04-18 | Debug info page showing localStorage debug events |
| `apps/web/src/pages/Login.tsx` | 127 | 2026-04-18 | Login page with dev-login form |
| `apps/web/src/pages/ManagerResponse.tsx` | 403 | 2026-04-18 | Public manager response page accessed via signed link |
| `apps/web/src/pages/VersionCompare.tsx` | 80 | 2026-04-18 | Audit version comparison page |
| `apps/web/src/pages/Workspace.tsx` | 141 | 2026-04-18 | Main workspace page with tab panel |
| `apps/web/src/realtime/socket.ts` | 76 | 2026-04-18 | Socket.IO client singleton and event helpers |
| `apps/web/src/realtime/types.ts` | 67 | 2026-04-18 | Frontend real-time event type definitions |
| `apps/web/src/realtime/useRealtime.ts` | 159 | 2026-04-18 | Hook managing Socket.IO connection lifecycle |
| `apps/web/src/store/selectors.ts` | 25 | 2026-04-18 | Zustand selectors for derived store state |
| `apps/web/src/store/useAppStore.ts` | 861 | 2026-04-18 | Main Zustand store with all client-side state and actions |

**Web subtotal: 71 files, 7,463 lines**

---

### `packages/domain/src` — Shared domain logic

| Path | Lines | Last Modified | Purpose |
|------|------:|--------------|---------|
| `packages/domain/src/anomaly.ts` | 22 | 2026-04-18 | Effort-anomaly detection |
| `packages/domain/src/auditEngine.ts` | 263 | 2026-04-18 | Core audit execution algorithm and result diffing |
| `packages/domain/src/auditPolicy.ts` | 39 | 2026-04-18 | Audit policy defaults and normalisation |
| `packages/domain/src/auditRules.ts` | 91 | 2026-04-18 | Audit rule catalogue (`AUDIT_RULE_CATALOG`) |
| `packages/domain/src/id.ts` | 6 | 2026-04-18 | `createId` function |
| `packages/domain/src/index.ts` | 13 | 2026-04-18 | Barrel re-export of all domain modules |
| `packages/domain/src/managerAnalytics.ts` | 44 | 2026-04-18 | Per-manager statistics |
| `packages/domain/src/notificationBuilder.ts` | 267 | 2026-04-18 | Notification rendering and template handling |
| `packages/domain/src/reporting.ts` | 44 | 2026-04-18 | Generates HTML audit report |
| `packages/domain/src/scheduleHelpers.ts` | 64 | 2026-04-18 | Schedule calculation utilities |
| `packages/domain/src/severity.ts` | 13 | 2026-04-18 | Severity-level styling constants |
| `packages/domain/src/tracking.ts` | 47 | 2026-04-18 | Tracking pipeline key constants and helpers |
| `packages/domain/src/types.ts` | 313 | 2026-04-18 | Canonical shared TypeScript types |
| `packages/domain/src/workbook.ts` | 258 | 2026-04-18 | Excel workbook parsing, sheet detection, and annotated export |

**Domain subtotal: 14 files, 1,484 lines**

---

**Grand total: 134 files, 12,801 lines**

---

## Dead Code

The following exported symbols have zero references outside their declaring file. Symbols that are part of `@ses/domain`'s public index are flagged **[domain-public]** — they must not be deleted per ground rules even if currently uncalled.

| Symbol | File | Note |
|--------|------|------|
| `normalizeProjectNo` | `packages/domain/src/auditEngine.ts` | **[domain-public]** Exported but never called outside its file |
| `validateWorkbookDescriptor` | `packages/domain/src/workbook.ts` | **[domain-public]** Exported but never called outside its file |
| `buildAuditRules` | `apps/web/src/lib/auditEngine.ts` | Only used internally; not imported by any component |
| `loadProcesses` | `apps/web/src/lib/storage.ts` | Only called within `storage.ts` itself as an internal helper |
| `saveProcesses` | `apps/web/src/lib/storage.ts` | Only called within `storage.ts` itself as an internal helper |
| `hydrateWorkbookRawData` | `apps/web/src/lib/storage.ts` | Only called within `storage.ts` itself as an internal helper |

**Notable structural duplication (not dead, but fragile):** Eight files under `apps/web/src/lib/` are verbatim or near-verbatim copies of their counterparts in `packages/domain/src/`. The web bundle does not import from `@ses/domain` at all. This is a latent divergence risk and should be addressed in a future refactor session (not this cleanup).

Files that are exact copies: `anomaly.ts`, `auditPolicy.ts`, `managerAnalytics.ts`, `notificationBuilder.ts`, `scheduleHelpers.ts`, `severity.ts`, `tracking.ts`.

Files that have diverged: `auditEngine.ts` (142-line diff — web version lacks `auditRules.ts` integration), `types.ts` (147-line diff), `id.ts` (minor).

---

## TODO / FIXME

**None found.** A search for `TODO`, `FIXME`, `XXX`, `HACK`, and `NOTE` across `apps/` and `packages/` (excluding `node_modules` and generated files) returned zero matches.

---

## Type-Safety Holes

All occurrences of `any`, `as any`, `as unknown as`, `// @ts-ignore`, and `// @ts-expect-error` in `apps/` and `packages/` source (excluding `node_modules`, generated Prisma client, and `.d.ts` files).

**46 occurrences total.** None use `@ts-ignore` or `@ts-expect-error`.

### `apps/api/src/audits.service.ts` — 10 occurrences

All are Prisma JSON-column boundaries: Prisma 5 types `Json` as `JsonValue` (a union that doesn't satisfy domain types).

| Line | Code |
|-----:|------|
| 229 | `policySnapshot: process.auditPolicy as any,` |
| 233 | `} as any,` |
| 236 | `const result = runAudit(domainFile, process.auditPolicy as any, {` |
| 275 | `} as any,` |
| 285 | `summary: summary as any,` |
| 287 | `} as any,` |
| 376 | `content: content as any,` |
| 378 | `} as any,` |
| 417 | `policySnapshot: run.policySnapshot as unknown as AuditResult['policySnapshot']` |

### `apps/api/src/files.service.ts` — 6 occurrences

JSON column and binary `Buffer` Prisma boundary.

| Line | Code |
|-----:|------|
| 134 | `content: buffer as any,` |
| 135 | `parsedSheets: workbook.sheets as any,` |
| 137 | `} as any,` |
| 151 | `rows: (workbook.rawData[sheet.name] ?? []) as any,` |
| 152 | `originalHeaders: (sheet.originalHeaders ?? undefined) as any,` |
| 153 | `normalizedHeaders: (sheet.normalizedHeaders ?? undefined) as any,` |
| 154 | `} as any,` |

### `apps/api/src/processes.service.ts` — 5 occurrences

`auditPolicy` JSON column boundary.

| Line | Code |
|-----:|------|
| 89 | `auditPolicy: createDefaultAuditPolicy() as any,` |
| 91 | `} as any,` |
| 161 | `} as any,` |
| 216 | `auditPolicy: auditPolicy as any,` |
| 219 | `} as any,` |

### `apps/api/src/signed-links/signed-link.service.ts` — 6 occurrences

Prisma client type not yet regenerated after migration; `this.prisma` cast needed for new models.

| Line | Code |
|-----:|------|
| 68 | `const process = await (this.prisma as any).process.findFirst({` |
| 77 | `await this.identifiers.nextSequence(this.prisma as any, 'LNK')` |
| 80 | `await (this.prisma as any).signedLink.create({` |
| 111 | `const row = await (this.prisma as any).signedLink.findFirst({` |
| 149 | `const ctx = tx as any;` |
| 164 | `await this.activity.append(tx as any, {` |

### `apps/api/src/signed-links/public-response.service.ts` — 1 occurrence

| Line | Code |
|-----:|------|
| 170 | `const issue = await (this.prisma as any).auditIssue.findFirst({` |

### `apps/api/src/tracking.service.ts` — 3 occurrences

`projectStatuses` JSON column boundary.

| Line | Code |
|-----:|------|
| 96 | `projectStatuses: (body.projectStatuses as any) ?? existing.projectStatuses,` |
| 111 | `projectStatuses: (body.projectStatuses ?? {}) as any,` |
| 159 | `projectStatuses: (body.projectStatuses as any) ?? prior.projectStatuses,` |

### `apps/api/src/templates.service.ts` — 1 occurrence

`template` JSON column boundary.

| Line | Code |
|-----:|------|
| 79 | `template: body.template as any,` |

### `apps/api/src/common/activity-log.service.ts` — 1 occurrence

`metadata` JSON column boundary.

| Line | Code |
|-----:|------|
| 47 | `} as any,` |

### `apps/api/src/versions.service.ts` — 2 occurrences

| Line | Code |
|-----:|------|
| 92 | `policySnapshot: version.auditRun.policySnapshot as unknown as AuditResult['policySnapshot']` |
| 155 | `} as any,` |

### `apps/api/prisma/seed.ts` — 2 occurrences

`paramsSchema` JSON column in seed data.

| Line | Code |
|-----:|------|
| 56 | `paramsSchema: rule.paramsSchema as any,` |
| 67 | `paramsSchema: rule.paramsSchema as any,` |

### Test files (acceptable — test scaffolding only)

| File | Line | Code |
|------|-----:|------|
| `apps/web/test/export.test.ts` | 29 | `(globalThis as unknown as { URL: … }).URL = fakeUrl as unknown as typeof URL` |
| `apps/web/test/export.test.ts` | 30 | `(globalThis as unknown as { document: Document }).document = …` |
| `apps/web/test/export.test.ts` | 94 | `(globalThis as unknown as { URL: … }).URL = originalUrl` |
| `apps/web/test/export.test.ts` | 95 | `(globalThis as unknown as { document: … }).document = originalDocument` |
| `apps/web/test/notification.test.ts` | 68 | `(globalThis as unknown as { window: … }).window = fakeWindow` |
| `packages/domain/test/export.test.ts` | 29 | *(same pattern as above)* |
| `packages/domain/test/export.test.ts` | 30 | *(same pattern as above)* |
| `packages/domain/test/export.test.ts` | 94 | *(same pattern as above)* |
| `packages/domain/test/export.test.ts` | 95 | *(same pattern as above)* |
| `packages/domain/test/notification.test.ts` | 68 | *(same pattern as above)* |

**Root cause summary:** All production `as any` casts fall into three categories:
1. **Prisma JSON columns** — `auditPolicy`, `parsedSheets`, `content`, `projectStatuses`, `template`, `metadata`, `paramsSchema` are typed as `Prisma.JsonValue` which does not satisfy domain-layer interfaces. Unavoidable until Prisma 6 adds typed JSON columns.
2. **Prisma client not regenerated** — `signedLink`, `auditIssue` models appear to have been added after the last `prisma generate`; client is missing those typings at compile time.
3. **Double-cast for snapshot retrieval** — `policySnapshot` read back from the DB needs a cast because it was stored as opaque JSON.
