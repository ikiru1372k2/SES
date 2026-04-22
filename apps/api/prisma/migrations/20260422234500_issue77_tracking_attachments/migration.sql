-- Issue #77: evidence attachments for TrackingEntry. Inline BYTEA (same
-- pattern WorkbookFile uses); capped at 10 MB per file / 20 per entry by
-- the service layer, not by the schema.
CREATE TABLE "TrackingAttachment" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "displayCode"     TEXT NOT NULL UNIQUE,
  "trackingEntryId" TEXT NOT NULL REFERENCES "TrackingEntry"("id") ON DELETE CASCADE,
  "uploadedById"    TEXT NOT NULL REFERENCES "User"("id"),
  "fileName"        TEXT NOT NULL,
  "mimeType"        TEXT NOT NULL,
  "sizeBytes"       INTEGER NOT NULL,
  "content"         BYTEA NOT NULL,
  "comment"         TEXT NOT NULL DEFAULT '',
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt"       TIMESTAMPTZ NULL
);

CREATE INDEX "TrackingAttachment_trackingEntryId_idx"
  ON "TrackingAttachment" ("trackingEntryId");

CREATE INDEX "TrackingAttachment_trackingEntryId_deletedAt_idx"
  ON "TrackingAttachment" ("trackingEntryId", "deletedAt");
