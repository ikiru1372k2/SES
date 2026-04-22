-- Issue #72: compose draft, soft lock, notification log audit fields, tracking event kind, process SLA default

ALTER TABLE "Process" ADD COLUMN "slaInitialHours" INTEGER NOT NULL DEFAULT 120;

ALTER TABLE "TrackingEntry" ADD COLUMN "composeDraft" JSONB;
ALTER TABLE "TrackingEntry" ADD COLUMN "draftLockUserId" TEXT;
ALTER TABLE "TrackingEntry" ADD COLUMN "draftLockExpiresAt" TIMESTAMP(3);

ALTER TABLE "TrackingEntry" ADD CONSTRAINT "TrackingEntry_draftLockUserId_fkey"
  FOREIGN KEY ("draftLockUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrackingEvent" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'contact';

ALTER TABLE "notification_log" ADD COLUMN "trackingEntryId" TEXT;
ALTER TABLE "notification_log" ADD COLUMN "resolvedBody" TEXT;
ALTER TABLE "notification_log" ADD COLUMN "sources" JSONB;

ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_trackingEntryId_fkey"
  FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notification_log_trackingEntryId_idx" ON "notification_log"("trackingEntryId");
