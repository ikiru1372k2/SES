# SES — Production Restructure Plan

**Branch:** `ashik/structure`  
**Date:** 2026-04-27  
**Goal:** Reorganise every layer of the monorepo to production standard:
no source file exceeds 600 lines, folder responsibility is unambiguous,
the database schema is fully normalised with proper indexes, and the API /
UI layers follow consistent patterns.

---

## Table of Contents

1. [What's Wrong Today](#1-whats-wrong-today)
2. [Proposed Monorepo Layout](#2-proposed-monorepo-layout)
3. [API — File Breakdown](#3-api--file-breakdown)
4. [UI — File Breakdown](#4-ui--file-breakdown)
5. [Domain Package — File Breakdown](#5-domain-package--file-breakdown)
6. [Database Design](#6-database-design)
7. [Migration Checklist](#7-migration-checklist)

---

## 1. What's Wrong Today

### Oversized files (>600 lines — must split)

| File | Lines | Problem |
|---|---|---|
| `apps/web/src/store/useAppStore.ts` | 1380 | All state in one file — impossible to test in isolation |
| `apps/web/src/components/workspace/AuditResultsTab.tsx` | 975 | Component + data fetch + table logic + filter state all mixed |
| `apps/api/prisma/schema.prisma` | 877 | No indexes documented, soft-delete pattern inconsistent |
| `apps/api/src/audits.service.ts` | 874 | Audit orchestration, issue fetching, analytics all in one class |
| `apps/api/src/directory/directory.service.ts` | 826 | Import, merge, alias normalisation all in one class |
| `apps/api/src/processes.service.ts` | 725 | CRUD + policy snapshot + SLA config + member management |
| `apps/api/src/tracking-compose/tracking-compose.service.ts` | 690 | Draft composition + per-manager logic + template rendering |
| `apps/web/src/pages/VersionCompare.tsx` | 664 | Data fetch + diff computation + render all mixed |
| `apps/web/src/components/escalations/Composer.tsx` | 648 | Letter composer + send logic + state all mixed |
| `apps/web/src/components/ai-pilot/SandboxModal.tsx` | 641 | Upload + rule eval + result view in one modal |
| `apps/web/src/pages/Workspace.tsx` | 593 | Page-level state + tab routing + sidebar all mixed |

### Structural issues
- Three `TopBar` variants (`TopBar`, `TopBarLegacy`, `TopBarNew`) — dead code
- `useAppStore` is not sliced — any store update re-renders the whole app
- No dedicated `repositories/` layer in the API — some services hit Prisma directly
- No `errors/` or `exceptions/` folder — error classes scattered
- `types.ts` in domain is 437 lines — mixes API types, domain types, and enums
- No feature-flag or config abstraction — env vars read directly inside services

---

## 2. Proposed Monorepo Layout

```
SES/
├── apps/
│   ├── api/                            # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma           # models only — target <600 lines
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       │
│   │       ├── config/                 # NEW — all env/config in one place
│   │       │   ├── app.config.ts
│   │       │   ├── auth.config.ts
│   │       │   └── mail.config.ts
│   │       │
│   │       ├── common/                 # guards, pipes, filters, decorators
│   │       │   ├── guards/
│   │       │   │   ├── auth.guard.ts
│   │       │   │   ├── admin.guard.ts
│   │       │   │   └── function-access.guard.ts
│   │       │   ├── decorators/
│   │       │   │   ├── current-user.decorator.ts
│   │       │   │   └── requires-scope.decorator.ts
│   │       │   ├── filters/
│   │       │   │   └── http-exception.filter.ts
│   │       │   ├── pipes/
│   │       │   │   └── upload-validation.pipe.ts
│   │       │   └── services/
│   │       │       ├── prisma.service.ts
│   │       │       ├── identifier.service.ts
│   │       │       └── activity-log.service.ts
│   │       │
│   │       ├── modules/                # one folder per bounded context
│   │       │   │
│   │       │   ├── auth/
│   │       │   │   ├── auth.module.ts
│   │       │   │   ├── auth.controller.ts
│   │       │   │   ├── auth.service.ts
│   │       │   │   └── session.service.ts      # NEW split from auth.service
│   │       │   │
│   │       │   ├── process/
│   │       │   │   ├── process.module.ts
│   │       │   │   ├── process.controller.ts
│   │       │   │   ├── process.service.ts          # CRUD only — <400 lines
│   │       │   │   ├── process-policy.service.ts   # NEW split
│   │       │   │   ├── process-member.service.ts   # NEW split
│   │       │   │   └── process.repository.ts       # NEW — Prisma queries only
│   │       │   │
│   │       │   ├── files/
│   │       │   │   ├── files.module.ts
│   │       │   │   ├── files.controller.ts
│   │       │   │   ├── files.service.ts
│   │       │   │   ├── files.repository.ts         # SPLIT from 472-line file
│   │       │   │   ├── file-drafts.controller.ts
│   │       │   │   ├── file-drafts.service.ts
│   │       │   │   └── file-versions.controller.ts
│   │       │   │
│   │       │   ├── audit/
│   │       │   │   ├── audit.module.ts
│   │       │   │   ├── audit.controller.ts
│   │       │   │   ├── audit-runner.service.ts     # SPLIT: run logic only
│   │       │   │   ├── audit-results.service.ts    # SPLIT: issue fetch/summary
│   │       │   │   ├── audit-analytics.service.ts  # SPLIT: analytics calcs
│   │       │   │   └── audit.repository.ts
│   │       │   │
│   │       │   ├── rules/
│   │       │   │   ├── rules.module.ts
│   │       │   │   ├── rules.controller.ts
│   │       │   │   └── rules.service.ts
│   │       │   │
│   │       │   ├── issues/
│   │       │   │   ├── issues.module.ts
│   │       │   │   ├── issues.controller.ts
│   │       │   │   ├── issues.service.ts
│   │       │   │   └── issues.repository.ts
│   │       │   │
│   │       │   ├── directory/
│   │       │   │   ├── directory.module.ts
│   │       │   │   ├── directory.controller.ts
│   │       │   │   ├── directory-import.service.ts  # SPLIT: bulk import
│   │       │   │   ├── directory-merge.service.ts   # SPLIT: merge detection
│   │       │   │   ├── directory-query.service.ts   # SPLIT: read queries
│   │       │   │   └── directory.repository.ts
│   │       │   │
│   │       │   ├── tracking/
│   │       │   │   ├── tracking.module.ts
│   │       │   │   ├── tracking.controller.ts
│   │       │   │   ├── tracking.service.ts
│   │       │   │   ├── tracking-stage.controller.ts
│   │       │   │   ├── tracking-stage.service.ts
│   │       │   │   ├── tracking-bulk.controller.ts
│   │       │   │   ├── tracking-bulk.service.ts
│   │       │   │   ├── tracking-attachments.controller.ts
│   │       │   │   └── tracking.repository.ts
│   │       │   │
│   │       │   ├── compose/                         # notification drafting
│   │       │   │   ├── compose.module.ts
│   │       │   │   ├── compose.controller.ts
│   │       │   │   ├── compose-draft.service.ts     # SPLIT from 690-line file
│   │       │   │   ├── compose-render.service.ts    # SPLIT: template render
│   │       │   │   └── compose-send.service.ts      # SPLIT: outbound delivery
│   │       │   │
│   │       │   ├── notifications/
│   │       │   │   ├── notifications.module.ts
│   │       │   │   ├── notifications.controller.ts
│   │       │   │   ├── in-app-notifications.controller.ts
│   │       │   │   └── notifications.service.ts
│   │       │   │
│   │       │   ├── escalation-templates/
│   │       │   │   ├── escalation-templates.module.ts
│   │       │   │   ├── escalation-templates.controller.ts
│   │       │   │   └── escalation-templates.service.ts
│   │       │   │
│   │       │   ├── versions/
│   │       │   │   ├── versions.module.ts
│   │       │   │   ├── versions.controller.ts
│   │       │   │   └── versions.service.ts
│   │       │   │
│   │       │   ├── exports/
│   │       │   │   ├── exports.module.ts
│   │       │   │   ├── exports.controller.ts
│   │       │   │   └── exports.service.ts
│   │       │   │
│   │       │   ├── activity/
│   │       │   │   ├── activity.module.ts
│   │       │   │   ├── activity.controller.ts
│   │       │   │   └── process-activity.controller.ts
│   │       │   │
│   │       │   ├── signed-links/
│   │       │   │   ├── signed-links.module.ts
│   │       │   │   ├── signed-links.controller.ts
│   │       │   │   ├── public-response.controller.ts
│   │       │   │   └── signed-links.service.ts
│   │       │   │
│   │       │   ├── ai-pilot/
│   │       │   │   ├── ai-pilot.module.ts
│   │       │   │   ├── ai-pilot.controller.ts
│   │       │   │   ├── ai-pilot-rules.service.ts    # SPLIT: rule CRUD
│   │       │   │   ├── ai-pilot-generate.service.ts # SPLIT: LLM calls
│   │       │   │   ├── ai-pilot-sandbox.service.ts  # SPLIT: sandbox sessions
│   │       │   │   └── ai-client.service.ts
│   │       │   │
│   │       │   ├── realtime/
│   │       │   │   ├── realtime.module.ts
│   │       │   │   ├── realtime.gateway.ts          # Socket.IO
│   │       │   │   └── presence.registry.ts
│   │       │   │
│   │       │   └── jobs/
│   │       │       ├── jobs.module.ts
│   │       │       └── jobs.controller.ts
│   │       │
│   │       └── dto/                    # shared DTOs (keep flat, under 200 lines each)
│   │           ├── auth.dto.ts
│   │           ├── process.dto.ts
│   │           ├── file.dto.ts
│   │           ├── audit.dto.ts
│   │           ├── tracking.dto.ts
│   │           └── directory.dto.ts
│   │
│   └── web/                            # React frontend
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           │
│           ├── config/                 # NEW — env vars in one place
│           │   └── env.ts
│           │
│           ├── lib/                    # API clients, utilities
│           │   ├── api/
│           │   │   ├── client.ts           # axios base instance
│           │   │   ├── processes.api.ts
│           │   │   ├── files.api.ts
│           │   │   ├── file-versions.api.ts
│           │   │   ├── file-drafts.api.ts
│           │   │   ├── audits.api.ts
│           │   │   ├── tracking.api.ts
│           │   │   ├── issues.api.ts
│           │   │   ├── directory.api.ts
│           │   │   ├── notifications.api.ts
│           │   │   ├── signed-links.api.ts
│           │   │   └── ai-pilot.api.ts
│           │   └── utils/
│           │       ├── id.ts
│           │       ├── date.ts
│           │       └── excel.ts
│           │
│           ├── store/                  # Zustand slices — SPLIT from 1380-line file
│           │   ├── index.ts            # combines slices
│           │   ├── slices/
│           │   │   ├── process.slice.ts        # process CRUD
│           │   │   ├── workspace.slice.ts      # active file, tab, sheet
│           │   │   ├── audit.slice.ts          # audit runs, issues
│           │   │   ├── tracking.slice.ts       # escalation tracking
│           │   │   ├── notification.slice.ts   # drafts, compose
│           │   │   ├── file.slice.ts           # file list, draft
│           │   │   └── ui.slice.ts             # sidebar, modals
│           │   └── types.ts
│           │
│           ├── hooks/                  # custom React hooks
│           │   ├── useProcess.ts
│           │   ├── useWorkspace.ts
│           │   ├── useAudit.ts
│           │   ├── useTracking.ts
│           │   ├── useEffectiveAccess.ts
│           │   ├── useKeyboardShortcut.ts
│           │   ├── useDebouncedValue.ts
│           │   ├── useCoalescedInvalidator.ts
│           │   └── useAutosaveOnLeave.ts
│           │
│           ├── realtime/
│           │   ├── socket.ts
│           │   ├── useRealtime.ts
│           │   └── types.ts
│           │
│           ├── pages/                  # route-level components — thin wrappers
│           │   ├── Login.tsx
│           │   ├── Signup.tsx
│           │   ├── Dashboard.tsx
│           │   ├── Workspace.tsx           # SPLIT — max 300 lines
│           │   ├── EscalationCenter.tsx    # SPLIT — max 300 lines
│           │   ├── VersionCompare.tsx      # SPLIT — max 300 lines
│           │   ├── AiPilotShell.tsx        # SPLIT — max 300 lines
│           │   ├── AdminDirectory.tsx
│           │   ├── EscalationTemplateAdmin.tsx
│           │   └── ManagerResponse.tsx
│           │
│           └── components/
│               │
│               ├── ui/                     # primitive / design-system components
│               │   ├── Button.tsx
│               │   ├── Modal.tsx
│               │   ├── Badge.tsx
│               │   ├── StatusBadge.tsx
│               │   ├── MetricCard.tsx
│               │   ├── EmptyState.tsx
│               │   ├── ProgressBar.tsx
│               │   ├── Skeleton.tsx
│               │   ├── SplitButton.tsx
│               │   ├── ConfirmProvider.tsx
│               │   └── ErrorBoundary.tsx
│               │
│               ├── layout/
│               │   ├── AppShell.tsx
│               │   ├── TopBar.tsx              # DELETE legacy + new variants
│               │   ├── AvatarMenu.tsx
│               │   ├── NotificationBell.tsx
│               │   ├── Breadcrumb.tsx
│               │   └── RealtimeStatusPill.tsx
│               │
│               ├── auth/
│               │   ├── AuthGate.tsx
│               │   └── AdminRoute.tsx
│               │
│               ├── workspace/              # file/audit workspace tab bar
│               │   ├── WorkspaceShell.tsx
│               │   ├── FilesSidebar.tsx
│               │   ├── SheetList.tsx
│               │   ├── DraftRestoreBanner.tsx
│               │   ├── UnsavedAuditDialog.tsx
│               │   ├── MembersPanel.tsx        # SPLIT into:
│               │   │   ├── MembersList.tsx     #   list view
│               │   │   └── AddMemberForm.tsx   #   add form
│               │   └── tabs/
│               │       ├── PreviewTab.tsx
│               │       ├── AnalyticsTab.tsx
│               │       ├── VersionHistoryTab.tsx
│               │       ├── SendLogPanel.tsx
│               │       ├── TemplateEditor.tsx
│               │       ├── NotificationsTab.tsx
│               │       ├── TrackingTab.tsx
│               │       └── audit-results/          # SPLIT AuditResultsTab (975 lines)
│               │           ├── AuditResultsTab.tsx # orchestrator — <300 lines
│               │           ├── AuditIssueTable.tsx # table + columns
│               │           ├── AuditFilterBar.tsx  # filter controls
│               │           └── AuditSummaryStrip.tsx
│               │
│               ├── escalations/
│               │   ├── EscalationPanel.tsx
│               │   ├── ManagerTable.tsx
│               │   ├── EscalationFilters.tsx
│               │   ├── EscalationSummaryBar.tsx
│               │   ├── SavedViewsRail.tsx
│               │   ├── StageGraph.tsx
│               │   ├── TrackingTimeline.tsx
│               │   ├── ActivityFeed.tsx
│               │   ├── AttachmentsTab.tsx
│               │   ├── FindingsTab.tsx
│               │   ├── AnalyticsStrip.tsx
│               │   ├── ShortcutOverlay.tsx
│               │   ├── compose/                    # SPLIT Composer.tsx (648 lines)
│               │   │   ├── Composer.tsx            # shell + state — <250 lines
│               │   │   ├── ComposerLetterEditor.tsx
│               │   │   ├── ComposerSendBar.tsx
│               │   │   └── ComposerRecipientList.tsx
│               │   ├── BulkComposer.tsx
│               │   └── BroadcastDialog.tsx         # SPLIT (434 lines)
│               │       ├── BroadcastDialog.tsx     # shell — <250 lines
│               │       └── BroadcastRecipientPicker.tsx
│               │
│               ├── dashboard/
│               │   ├── ProcessCard.tsx
│               │   ├── CreateProcessModal.tsx
│               │   ├── AuditSchedule.tsx
│               │   └── CompareProcesses.tsx
│               │
│               ├── directory/
│               │   ├── DirectoryTable.tsx
│               │   ├── DirectoryUploadWizard.tsx
│               │   ├── AddManagerForm.tsx
│               │   ├── PasteFromExcel.tsx
│               │   ├── ResolutionDrawer.tsx
│               │   └── DeleteManagerButton.tsx
│               │
│               ├── ai-pilot/
│               │   ├── AllRulesPane.tsx
│               │   ├── PromptEnhancer.tsx
│               │   ├── WelcomeModal.tsx
│               │   ├── AiBadge.tsx
│               │   ├── EscalationLitePreview.tsx
│               │   ├── PromptExamplesPanel.tsx
│               │   └── sandbox/                    # SPLIT SandboxModal (641 lines)
│               │       ├── SandboxModal.tsx        # shell — <200 lines
│               │       ├── SandboxUploadStep.tsx
│               │       ├── SandboxResultsView.tsx
│               │       └── SandboxRulePreview.tsx
│               │
│               └── notifications/
│                   ├── BroadcastComposer.tsx
│                   ├── PerManagerDrafts.tsx
│                   ├── DraftCard.tsx
│                   └── NotificationPreview.tsx
│
└── packages/
    └── domain/                         # shared TypeScript domain logic
        └── src/
            ├── types/                  # SPLIT types.ts (437 lines)
            │   ├── audit.types.ts
            │   ├── tracking.types.ts
            │   ├── notification.types.ts
            │   ├── process.types.ts
            │   └── shared.types.ts
            ├── audit/
            │   ├── engine.ts           # orchestrator
            │   ├── rules.ts
            │   ├── policy.ts
            │   ├── findings.ts
            │   └── severity.ts
            ├── functions-audit/        # keep as-is (5 plugins)
            │   ├── master-data/
            │   ├── function-rate/
            │   ├── internal-cost-rate/
            │   ├── missing-plan/
            │   ├── opportunities/
            │   └── over-planning/
            ├── ai-pilot/               # keep as-is
            ├── escalations/
            │   ├── state-machine.ts
            │   ├── stages.ts
            │   └── aggregator.ts
            ├── directory/
            │   └── manager.ts
            ├── notifications/
            │   ├── builder.ts
            │   └── template.ts
            ├── workbook/
            │   └── parser.ts
            ├── schedule/
            │   └── helpers.ts
            ├── analytics/
            │   └── manager-analytics.ts
            └── id.ts
```

---

## 3. API — File Breakdown

### 3.1 `audits.service.ts` (874 lines → 3 services)

| New File | Responsibility | Target Lines |
|---|---|---|
| `audit-runner.service.ts` | Trigger audit run, poll job, write AuditRun row | <300 |
| `audit-results.service.ts` | Fetch issues, apply filters, build summary payload | <350 |
| `audit-analytics.service.ts` | Manager analytics, KPI aggregation | <250 |

### 3.2 `directory.service.ts` (826 lines → 3 services)

| New File | Responsibility | Target Lines |
|---|---|---|
| `directory-import.service.ts` | Bulk import, CSV/Excel parsing, upsert | <300 |
| `directory-merge.service.ts` | Alias detection, merge conflict resolution | <300 |
| `directory-query.service.ts` | Listing, search, pagination | <200 |

### 3.3 `processes.service.ts` (725 lines → 3 services)

| New File | Responsibility | Target Lines |
|---|---|---|
| `process.service.ts` | CRUD: create, read, update, delete, list | <300 |
| `process-policy.service.ts` | Policy snapshot, SLA config, function-audit-requests | <250 |
| `process-member.service.ts` | Member invite, scope permissions, access resolution | <200 |

### 3.4 `tracking-compose.service.ts` (690 lines → 3 services)

| New File | Responsibility | Target Lines |
|---|---|---|
| `compose-draft.service.ts` | Save/load/discard draft per manager | <250 |
| `compose-render.service.ts` | Template substitution, merge field resolution | <250 |
| `compose-send.service.ts` | Outbound delivery orchestration | <200 |

### 3.5 Repository layer (new)

Every module gets a `*.repository.ts` that owns all Prisma queries. Services call the repository; they never import `PrismaService` directly. This caps each repository to ~300 lines of focused queries and keeps services free of SQL concerns.

---

## 4. UI — File Breakdown

### 4.1 `useAppStore.ts` (1380 lines → 7 slices)

Each slice is an independent Zustand sub-store, combined in `store/index.ts`.

| Slice | State owned | Target Lines |
|---|---|---|
| `process.slice.ts` | Processes list, active process | <200 |
| `workspace.slice.ts` | Active file, tab, sheet, version | <200 |
| `audit.slice.ts` | Audit runs, issues, run state | <200 |
| `tracking.slice.ts` | Tracking entries, stage changes | <200 |
| `notification.slice.ts` | Drafts, compose state | <180 |
| `file.slice.ts` | File list, upload progress, draft | <180 |
| `ui.slice.ts` | Sidebar, modals, panel open state | <150 |

### 4.2 `AuditResultsTab.tsx` (975 lines → 4 files)

| New File | Responsibility | Target Lines |
|---|---|---|
| `AuditResultsTab.tsx` | Tab orchestrator: loads data, passes props | <300 |
| `AuditIssueTable.tsx` | Virtualised table, column definitions | <300 |
| `AuditFilterBar.tsx` | Filter controls, active filter badges | <200 |
| `AuditSummaryStrip.tsx` | Header KPI row (count, severity breakdown) | <150 |

### 4.3 `Composer.tsx` (648 lines → 4 files)

| New File | Responsibility | Target Lines |
|---|---|---|
| `Composer.tsx` | Modal shell, step state machine | <200 |
| `ComposerLetterEditor.tsx` | Rich text editor + template variables | <250 |
| `ComposerSendBar.tsx` | Channel picker, send/schedule controls | <150 |
| `ComposerRecipientList.tsx` | Manager selection list | <150 |

### 4.4 `SandboxModal.tsx` (641 lines → 4 files)

| New File | Responsibility | Target Lines |
|---|---|---|
| `SandboxModal.tsx` | Modal shell + step router | <150 |
| `SandboxUploadStep.tsx` | Drag-drop file upload step | <200 |
| `SandboxResultsView.tsx` | Issue list + pass/fail summary | <200 |
| `SandboxRulePreview.tsx` | Rule JSON viewer | <150 |

### 4.5 `MembersPanel.tsx` (525 lines → 2 files)

| New File | Responsibility | Target Lines |
|---|---|---|
| `MembersList.tsx` | Member table, role pill, remove action | <300 |
| `AddMemberForm.tsx` | Invite form, email validation | <200 |

### 4.6 Page thinning (pages should be routing shells <300 lines)

| Page | Current | Action |
|---|---|---|
| `Workspace.tsx` | 593 | Extract `WorkspaceDataLoader.tsx` (query logic) |
| `EscalationCenter.tsx` | 520 | Extract `EscalationDataLoader.tsx` |
| `VersionCompare.tsx` | 664 | Extract `VersionDiffEngine.tsx` (diff computation) |
| `AiPilotShell.tsx` | 333 | Fine — leave |

### 4.7 Delete dead code

- `TopBarLegacy.tsx` and `TopBarNew.tsx` — delete; keep only `TopBar.tsx`
- `Debug.tsx` — move behind `NODE_ENV === 'development'` guard or delete

---

## 5. Domain Package — File Breakdown

### 5.1 `types.ts` (437 lines → 5 files)

| New File | Types contained |
|---|---|
| `types/audit.types.ts` | AuditRun, AuditIssue, AuditRule, AuditSummary |
| `types/tracking.types.ts` | TrackingEntry, TrackingEvent, EscalationStage |
| `types/notification.types.ts` | Notification, NotificationLog, Template |
| `types/process.types.ts` | Process, SystemFunction, ProcessFunction |
| `types/shared.types.ts` | Enums, utility types used across modules |

---

## 6. Database Design

### 6.1 Missing indexes (add to schema.prisma)

```prisma
// AuditRun — frequent lookups by process + file
@@index([processId, fileId, createdAt(sort: Desc)])

// AuditIssue — filter by run and severity
@@index([auditRunId, severity])

// TrackingEntry — filter by process and stage
@@index([processId, stage])

// ActivityLog — time-range queries per process
@@index([processId, createdAt(sort: Desc)])

// NotificationLog — outbox pattern queries
@@index([trackingId, sentAt])

// AiPilotSandboxSession — expire cleanup job
@@index([expiresAt])

// WorkbookFile — list by process ordered by upload
@@index([processId, createdAt(sort: Desc)])

// ManagerDirectory — search by process + name
@@index([processId, normalizedName])
```

### 6.2 Soft delete — standardise pattern

Several models have `deletedAt DateTime?` but not all. Standardise:
- Add `deletedAt DateTime?` to: `WorkbookFile`, `AuditRule`, `TrackingEntry`
- Create a Prisma middleware that auto-filters `deletedAt: null` on `findMany`

### 6.3 Audit trail improvement

`ActivityLog` stores `before` and `after` as untyped `Json`. Add a discriminated-union type in domain (`ActivityLogEntry`) so callers get type safety when reading the activity feed.

### 6.4 `FileBlob` — consider moving to object storage

Currently workbook bytes are stored as BYTEA in PostgreSQL. For production at scale, move `FileBlob.data` to S3-compatible storage and store only the key in the DB. This is a separate initiative; document the interface here so the swap is a one-file change in `files.repository.ts`.

### 6.5 Model naming consistency

- Rename `IdentifierCounter` → `SequenceCounter` (matches its purpose)
- Rename `Job` → `BackgroundJob` (avoids collision with TS lib `Job` type)

### 6.6 Add `updatedAt` where missing

`AiPilotSandboxSession`, `SignedLink`, and `WebhookEndpoint` are missing `updatedAt`. Add it to all models for consistent audit capability.

---

## 7. Migration Checklist

Work should be done in this order to avoid breaking tests mid-refactor.

### Phase 1 — API splitting (no UI changes)
- [ ] Create `config/` folder; move env reads from services into `AppConfigService`
- [ ] Add repository layer (`*.repository.ts`) for `process`, `files`, `audit`, `directory`, `tracking`
- [ ] Split `audits.service.ts` → 3 services
- [ ] Split `directory.service.ts` → 3 services
- [ ] Split `processes.service.ts` → 3 services
- [ ] Split `tracking-compose.service.ts` → 3 services
- [ ] Split `ai-pilot.service.ts` → 3 services
- [ ] Ensure all e2e + unit tests still pass after each split

### Phase 2 — Database schema
- [ ] Add all missing `@@index` blocks
- [ ] Standardise `deletedAt` across all soft-delete models
- [ ] Add `updatedAt` to models missing it
- [ ] Rename `IdentifierCounter` → `SequenceCounter`, `Job` → `BackgroundJob`
- [ ] Generate and test migrations
- [ ] Update seed.ts to match renamed models

### Phase 3 — Domain package
- [ ] Split `types.ts` into 5 files under `types/`
- [ ] Reorganise `src/` into feature subfolders (audit, escalations, etc.)
- [ ] Update all import paths in `apps/api` and `apps/web`
- [ ] Ensure all domain tests pass

### Phase 4 — UI store splitting
- [ ] Define slice interfaces in `store/types.ts`
- [ ] Implement 7 Zustand slices
- [ ] Update all component imports from `useAppStore` to slice hooks
- [ ] Verify no store subscription causes unnecessary re-renders

### Phase 5 — UI component splitting
- [ ] Split `AuditResultsTab.tsx` → 4 files
- [ ] Split `Composer.tsx` → 4 files
- [ ] Split `SandboxModal.tsx` → 4 files
- [ ] Split `MembersPanel.tsx` → 2 files
- [ ] Split `VersionCompare.tsx` → thin page + `VersionDiffEngine`
- [ ] Thin `Workspace.tsx` and `EscalationCenter.tsx`
- [ ] Delete `TopBarLegacy.tsx`, `TopBarNew.tsx`
- [ ] Move `Debug.tsx` behind env guard

### Phase 6 — Verification
- [ ] All 58 test files pass
- [ ] No source file exceeds 600 lines (run: `find apps packages -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -n | tail -20`)
- [ ] TypeScript `tsc --noEmit` passes across all packages
- [ ] Docker build succeeds end-to-end
