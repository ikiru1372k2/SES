-- Issue #76: auditor verification gate + per-stage commentary.

ALTER TABLE "TrackingEntry"
  ADD COLUMN "verifiedById" TEXT NULL,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ NULL;

ALTER TABLE "TrackingEntry"
  ADD CONSTRAINT "TrackingEntry_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX "TrackingEntry_verifiedAt_idx" ON "TrackingEntry" ("verifiedAt");

CREATE TABLE "TrackingStageComment" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "displayCode"     TEXT NOT NULL UNIQUE,
  "trackingEntryId" TEXT NOT NULL REFERENCES "TrackingEntry"("id") ON DELETE CASCADE,
  "stage"           TEXT NOT NULL,
  "authorId"        TEXT NOT NULL REFERENCES "User"("id"),
  "authorName"      TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "TrackingStageComment_trackingEntryId_stage_idx"
  ON "TrackingStageComment" ("trackingEntryId", "stage");

CREATE INDEX "TrackingStageComment_trackingEntryId_createdAt_idx"
  ON "TrackingStageComment" ("trackingEntryId", "createdAt");
