# Issue 2 — Preview-first Compose & Broadcast with `mailto:` / Teams handoff and channel gating

**Type:** Feature
**Priority:** High
**Labels:** feature, enhancement, backend, frontend

## Problem

The server-side SMTP send path (`apps/api/src/outbound/outbound-delivery.service.ts` → `nodemailer`) is a deployment blocker for most customer environments — they don't want to configure `SES_SMTP_URL` / `SES_TEAMS_INCOMING_WEBHOOK_URL`. And auditors want the email to appear in their *own* Sent Items so replies thread back to them.

The Composer and Broadcast dialogs also default to edit-view with blank fields. Auditors have to type, remember what variables exist, and often send before reviewing.

Keep the **logic simple.** The ask explicitly says: "use `mailto:`, just open, add increment, status activity update, no SMTP, no complex updates."

## Proposed Solution

### A. Replace SMTP with client-side handoff

On **Send** in Compose or Broadcast:

- **Email**: open `mailto:${to}?subject=${encodedSubject}&cc=${encodedCc}&body=${encodedBody}` in a new tab. OS hands it to Outlook / Apple Mail / whatever default mail client is configured.
- **Teams**: open `https://teams.microsoft.com/l/chat/0/0?users=${to}&message=${encodedMessage}` in a new tab. Teams web / desktop handles it.

Server still **records the intent**: create the `NotificationLog` row + `TrackingEvent`, increment `outlookCount` or `teamsCount` on `TrackingEntry`, emit `notification.sent` for live update. The send itself no longer happens server-side — the `OutboundDeliveryService.sendEscalation` becomes a no-op or is deleted, and `TrackingComposeService.send` just does the bookkeeping.

This simplifies deployment: no SMTP config needed, no Teams webhook needed. The auditor's own mail / Teams client does the actual send.

### B. Channel gating per tracking entry

Explicit rule from the auditor:

```
outlookCount = 0, teamsCount = 0  → Outlook button enabled, Teams disabled
outlookCount = 1, teamsCount = 0  → Outlook enabled (send the 2nd reminder), Teams still disabled
outlookCount = 2, teamsCount = 0  → Outlook disabled, Teams ENABLED (escalate to Teams)
outlookCount = 2, teamsCount = 1  → both disabled for this cycle; activity shows "ready to resolve or re-escalate manually"
```

Server enforces the same rule. Web mirrors it in the UI:

- Compose drawer shows two send buttons side-by-side: `[Outlook  ({{outlookCount}}/2)]` and `[Teams  ({{teamsCount}}/1)]`.
- When disabled, hover tooltip explains why ("Send Outlook first — Teams unlocks after 2 Outlook notifications").
- After Teams is sent once, both buttons turn grey with tooltip "Cycle complete — resolve the finding or re-escalate via the three-dot menu".

The three-dot menu on the manager row gets a **"Force re-escalate"** option that clears the counters (new `TrackingEvent` of kind `cycle_reset`) and re-enables the buttons. Admin-only.

### C. Preview-first Composer

- Composer opens in **Preview** tab by default (`useState('preview')`), not Edit.
- Preview pane renders: substituted subject, substituted body, resolved recipient email + CC, findings count, and a `dueDate` (see D below).
- An `Edit` toggle flips to the form view. Changes reflect live in a side-panel preview on wide screens.
- **Send** buttons live in the preview footer. Auditors can only send after reviewing what the manager will see.
- Auditor **note** field (freeform textarea) in the footer — saved to `NotificationLog.authorNote` (new column). Explains *why* this was sent; not shown to the manager.

### D. Deadline / due date

- Date picker in the Composer AND Broadcast dialogs. Defaults to +5 business days from send time.
- The picked date is passed into the template substitution as `{{dueDate}}`.
- Persisted on the `NotificationLog` row (new column `deadlineAt DateTime?`) so the Activity timeline can reference it.

### E. Canva-style Broadcast

- Same Edit/Preview tabs pattern as Composer.
- Preview uses one selected recipient as the example; a dropdown lets the auditor cycle through recipients to verify substitution per-person.
- Same channel selector (Email / Teams / Both).
- Batch handoff: for more than 5 recipients, open 5 tabs at a time with a "Open next 5" button. Avoids drowning the browser in popup-blocker warnings.

### F. Dashboard summary counts

On the process dashboard (tiles page), surface a compact strip:

```
4 managers notified · 6 escalated · 10 resolved
```

Each number is a link to `/processes/<pid>/escalations?filter=notified` / `?filter=escalated_l1` / `?filter=resolved`. Clicking a manager row from that filtered view opens the Escalation Center with that manager's panel pre-opened (extend the existing deep-link mechanism we built in the previous cycle).

## Technical Tasks

- [ ] `NotificationLog` gains `authorNote TEXT` and `deadlineAt TIMESTAMPTZ NULL` columns + migration.
- [ ] `TrackingComposeService.send` no longer calls `OutboundDeliveryService`; it only writes the log + event + counter + emits `notification.sent`.
- [ ] Server-side channel gate: `send` rejects with 409 if the requested channel violates the `outlook → outlook → teams` sequence.
- [ ] `OutboundDeliveryService` can stay as dead code or be removed; no env var required on startup.
- [ ] New `apps/web/src/lib/outbound/clientHandoff.ts` with `openMailto`, `openTeamsChat`.
- [ ] Composer defaults to preview mode; send buttons live in preview footer; Edit is a toggle.
- [ ] Both send buttons show counters (`Outlook 1/2`, `Teams 0/1`) and gate based on them.
- [ ] Auditor note + deadline date picker in both Composer and Broadcast.
- [ ] Dashboard summary counts render + link to filtered Escalation Center views.
- [ ] Deep-link from filtered list opens Escalation Center with that manager focused.
- [ ] Three-dot menu gains an admin-only "Force re-escalate" option that writes a `cycle_reset` event and zeroes counters.

## Implementation Details

- File: `apps/api/prisma/schema.prisma` — add `authorNote`, `deadlineAt`.
- File: `apps/api/src/tracking-compose/tracking-compose.service.ts` — skip SMTP, enforce channel gate, accept note + deadline.
- File: `apps/api/src/outbound/outbound-delivery.service.ts` — remove or stub.
- File: `apps/web/src/lib/outbound/clientHandoff.ts` — new.
- File: `apps/web/src/components/escalations/Composer.tsx` — preview-first, two send buttons, counters, note, deadline.
- File: `apps/web/src/components/escalations/BroadcastDialog.tsx` — same pattern + batched handoff.
- File: `apps/web/src/components/escalations/PreviewPane.tsx` — extend with deadline.
- File: `apps/web/src/pages/ProcessTiles.tsx` — dashboard summary counts + links.
- File: `apps/web/src/pages/EscalationCenter.tsx` — accept `?filter=` and `?manager=` params.

## Code Sketch — client handoff

```ts
// apps/web/src/lib/outbound/clientHandoff.ts
export function openMailto(opts: { to: string; cc?: string[]; subject: string; body: string }) {
  const qs = new URLSearchParams();
  qs.set('subject', opts.subject);
  qs.set('body', opts.body);
  if (opts.cc?.length) qs.set('cc', opts.cc.join(','));
  window.open(`mailto:${opts.to}?${qs.toString()}`, '_blank', 'noopener,noreferrer');
}

export function openTeamsChat(opts: { to: string; message: string }) {
  const url =
    `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(opts.to)}` +
    `&message=${encodeURIComponent(opts.message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
```

## Code Sketch — server-side channel gate

```ts
// apps/api/src/tracking-compose/tracking-compose.service.ts
function assertChannelAllowed(entry: { outlookCount: number; teamsCount: number }, channel: 'outlook' | 'teams') {
  if (channel === 'outlook' && entry.outlookCount >= 2) {
    throw new ConflictException('Outlook limit reached — escalate via Teams.');
  }
  if (channel === 'teams') {
    if (entry.outlookCount < 2) throw new ConflictException('Send two Outlook reminders before Teams.');
    if (entry.teamsCount >= 1) throw new ConflictException('Cycle complete — resolve or force re-escalate.');
  }
}
```

## Database Changes

```sql
ALTER TABLE "NotificationLog"
  ADD COLUMN "authorNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "deadlineAt" TIMESTAMPTZ NULL;
```

## Acceptance Criteria

- [ ] Sending email opens the user's default mail client via `mailto:` with subject/body/cc prefilled.
- [ ] Sending Teams opens the Teams deep-link with the recipient and prefilled message.
- [ ] No `SES_SMTP_URL` or `SES_TEAMS_INCOMING_WEBHOOK_URL` required to start the API.
- [ ] Server rejects 409 when the requested channel violates the 2-Outlook-then-1-Teams sequence.
- [ ] `NotificationLog` row is created on every handoff, including `authorNote` and `deadlineAt`.
- [ ] Counters (`outlookCount`, `teamsCount`) increment server-side.
- [ ] `notification.sent` event fires and updates all connected sessions live.
- [ ] Composer opens in Preview tab by default.
- [ ] Send buttons display current counter state (`Outlook 1/2`, `Teams 0/1`) and are disabled per the gate.
- [ ] Broadcast batches tab openings in groups of 5 for >5 recipients.
- [ ] Dashboard strip shows `notified · escalated · resolved` counts that deep-link to filtered views.
- [ ] Admin-only "Force re-escalate" resets counters and records a `cycle_reset` event.

## Edge Cases

- User has no default mail client → browser shows its own dialog; handoff still records intent.
- Popup blocker kills the window.open call → show inline toast with a copy-to-clipboard fallback.
- Multiple auditors press Send concurrently on the same entry → server-side counter is the source of truth; UI re-reads on `notification.sent`.
- Teams deep-link opens web if desktop not installed → acceptable behavior.
- "Force re-escalate" clicked by non-admin → server rejects 403.

## Not in scope

- Inbound email-reply detection.
- Calendar invites.
- HTML email (plain-text + substitution only; Outlook renders what it wants).
