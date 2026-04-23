# Issue 4 — Attachments tab: enable the disabled stub

**Type:** Feature
**Priority:** Medium
**Labels:** feature, enhancement, backend, frontend, database

## Problem

`EscalationPanel.tsx` has an Attachments tab that's permanently disabled with the stub text "Attachments will be available in a later release" (line 108). Auditors want it enabled so they can:

- Attach evidence (screenshots, forwarded emails from the manager, supporting policy docs, correction PDFs).
- Add an explanation comment to each attachment.
- Download later when compiling a report.

## Proposed Solution

### Schema

Reuse the inline-BYTEA pattern used by `WorkbookFile`. Attachments are small (screenshots, PDFs, Word docs), not large binaries.

```prisma
model TrackingAttachment {
  id              String        @id
  displayCode     String        @unique
  trackingEntryId String
  uploadedById    String
  fileName        String
  mimeType        String
  sizeBytes       Int
  content         Bytes                                    // inline storage
  comment         String        @default("")               // auditor's explanation, editable
  createdAt       DateTime      @default(now())
  deletedAt       DateTime?                                // soft-delete

  trackingEntry   TrackingEntry @relation(fields: [trackingEntryId], references: [id], onDelete: Cascade)
  uploadedBy      User          @relation(fields: [uploadedById], references: [id])

  @@index([trackingEntryId])
  @@index([trackingEntryId, deletedAt])
}
```

### Limits

- 10 MB per file.
- 20 attachments per tracking entry.
- Accept: `.pdf`, `.docx`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.txt`, `.eml`, `.msg`.
- Reject: `.exe`, `.bat`, `.sh`, `.ps1`, anything the server's mime sniffer doesn't match to the allow-list.

### API

All require `editor` permission on the process.

- `POST   /tracking/:idOrCode/attachments` — multipart/form-data, body field `comment`. Returns metadata.
- `GET    /tracking/:idOrCode/attachments` — list (metadata only, no `content`).
- `GET    /tracking/:idOrCode/attachments/:attIdOrCode/download` — streams with `Content-Disposition: attachment; filename=...`.
- `PATCH  /tracking/:idOrCode/attachments/:attIdOrCode` — body: `{ comment }` only. File content is immutable once uploaded.
- `DELETE /tracking/:idOrCode/attachments/:attIdOrCode` — soft-delete (sets `deletedAt`). Uploader or admin only.

All mutations emit `tracking.updated` so the tab refreshes live.

### UI

Replace the disabled stub (`EscalationPanel.tsx` lines 93, 107–109) with a new `AttachmentsTab.tsx`:

- Drop zone at the top, same style as the workspace FilesSidebar (consistency).
- Below: list of non-deleted attachments ordered newest-first.
- Each card: file icon by mime type, filename, size ("245 KB"), uploader name + timestamp, inline-editable comment, Download button, Delete button (uploader/admin only).
- Empty state: "No attachments yet. Drag files here or click to upload. Examples: screenshots of corrections, forwarded emails from the manager, supporting policy docs."

### Live updates

When another auditor uploads an attachment to the same tracking entry, this tab shows it without a refresh — the `tracking.updated` event invalidates the attachments query.

## Technical Tasks

- [ ] `TrackingAttachment` model + migration.
- [ ] `TrackingAttachmentsService` + `TrackingAttachmentsController` with all five endpoints.
- [ ] File-type validation (mime sniff, not just extension).
- [ ] Size + count limits with clear 409 / 413 responses.
- [ ] Authz: editor-only upload; uploader or admin for delete; any process member can list / download.
- [ ] Emits `tracking.updated` on each mutation.
- [ ] `EscalationPanel.tsx` tab no longer disabled; stub removed.
- [ ] New `AttachmentsTab.tsx` — drop zone + card list + inline comment editing.
- [ ] Download works via a normal browser link (server sets `Content-Disposition: attachment`).
- [ ] Soft-delete means the attachment disappears from list but stays in the DB (audit trail).

## Implementation Details

- File: `apps/api/prisma/schema.prisma` — new model + migration.
- File: `apps/api/src/tracking-attachments/tracking-attachments.service.ts` — new.
- File: `apps/api/src/tracking-attachments/tracking-attachments.controller.ts` — new.
- File: `apps/api/src/tracking-attachments/tracking-attachments.module.ts` — new.
- File: `apps/api/src/app.module.ts` — register module.
- File: `apps/web/src/lib/api/trackingAttachmentsApi.ts` — new.
- File: `apps/web/src/components/escalations/AttachmentsTab.tsx` — new.
- File: `apps/web/src/components/escalations/EscalationPanel.tsx` — un-disable, wire new tab.

## Code Sketch — upload endpoint

```ts
// apps/api/src/tracking-attachments/tracking-attachments.controller.ts
@Post(':idOrCode/attachments')
@UseInterceptors(FileInterceptor('file'))
async upload(
  @Param('idOrCode') idOrCode: string,
  @UploadedFile(new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),  // 10 MB
      new FileTypeValidator({
        fileType: /^(application\/pdf|application\/vnd\.openxmlformats.*|image\/(png|jpe?g)|text\/plain|message\/rfc822|application\/vnd\.ms-outlook)$/,
      }),
    ],
  })) file: Express.Multer.File,
  @Body('comment') comment: string,
  @CurrentUser() user: User,
) {
  return this.svc.create(idOrCode, user.id, file, comment ?? '');
}
```

## Code Sketch — service count guard

```ts
// apps/api/src/tracking-attachments/tracking-attachments.service.ts
async create(idOrCode: string, userId: string, file: Express.Multer.File, comment: string) {
  const entry = await this.resolveEntry(idOrCode);
  const active = await this.prisma.trackingAttachment.count({
    where: { trackingEntryId: entry.id, deletedAt: null },
  });
  if (active >= 20) throw new ConflictException('Attachment limit reached (20 per entry).');

  const att = await this.prisma.trackingAttachment.create({
    data: {
      id: createId(),
      displayCode: nextDisplayCode('TA'),
      trackingEntryId: entry.id,
      uploadedById: userId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      content: file.buffer,
      comment,
    },
  });
  this.events.emit('tracking.updated', { id: entry.id });
  const { content, ...meta } = att;
  return meta;
}
```

## Database Changes

```sql
CREATE TABLE "TrackingAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayCode" TEXT NOT NULL UNIQUE,
  "trackingEntryId" TEXT NOT NULL REFERENCES "TrackingEntry"("id") ON DELETE CASCADE,
  "uploadedById" TEXT NOT NULL REFERENCES "User"("id"),
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "content" BYTEA NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ NULL
);

CREATE INDEX "TrackingAttachment_trackingEntryId_idx"
  ON "TrackingAttachment" ("trackingEntryId");

CREATE INDEX "TrackingAttachment_trackingEntryId_deletedAt_idx"
  ON "TrackingAttachment" ("trackingEntryId", "deletedAt");
```

## Acceptance Criteria

- [ ] Attachments tab in `EscalationPanel.tsx` is enabled and no longer shows the "later release" stub.
- [ ] Drop zone accepts the allow-listed mime types and rejects everything else with a clear error.
- [ ] Files > 10 MB are rejected with 413 and a clear message.
- [ ] Entry with 20 active attachments blocks the 21st with 409.
- [ ] Upload, list, download, patch-comment, and soft-delete all work per the API spec.
- [ ] Download sets `Content-Disposition: attachment; filename=...`.
- [ ] Soft-deleted attachments disappear from list but remain in DB.
- [ ] Another auditor uploading to the same entry updates this tab live (via `tracking.updated`).
- [ ] Only uploader or admin can delete; editors can upload and patch comments; all process members can list / download.

## Edge Cases

- Filename has dangerous characters (quotes, newlines) → server sanitises before setting `Content-Disposition`.
- MIME sniff disagrees with extension (e.g., `.png` that is actually an HTML payload) → reject.
- Upload interrupted mid-transfer → row is never created; partial bytes discarded.
- Postgres row size limit approached (inline BYTEA) → with 10 MB × 20 max = 200 MB per entry; acceptable for first release. Revisit if customers exceed this in practice.
- Two auditors delete the same attachment concurrently → second delete is a no-op (row already has `deletedAt`).

## Not in scope

- Virus scanning.
- Inline preview of PDFs / images.
- External blob storage (S3).
- Attachments tied to a specific `TrackingEvent` (entry-scoped is enough for the first pass).
