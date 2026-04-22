# Cross-Function Notifications, Tracking & PM Issue Tracker — Plan

> Planning doc. Nothing implemented here. Pair with
> [AUDIT_ENGINE_REWORK.md](./AUDIT_ENGINE_REWORK.md).

## 1. What the user wants (plain language)

1. **One notification per manager, not N** — today if Wagner, Anna has flags
   in Over-Planning, Missing-Effort, and Master Data, she can receive three
   separate emails / Teams pings. She should receive **one** that bundles
   everything she owns.
2. **Keep the existing stage semantics** — the current "2 Outlook + 1 Teams
   → escalated → resolved / no-contact" ladder stays. It just runs against
   the *global* manager bucket, not a per-function bucket.
3. **Function-aware audit results UI** — after an audit run, the table must
   only show columns that make sense for that function. Example: Master
   Data has no `effort` column in its source sheet, so the results table
   should not render an empty Effort column. Same for filters.
4. **PM issue tracker** — each Project Manager should have a single "your
   issues to resolve" list aggregated across every function (and later,
   every process they own). Today this list only exists inside one
   escalation center view at a time.

## 2. What already works (no change needed)

Grepping the repo turned up that most of the data-model groundwork is done:

- `TrackingEntry` is keyed `@@unique([processId, managerKey])` in
  [schema.prisma](../apps/api/prisma/schema.prisma#L464) — **one row per
  manager per process, across all five functions**. There is no per-function
  tracking row. ✅
- [`tracking.service.ts`](../apps/api/src/tracking.service.ts#L142) upserts
  by `(processId, managerKey)` only — no function scope is ever applied. ✅
- [`escalations-aggregator.ts`](../apps/api/src/escalations-aggregator.ts#L69)
  groups issues by manager and attaches `countsByEngine` / `findingsByEngine`
  sub-objects so the payload already carries the per-function breakdown
  inside one manager row. ✅
- Per-function engine isolation is already live in
  [`packages/domain/src/functions-audit/`](../packages/domain/src/functions-audit/). ✅

**What this means:** the "one notification per manager" goal is mostly a
compose / send-path problem, not a schema problem. No migration is needed
for the core dedup.

## 3. Real gaps

### 3.1 Send path may still fan out per function

Need to verify by reading — **not assumed fixed**:

- [`apps/api/src/notifications/`](../apps/api/src/notifications/) — confirm
  `send` / `sendAll` / bulk compose paths group by `trackingEntry.id`
  (global) and not by `(trackingEntry.id, engine)`.
- [`apps/web/src/components/escalations/BulkComposer.tsx`] — confirm that
  when the user selects multiple manager rows and hits "send", the payload
  is one composed email per manager, not per `(manager, engine)` pair.
- `NotificationLog` currently stores one aggregate `issueCount` per send
  ([schema:695](../apps/api/prisma/schema.prisma#L695)). Add an optional
  `issueCountByFunction: Json` so we can render "Wagner received an email
  on 2026-04-22 covering 4 Over-Planning + 2 Master Data issues" without
  losing the existing aggregate field.

**If a fan-out is found:** fix is small — collapse the send loop to key on
`trackingEntry.id`, pass the full `findingsByEngine` breakdown into the
template renderer, and write one NotificationLog row.

### 3.2 Email / Teams template must section by function

Body layout should look like:

```
Hi Anna,

You have 6 open items across 2 functions:

  Over-Planning (4)
    • PRJ-90032101 — effort 920h > 900h threshold
    • PRJ-90032104 — On Hold but 250h logged
    ...

  Master Data (2)
    • PRJ-90032101 — End Customer Industry is blank
    • PRJ-90032101 — Project Product is "Undefined"

Resolve in the source system → re-run audit → items close.
```

Template primitive: `findingsByEngine: Record<FunctionId, AuditIssue[]>` is
already on the aggregator payload. The HTML / text builder in
[`packages/domain/src/notificationBuilder.ts`](../packages/domain/src/notificationBuilder.ts)
needs a loop over `FUNCTION_REGISTRY` that skips empty buckets. No schema
change.

### 3.3 Function-aware results columns & filters (hard UI bug)

Today [AuditResultsTab.tsx:37-46](../apps/web/src/components/workspace/AuditResultsTab.tsx#L37)
hard-codes nine headers including `projectState` and `effort`. For a
Master Data file these two cells render blank because the source sheet
doesn't have those columns and the engine sets them to `Unknown` / `0`.

**Fix approach** — per-function column registry in the domain package:

```ts
// packages/domain/src/functions-audit/columns-ui.ts
export const RESULT_TABLE_COLUMNS: Record<FunctionId, ResultColumnSpec[]> = {
  'master-data': [
    { key: 'severity',      label: 'Severity' },
    { key: 'projectNo',     label: 'Project No' },
    { key: 'projectName',   label: 'Project' },
    { key: 'projectManager',label: 'Manager' },
    { key: 'column',        label: 'Field' },         // which MD column failed
    { key: 'observedValue', label: 'Value' },
    { key: 'reason',        label: 'Issue' },
  ],
  'over-planning': [
    { key: 'severity',      label: 'Severity' },
    { key: 'projectNo',     label: 'Project No' },
    { key: 'projectName',   label: 'Project' },
    { key: 'projectManager',label: 'Manager' },
    { key: 'projectState',  label: 'State' },
    { key: 'effort',        label: 'Effort' },
    { key: 'reason',        label: 'Issue' },
  ],
  // 'missing-plan', 'function-rate', 'internal-cost-rate' — add when rules land
};
```

`AuditResultsTab` looks up the column spec by `file.functionId`, maps each
row's fields through `columnSpec[i].key`, and filters drop-downs also come
from the spec. Same idea applies to the category filter list — Master Data
only needs `Data Quality` and `Needs Review`; hiding `Overplanning` on MD
files removes dead UI.

Surfaces to touch:
- [`AuditResultsTab.tsx`](../apps/web/src/components/workspace/AuditResultsTab.tsx) — dynamic headers, dynamic filter options.
- [`FindingsTab.tsx`](../apps/web/src/components/escalations/FindingsTab.tsx) — per-engine section uses the same registry.
- Export / CSV: [`buildIssuesCsv`](../packages/domain/src/auditEngine.ts) → branch by functionId so the CSV also drops Effort/State for Master Data.
- Audited workbook writer: [`buildAuditedWorkbookBuffer`](../packages/domain/src/workbook.ts) — same.

Non-goal: changing the `AuditIssue` DB shape. Keep `effort` / `projectState`
nullable on the domain type and just don't render them when the function
doesn't use them.

### 3.4 PM issue tracker ("all my flags to solve")

Two flavours, pick scope:

- **Scope A — per-process PM tracker (small).** Each process view already
  knows which issues belong to the PM. Add a `?managerKey=<key>` filter to
  the escalations endpoint and a tab titled "My Issues" on the process
  workspace that lists them grouped by function.
- **Scope B — tenant-wide PM dashboard (bigger).** New endpoint
  `GET /managers/:managerKey/issues` that unions every open AuditIssue
  across every process in the tenant, groups by `(processId, functionId)`,
  and returns tracking stage + SLA status per process. New route
  `/my-issues` on the web. Useful when a PM owns projects in several
  processes.

**Recommendation:** ship Scope A first (1-2 days of work), then Scope B if
the business asks. Scope A reuses every existing service and only adds a
filter parameter and a UI panel.

### 3.5 Tracking stage semantics across functions

The existing stage ladder (`NEW → DRAFTED → SENT → AWAITING_RESPONSE →
RESPONDED / NO_RESPONSE → ESCALATED_L1 → ESCALATED_L2 → RESOLVED`) already
lives on the global-per-manager `TrackingEntry`. **No change to stages.**

One decision point: per-function resolution. If Wagner resolves her 4
Over-Planning items but her 2 Master Data items are still open, the
TrackingEntry cannot go to `RESOLVED`. Today `projectStatuses` is a JSON
blob on TrackingEntry — extend it to key by `(functionId, projectNo)` so
the UI can show "Over-Planning ✓ resolved, Master Data ⚠ 2 open" inside
a single manager row. No schema change (already Json). This is the
minimal way to support partial resolution without splitting the row.

## 4. Phased rollout

**Phase 1 — send-path dedup + template section (1 week)**
- Audit notifications service for any per-function fan-out; collapse if found.
- Update notification template to render `findingsByEngine` sections.
- Add `issueCountByFunction` JSON column to `NotificationLog`.
- Acceptance: one send per manager per bulk-compose click, email body shows
  sectioned findings.

**Phase 2 — function-aware UI (1 week)**
- Per-function column registry in domain.
- Wire `AuditResultsTab`, `FindingsTab`, CSV export, audited workbook export.
- Category / severity filter options driven by the registry.
- Acceptance: Master Data audit result never shows a blank Effort / State
  cell; filters only offer categories used by that function.

**Phase 3 — PM issue tracker (Scope A, 2-3 days)**
- `GET /processes/:id/escalations?managerKey=…` filter.
- "My Issues" tab on process workspace.
- Acceptance: a PM lands on the process and sees their own open items
  grouped by function, with stage + SLA.

**Phase 4 — partial resolution per function (2-3 days)**
- Extend `projectStatuses` JSON to key by `(functionId, projectNo)`.
- UI shows per-function resolution ticks inside one manager row.
- Acceptance: resolving every Over-Planning item for Wagner marks
  Over-Planning ✓ even while Master Data is still open; TrackingEntry
  goes to RESOLVED only when all functions are ✓.

**Phase 5 (optional) — tenant-wide PM dashboard (Scope B)**
- Only if business validates demand.

## 5. Explicit non-goals

- No schema change to `TrackingEntry`. It's already the right grain.
- No change to the per-function engine isolation in
  `packages/domain/src/functions-audit/`.
- No new escalation stages. Existing ladder covers this.
- No real-time push of cross-process issues (Phase 5 would revisit).

## 6. Open questions for you

1. Do PMs ever own projects across **multiple processes**, or is one PM
   always scoped to one process? This decides Scope A vs Scope B.
2. For partial resolution, if a PM replies via email to one function's
   findings only, should the stage advance to `RESPONDED` for the whole
   TrackingEntry, or only for that function? (I'd recommend whole-entry
   for stage, but mark the specific function findings as ACK'd.)
3. Notification body — Outlook / Teams / email, same sectioned layout
   across all channels, or different?
4. When a new function is added later (e.g. `function-rate`), do you
   want the email template to auto-discover it, or should each new
   function explicitly opt in?
