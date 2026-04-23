# Issue 1 — Autosave after audit, autosave on leave, live Escalation Center

**Type:** Enhancement
**Priority:** Medium
**Labels:** enhancement, backend, frontend

## Problem

Two things auditors keep getting burned by, both caused by state that isn't persisted or propagated when the auditor expects it to be.

### 1a. Audits don't save automatically

Today: auditor uploads a file → clicks Run Audit → findings appear → clicks "Open Escalation Center" → walks away. The `AuditRun` row is in the DB, but no `SavedVersion` is created until the auditor manually clicks **Save Version**. They often forget. When they re-open the process later or re-run on a new file, the previous audit state has no version anchoring it.

Expected: the act of running an audit implicitly saves a version. The manual **Save Version** button stays for cases where the auditor wants to tag a specific cycle with a name / notes.

Corner case: re-running the same audit on the same unchanged file shouldn't create a second version row. Same findings → same version, nothing new to save.

### 1b. Auditors want autosave on navigation / tab-close

Even mid-edit (a compose draft, an inline correction, a note being written), if the auditor navigates away or closes the tab we should persist what they have. Most of this already lives server-side via `composeDraft` + `correction` endpoints, but the frontend flushes those on explicit actions only (Save button, blur). Make the flush happen on:

- `visibilitychange` (tab hidden / switched).
- `beforeunload`.
- Route change away from the workspace or the escalation panel.

### 1c. Escalation Center doesn't reflect directory resolves without a hard refresh

Reproducer: resolved one manager in Master Data to the directory, confirmed the directory entry exists, went back to the Escalation Center — the "Missing email — Add to Directory" chip is still on that row. Only a full browser reload clears it.

The realtime gateway already emits `tracking.updated`, `notification.sent`, `audit.completed`, and `EscalationCenter.tsx` listens for those and invalidates `['escalations', processId]`. Gaps:

- **Directory mutations don't emit any realtime event.** Adding / updating / archiving / merging a manager in the directory silently updates the DB but never tells connected sessions.
- The amber banner (`unmapped` count) on the Escalation Center and the Workspace's Audit Results tab re-derives on query invalidation, but because no event fires, no invalidation happens.
- There's no **manual Refresh button** as a safety net when realtime hiccups (dropped websocket, browser throttle on a backgrounded tab).

## Proposed Solution

### Autosave-after-audit

- In `useAppStore.runAudit` (`apps/web/src/store/useAppStore.ts`), after the run completes successfully, call `saveVersion` with a generated name (`${process.name} — V${versions.length + 1}`) and empty notes.
- Add a `findingsHash` on `AuditRun` (Prisma + migration): stable hash of `(issues.length, sorted issueKeys + ruleCode + severity)`. Compute it server-side in `AuditsService.run`.
- The client, after a run, checks whether the newest version's `findingsHash` matches the run's `findingsHash`. If yes, skip creating a new version, toast "No new findings — same as v`N`". If no (or no prior version exists), create the version.
- The manual **Save Version** button keeps working; change its tooltip to "Manual save with a custom name — audits auto-save on run".

### Autosave-on-leave

- New web-side helper `useAutosaveOnLeave` that fires a passed callback on `visibilitychange` (document.hidden true), `beforeunload`, and when the React Router location changes away.
- Use it in three places: `Composer.tsx` (flush draft), `AuditResultsTab.tsx` (flush any in-progress inline correction), `EscalationCenter.tsx` (flush any selected-stage state to URL).

### Live directory updates + Refresh button

- Server: `DirectoryService` emits `directory.updated` on every mutation (add, update, archive, merge). Event payload includes the changed `normalizedKey`s so the client can know which rows to re-derive.
- Web: extend the realtime listener in `EscalationCenter.tsx` to also handle `directory.updated` and invalidate both the escalations query and any manager-directory query the page uses.
- Web: in `Workspace.tsx`, the `useEffect` that calls `directorySuggestions` becomes a React Query `useQuery` so the same `directory.updated` invalidation clears the amber banner automatically.
- Web: add a small **Refresh** icon button next to Broadcast in the Escalation Center header. Clicking it runs `q.refetch()` on the escalations query + invalidates the directory-suggestions key. This is a recovery lever, not the primary mechanism.

## Technical Tasks

- [ ] Add `AuditRun.findingsHash String @default("")` column + Prisma migration.
- [ ] `AuditsService.run` computes and stores the hash (stable, sorted, deterministic).
- [ ] `runAudit` in the store auto-saves a version unless the hash matches the latest version for the same file.
- [ ] `DirectoryService` emits `directory.updated` from all mutation paths (add, update, archive, merge).
- [ ] Register `directory.updated` in `realtime.gateway.ts`.
- [ ] `EscalationCenter.tsx` handles that event + renders a Refresh button in the header.
- [ ] `Workspace.tsx`'s unmapped-banner recomputes live on `directory.updated` (migrate the effect to `useQuery`).
- [ ] `useAutosaveOnLeave` hook flushes drafts / corrections on tab-hide / navigation / unload.
- [ ] Closing the tab mid-compose and reopening the page later restores the draft (verify existing path still works).
- [ ] Tooltip copy update on the Save Version button.

## Implementation Details

- File: `apps/api/prisma/schema.prisma` — add `findingsHash` column.
- File: `apps/api/src/audits.service.ts` — compute hash in `run()`.
- File: `apps/api/src/directory/directory.service.ts` — emit events on each mutation path.
- File: `apps/api/src/realtime/realtime.gateway.ts` — register `directory.updated`.
- File: `apps/web/src/store/useAppStore.ts` — auto-save inside `runAudit`.
- File: `apps/web/src/components/layout/TopBar.tsx` — Save Version tooltip copy.
- File: `apps/web/src/hooks/useAutosaveOnLeave.ts` — new hook.
- File: `apps/web/src/components/escalations/Composer.tsx` — wire autosave-on-leave.
- File: `apps/web/src/components/workspace/AuditResultsTab.tsx` — wire autosave-on-leave.
- File: `apps/web/src/pages/EscalationCenter.tsx` — handle `directory.updated` + Refresh button.
- File: `apps/web/src/pages/Workspace.tsx` — unmapped banner via `useQuery`.

## Code Sketch — `useAutosaveOnLeave`

```ts
// apps/web/src/hooks/useAutosaveOnLeave.ts
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function useAutosaveOnLeave(flush: () => void | Promise<void>) {
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const location = useLocation();
  const lastPath = useRef(location.pathname);

  useEffect(() => {
    const onVis = () => { if (document.hidden) void flushRef.current(); };
    const onBeforeUnload = () => { void flushRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (lastPath.current !== location.pathname) {
      void flushRef.current();
      lastPath.current = location.pathname;
    }
  }, [location.pathname]);
}
```

## Code Sketch — findings hash

```ts
// apps/api/src/audits.service.ts
import { createHash } from 'node:crypto';

function computeFindingsHash(issues: Array<{ key: string; ruleCode: string; severity: string }>) {
  const normalized = issues
    .map(i => `${i.key}|${i.ruleCode}|${i.severity}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(`${issues.length}\n${normalized}`).digest('hex');
}
```

## Database Changes

```sql
ALTER TABLE "AuditRun" ADD COLUMN "findingsHash" TEXT NOT NULL DEFAULT '';
```

## Acceptance Criteria

- [ ] Running an audit creates a `SavedVersion` automatically unless the `findingsHash` matches the latest version for the same source file.
- [ ] A toast "No new findings — same as v`N`" appears when dedup fires.
- [ ] Manual **Save Version** button still works; tooltip updated.
- [ ] Resolving a manager in Master Data clears the "Missing email" chip on the Escalation Center within 2 seconds, no reload required.
- [ ] The amber unmapped banner in Workspace updates live on directory mutations.
- [ ] A **Refresh** button exists in the Escalation Center header and forces a refetch.
- [ ] Closing the tab mid-compose preserves the draft on reopen.
- [ ] `visibilitychange`, `beforeunload`, and route change all trigger the autosave callbacks.

## Edge Cases

- Same file, same findings, second run → no new version, toast shown.
- Same file, findings differ only in order → hash treats as equal (sorted before hashing).
- Audit run fails partway → no auto-version created (no hash to compare against).
- Directory event arrives while the page is backgrounded → browsers may throttle; the Refresh button is the backstop.
- Websocket dropped → Refresh button + next realtime reconnect recovers state.

## Not in scope

- Making the `SavedVersion` row diff-able against prior versions.
- Email-reply detection.
