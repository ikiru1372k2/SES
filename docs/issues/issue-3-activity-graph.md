# Issue 3 — Activity tab: step graph, live status, auditor verification gate

**Type:** Feature
**Priority:** Medium-High
**Labels:** feature, enhancement, backend, frontend, database

## Problem

`ActivityFeed.tsx` + `TrackingTimeline.tsx` today render a flat chronological list of events. That makes it hard to answer simple questions at a glance:

- What stage is this manager at?
- Has Outlook #1 been sent? Outlook #2? Teams?
- Did an auditor actually verify the resolution, or did the manager just say they did?
- Where should I leave a note saying "tried calling, no answer"?

Also related: auditors want a **verification gate**. When a manager marks something "resolved," the row shouldn't flip to green until an auditor explicitly clicks "Verified — resolve." If the auditor closes the tab without clicking Verified, the row auto-reverts to "review again" / "needs one-on-one follow-up."

## Proposed Solution

### Step graph at the top of the Activity tab

Render the escalation ladder as a horizontal sequence of nodes with green ticks on completed steps, a blue ring on the current step, and grey outlines on future steps. Nodes in order:

1. `Drafted` — a compose draft was saved.
2. `Outlook #1` — `outlookCount >= 1`.
3. `Outlook #2` — `outlookCount >= 2`.
4. `Teams escalation` — `teamsCount >= 1`.
5. `Manager responded` — manager acknowledged / replied (`RESPONDED` stage).
6. `Auditor verified` — the auditor clicked "Verified — resolve" (new explicit action).
7. `Resolved` — terminal green.

Between nodes, a short summary line: "sent 2026-04-22 10:03 by Kiran B · to arjun.kumar@demo.com".

### Per-step comment threads

Every node has a 💬 icon with comment count. Clicking a node (whether completed, current, or future) opens a panel with:

- The step's metadata (timestamp, actor, channel, duration since previous step).
- A comment thread scoped to `(trackingEntryId, stage)` pair.
- Text input to add a new comment (auditor notes: "tried calling, no answer" / "manager asked for extension" / "missing evidence, sent follow-up").

### Verification gate — resolved state requires an auditor click

- Add a `verifiedById String?` and `verifiedAt DateTime?` column to `TrackingEntry`.
- A row is "truly resolved" (green, out of the active list) only if both `stage === 'RESOLVED'` AND `verifiedAt` is set.
- If `stage === 'RESOLVED'` but `verifiedAt` is null, the row shows an orange "Awaiting auditor verification" badge and stays in the active list.
- A new button on the manager row: **Verified — Resolve**. Single click (no confirmation dialog). Sets `verifiedById` + `verifiedAt` and emits `tracking.updated`.
- If the auditor navigates away from the escalation with a Resolved-but-unverified row, no data is lost — the row just stays orange until verified.

### Live status updates

Every event affecting the timeline emits `tracking.updated` already. Extend:

- `tracking.stage_comment_added` (or fold into `tracking.updated` — either is fine, just be consistent).
- `tracking.verified` when an auditor verifies.

`ActivityFeed.tsx` already has `refetchInterval: 30_000` — the realtime path should be faster than that, so the interval becomes a backstop.

## Schema

```prisma
model TrackingStageComment {
  id              String          @id
  displayCode     String          @unique
  trackingEntryId String
  stage           String          // EscalationStage enum value; string to accept future stages
  authorId        String
  authorName      String          // denormalised for display when author is deleted
  body            String
  createdAt       DateTime        @default(now())

  trackingEntry   TrackingEntry   @relation(fields: [trackingEntryId], references: [id], onDelete: Cascade)
  author          User            @relation(fields: [authorId], references: [id])

  @@index([trackingEntryId, stage])
}

// And on TrackingEntry:
model TrackingEntry {
  // ...existing fields...
  verifiedById    String?
  verifiedAt      DateTime?
  verifiedBy      User? @relation("TrackingVerifier", fields: [verifiedById], references: [id])
}
```

## API

- `GET  /tracking/:idOrCode/stage-comments` — optional `?stage=SENT` filter.
- `POST /tracking/:idOrCode/stage-comments` — body: `{ stage, body }`.
- `POST /tracking/:idOrCode/verify` — auditor-only, sets `verifiedById` + `verifiedAt`, transitions to `RESOLVED` if not already.
- `DELETE /tracking/:idOrCode/verify` — revert verification (admin-only; rarely used).

All emit `tracking.updated` on mutation.

## Technical Tasks

- [ ] `TrackingStageComment` Prisma model + migration.
- [ ] `TrackingEntry.verifiedById` + `verifiedAt` columns + migration.
- [ ] Three new endpoints (list, create comment, verify) wired via a `TrackingStageController`.
- [ ] New `apps/web/src/components/escalations/StageGraph.tsx`.
- [ ] `ActivityFeed.tsx` renders `<StageGraph />` above the existing `<TrackingTimeline />`.
- [ ] Click on a stage node → side panel with comments + add-comment field.
- [ ] `TrackingTimeline.tsx` also gets a `💬 Add note` affordance on each event row (same per-stage thread).
- [ ] New `Verified — Resolve` button in the manager panel footer. Only visible when stage is or can transition to RESOLVED.
- [ ] Manager row in the table shows orange "Awaiting verification" pill when `stage === 'RESOLVED' && !verifiedAt`.
- [ ] Escalation Center list filter gains a `needs-verification` option.
- [ ] Keyboard shortcut `c` inside Activity tab focuses the comment input.

## Implementation Details

- File: `apps/api/prisma/schema.prisma` — new model + columns + migration.
- File: `apps/api/src/tracking-stage/tracking-stage.service.ts` — new.
- File: `apps/api/src/tracking-stage/tracking-stage.controller.ts` — new.
- File: `apps/web/src/lib/api/trackingStageApi.ts` — new.
- File: `apps/web/src/components/escalations/StageGraph.tsx` — new.
- File: `apps/web/src/components/escalations/ActivityFeed.tsx` — mount StageGraph.
- File: `apps/web/src/components/escalations/TrackingTimeline.tsx` — per-event note affordance.
- File: `apps/web/src/components/escalations/ManagerTable.tsx` — orange pill.
- File: `apps/web/src/components/escalations/EscalationPanel.tsx` — Verified button + wiring.
- File: `apps/web/src/pages/EscalationCenter.tsx` — `needs-verification` filter.

## Code Sketch — verify endpoint

```ts
// apps/api/src/tracking-stage/tracking-stage.service.ts
async verify(trackingEntryIdOrCode: string, userId: string) {
  const entry = await this.prisma.trackingEntry.update({
    where: { idOrDisplayCode: trackingEntryIdOrCode },
    data: {
      verifiedById: userId,
      verifiedAt: new Date(),
      stage: 'RESOLVED',
    },
  });
  this.events.emit('tracking.updated', { id: entry.id });
  return entry;
}
```

## Database Changes

```sql
ALTER TABLE "TrackingEntry"
  ADD COLUMN "verifiedById" TEXT NULL,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ NULL;

ALTER TABLE "TrackingEntry"
  ADD CONSTRAINT "TrackingEntry_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE TABLE "TrackingStageComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayCode" TEXT NOT NULL UNIQUE,
  "trackingEntryId" TEXT NOT NULL REFERENCES "TrackingEntry"("id") ON DELETE CASCADE,
  "stage" TEXT NOT NULL,
  "authorId" TEXT NOT NULL REFERENCES "User"("id"),
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "TrackingStageComment_trackingEntryId_stage_idx"
  ON "TrackingStageComment" ("trackingEntryId", "stage");
```

## Acceptance Criteria

- [ ] Activity tab shows a 7-node horizontal step graph above the timeline.
- [ ] Completed nodes are green ✓, current node has a blue ring, future nodes are grey.
- [ ] Clicking any node opens a side panel with metadata + comment thread for that stage.
- [ ] Adding a comment persists to `TrackingStageComment` and appears live on other sessions via `tracking.updated`.
- [ ] A manager row in `RESOLVED` stage with `verifiedAt == null` shows an orange "Awaiting verification" pill.
- [ ] Clicking **Verified — Resolve** (single click) sets `verifiedById` + `verifiedAt` and moves the row out of the active list.
- [ ] `needs-verification` filter option exists on the Escalation Center and filters to `stage='RESOLVED' AND verifiedAt IS NULL`.
- [ ] Keyboard `c` while on Activity tab focuses the comment input.
- [ ] Admin-only `DELETE /tracking/:id/verify` reverts verification.

## Edge Cases

- Two auditors verify the same entry concurrently → last write wins; both emit `tracking.updated`.
- Entry transitions directly from `DRAFT` to `RESOLVED` (unusual) → graph shows all intermediate nodes as skipped (grey dashed outline).
- User who wrote a comment is later deleted → `authorName` denormalised on the row preserves display.
- Stage enum gains a new value → graph falls back to ordering by `createdAt`; unknown stage shown as a generic node.

## Not in scope

- SLA breach annotations on the graph (those already live in `slaBreachingCount` — show them separately if wanted).
- Comment editing / deletion (append-only for audit trail; if the auditor needs to correct, they add a new comment).
- Threading replies on comments.
