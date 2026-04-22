# Audit Engine Rework — Plan (P0 → P2)

> Status: plan. Reviewed by senior-engineer audit on **2026-04-22**. Updated
> once per phase as work lands.

---

## 0. TL;DR

The Master Data audit engine shipped, but a senior-engineer pass found four
load-bearing gaps that make the product partially non-functional today:

1. **Email is read from the workbook, not the Manager Directory.** Master
   Data exports have no email column, so every Master Data issue gets
   `email=""`, which makes notifications hard-fail at compose.
2. **The "function separation" is skin-deep.** 4 of 5 function engines
   wrap the same effort rules. `AuditRule` has no `functionId` column.
   `AuditPolicy` is still one global effort blob. Routing ≠ ownership.
3. **Tracking UX has bulk compose + bulk resolve and nothing else.** No
   acknowledge, no snooze, no re-escalate, no SLA countdown on the row.
4. **Dead and duplicated code.** `projectStatusesJson` built twice inside
   tracking.service; directory delete leaves orphaned issue emails; the
   QGC Settings drawer is effort-only but still styled as "the" settings.

This document prioritises the fixes and defines what we throw away.

---

## 1. Honest architectural audit

### 1.1 Per-function audit engines — **partial**

| Function            | Today                                                | Truth            |
| ------------------- | ---------------------------------------------------- | ---------------- |
| master-data         | Dedicated engine, 10 required-field rules + Others   | Real             |
| over-planning       | Wraps legacy `runAudit()` (effort rules)             | Legacy           |
| missing-plan        | Wraps legacy `runAudit()`                            | Placeholder      |
| function-rate       | Wraps legacy `runAudit()`                            | Placeholder      |
| internal-cost-rate  | Wraps legacy `runAudit()`                            | Placeholder      |

Dispatcher routes by `functionId`, but 4 of 5 engines resolve to the same
implementation. Fix: keep Master Data as-is, promote over-planning to its
own module, and add explicit "no rules configured" state for the other 3
until the business owners define them.

### 1.2 Rule catalog — **not function-scoped**

`AuditRule` schema (`apps/api/prisma/schema.prisma:299-311`) has no
`functionId` column. All rules sit in the same table; rule isolation is
achieved only in TypeScript. An engine could technically emit an issue
with another function's `ruleCode` and nothing in the DB would stop it.

### 1.3 AuditPolicy — **single effort blob**

`AuditPolicy` (`packages/domain/src/types.ts:20-34`) stores effort
thresholds as a flat object on `Process.auditPolicy`. Master Data doesn't
use any of them. Future engines will have nothing clean to extend.

### 1.4 Manager Directory → email — **not wired**

- `AuditIssue.email` is sourced from the workbook row at
  `packages/domain/src/auditEngine.ts:263` (`EMAIL_FIELDS = ['email',
  'Email', 'Manager Email', 'Project Manager Email']`).
- No server-side lookup in `ManagerDirectory` exists anywhere in the audit
  or notification path.
- `ManagerDirectory` already has the primitives (`normalizeManagerKey`,
  alias matching) needed to resolve `"Wagner, Anna"` or `"Anna Wagner"`
  to a single row. They're just not called.

**Consequence:** Master Data files never carry email → every Master Data
issue's email is empty → `tracking-compose.service.ts:193` throws on
send. This is a blocker.

### 1.5 Notifications — **DB-only, no delivery**

`in-app-notifications.service.ts` writes `ActivityLog` rows. There is no
email/Teams/Slack delivery behind any of the in-app notifications. The
SLA engine (`sla-engine.service.ts`) fires every 15 min and transitions
tracking stages correctly, so escalation logic works — just not delivery.

### 1.6 Tracking UI — **too read-only**

`EscalationCenter` + `ManagerTable` today:
- Select rows → compose → send (bulk).
- Select rows → mark resolved (bulk).
- No bulk acknowledge. No snooze. No manual re-escalate. No visible SLA
  countdown on the row. No "missing email" chip.

### 1.7 Dead / duplicated / risky code

- `tracking.service.ts:126-164` and `:199-227` construct the same
  `projectStatusesJson` twice with copy-pasted field maps.
- `DirectoryService.deleteManager()` (line 458-467) checks `TrackingEntry`
  refs but **not** `AuditIssue.email`. Deleting a manager leaves emails
  on issues pointing at an entity that no longer exists.
- `QGC Settings` drawer in `AuditResultsTab.tsx` exists for every
  function even though its fields only apply to effort. We hid the
  button for Master Data; we should do the same for the 3 unbuilt
  functions until they have real policies.
- `AUDIT_RULE_CATALOG` in `auditRules.ts` now concats effort + master-data
  rules by literal spread. Once we add a `functionId` column, this should
  become a per-function registry keyed in code, not a flat array.

---

## 2. Phased plan

### Phase 0 — P0 blockers (this PR)

1. **Directory email resolution in audit pipeline.**
   `audits.service.ts` → after `runFunctionAudit()`, walk the issues and
   for each `projectManager`:
   - normalise via `normalizeObservedManagerLabel`,
   - match against `ManagerDirectory` (scoped by tenantId),
   - write the resolved email onto the `AuditIssue.email` column.

   Applies to **every function**, not just Master Data. Over-planning
   files that happen to have an email column keep the workbook value if
   directory lookup fails — directory is preferred source, workbook is
   fallback. No match + no workbook email → issue persists with
   `email=""` and a flag on the run summary.

2. **Fail-soft composer.**
   `tracking-compose.service.ts:193` currently throws `BadRequestException`.
   Replace with:
   - Skip the entry, don't throw.
   - Response payload lists `{ skipped: [{key, reason: 'missing_email'}] }`.
   - UI shows an amber "Missing email" chip next to the row and a link
     "Add to directory" that opens the directory modal pre-filled with
     the observed name.

### Phase 1 — P1 real separation (next PR)

3. **`AuditRule.functionId` column.**
   Migration adds `functionId TEXT NOT NULL DEFAULT 'over-planning'`
   with FK to `SystemFunction(id)`. Backfill:
   - `RUL-MD-*` → `master-data`
   - `RUL-EFFORT-*`, `RUL-MGR-*`, `RUL-STATE-*` → `over-planning`

   `RulesService` and the seed script write the column from the catalog
   entry. `AUDIT_RULE_CATALOG` becomes a per-function registry:

   ```ts
   const RULE_CATALOG_BY_FUNCTION: Record<FunctionId, RuleCatalogEntry[]> = {
     'master-data':        MASTER_DATA_RULE_CATALOG,
     'over-planning':      OVER_PLANNING_RULE_CATALOG,
     'missing-plan':       [],
     'function-rate':      [],
     'internal-cost-rate': [],
   };
   ```

   Flat `AUDIT_RULE_CATALOG` stays as a compat export (derived from the
   map) so existing callers don't break.

4. **Per-function `AuditPolicy` shape.**
   New type:

   ```ts
   export interface FunctionPolicies {
     'over-planning': OverPlanningPolicy;   // existing effort thresholds
     'master-data':   MasterDataPolicy;     // required-columns toggles
     'missing-plan':  EmptyPolicy;
     'function-rate': EmptyPolicy;
     'internal-cost-rate': EmptyPolicy;
   }
   ```

   Stored under `Process.policies` (JSON). Read-time normaliser migrates
   legacy single-blob policies into `FunctionPolicies['over-planning']`.
   No breaking change at the storage layer.

5. **Promote over-planning to a real module.**
   Move the effort rules out of `packages/domain/src/auditEngine.ts` into
   `functions-audit/over-planning/` with the same structure as
   `master-data/`. `auditEngine.ts` keeps only shared plumbing
   (`createIssueKey`, `runAudit` shim for back-compat, CSV helpers).

### Phase 2 — P1 tracking UX (next PR)

6. **Bulk tracking actions.**
   Add to `ManagerTable` / `EscalationPanel`:
   - **Acknowledge** — bulk transition to ACKNOWLEDGED, logs event.
   - **Snooze N days** — bulk bump `slaDueAt` forward; logs reason.
   - **Re-escalate** — bulk transition back to SENT to force a new L-level.
   - Per-row SLA countdown (hours until `slaDueAt`).
   - "Missing email" chip from Phase 0.

7. **Kill the 'QGC Settings' misnomer.**
   Rename to "Audit Settings", gate fields by `functionId`, and show
   a clear empty state "No configurable thresholds for this function"
   for the 3 unbuilt functions.

### Phase 3 — P2 hygiene

8. **Dedupe tracking service** (`upsert` + `patchEntry` share helpers).
9. **Cascade directory deletes**: when a directory entry is hard-deleted,
   null-out the `email` on matching `AuditIssue` rows in the same
   transaction. Soft-delete (`active=false`) remains the default path.
10. **Remove `findingsByEngine.ts` re-exports that aren't consumed** after
    we ship per-function engines. Keep only the markdown helper that
    `tracking-compose` actually uses.
11. **Doc the 3 unbuilt engines' owners** so the placeholder state has a
    contact person.

---

## 3. What we're deliberately NOT doing

- No new ML/anomaly-detection rules. Stick to deterministic rules until
  we have 6 months of findings data.
- No real email/Slack/Teams delivery in this rework. That's a separate
  integration track.
- No GUI rule editor. YAML-style runtime config can come later — for now
  rules live in TypeScript where they can be type-checked and tested.
- No multi-tenant per-tenant ruleset yet. Current tenants share the
  catalog; per-tenant overrides become a `ProcessRuleOverride` table
  if and when customer demand appears.

---

## 4. Acceptance criteria per phase

### Phase 0 done when
- [ ] Master Data audit on the sample workbook produces issues whose
      `email` column is populated from the directory for every manager
      that exists in the directory.
- [ ] Composing a bulk notification with one missing-email row succeeds
      for the rest and reports the skipped row in the response.
- [ ] UI shows a "Missing email" chip on rows with empty email.
- [ ] New domain + API tests cover: happy-path match, case-insensitive
      match, missing match → empty email, workbook-email fallback.

### Phase 1 done when
- [ ] `AuditRule.functionId` is NOT NULL, every existing rule backfilled,
      new rule inserts enforce the FK.
- [ ] `Process.policies` is a JSON map keyed by functionId; legacy
      single-blob policies still load via the normaliser.
- [ ] Over-planning engine lives in `functions-audit/over-planning/` and
      the legacy `runAudit()` is a 3-line delegator.

### Phase 2 done when
- [ ] ManagerTable has bulk acknowledge / snooze / re-escalate, each
      emits a TrackingEvent and publishes an in-app notification.
- [ ] Each row renders "SLA due in 12h", "Overdue by 4h", or "—" when no
      SLA applies, based on `slaDueAt`.
- [ ] "QGC Settings" is renamed and gated by function.

### Phase 3 done when
- [ ] Tracking service has one code path for projectStatusesJson.
- [ ] Deleting a manager nulls out stale AuditIssue.email in the same tx.
- [ ] `npm run typecheck` + `npm test` across all packages stays green.

---

## 5. Rollout

Each phase is one PR. Phase 0 ships first (it's a bug-fix PR masquerading
as a feature). Phase 1 needs a migration + seed change — ship behind a
migration gate, rerun seed after deploy. Phase 2 is UI-only, safe to iterate
on a branch. Phase 3 is opportunistic cleanup and goes last so we don't
churn files we're still rewriting in Phase 1.
