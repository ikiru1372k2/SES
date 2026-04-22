-- Issue #70: Composer template rename, EscalationStage, TrackingEvent payload, escalation NotificationTemplate

ALTER TABLE "NotificationTemplate" RENAME TO "ComposerNotificationTemplate";

ALTER TABLE "ComposerNotificationTemplate" RENAME CONSTRAINT "NotificationTemplate_pkey" TO "ComposerNotificationTemplate_pkey";

ALTER TABLE "ComposerNotificationTemplate" RENAME CONSTRAINT "NotificationTemplate_processId_fkey" TO "ComposerNotificationTemplate_processId_fkey";

ALTER TABLE "ComposerNotificationTemplate" RENAME CONSTRAINT "NotificationTemplate_ownerId_fkey" TO "ComposerNotificationTemplate_ownerId_fkey";

ALTER INDEX "NotificationTemplate_displayCode_key" RENAME TO "ComposerNotificationTemplate_displayCode_key";

CREATE TYPE "EscalationStage" AS ENUM (
  'NEW',
  'DRAFTED',
  'SENT',
  'AWAITING_RESPONSE',
  'RESPONDED',
  'NO_RESPONSE',
  'ESCALATED_L1',
  'ESCALATED_L2',
  'RESOLVED'
);

ALTER TABLE "TrackingEntry" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TrackingEntry" ADD COLUMN "stage_new" "EscalationStage";

UPDATE "TrackingEntry"
SET "stage_new" = CASE
  WHEN "resolved" THEN 'RESOLVED'::"EscalationStage"
  WHEN "stage" = 'Resolved' THEN 'RESOLVED'::"EscalationStage"
  WHEN "stage" = 'Manager acknowledged' THEN 'RESPONDED'::"EscalationStage"
  WHEN "stage" = 'Teams escalated' THEN 'ESCALATED_L1'::"EscalationStage"
  WHEN "stage" = 'Reminder 2 sent' THEN 'AWAITING_RESPONSE'::"EscalationStage"
  WHEN "stage" = 'Reminder 1 sent' THEN 'SENT'::"EscalationStage"
  WHEN "stage" = 'Not contacted' THEN 'NEW'::"EscalationStage"
  ELSE 'NEW'::"EscalationStage"
END;

ALTER TABLE "TrackingEntry" DROP COLUMN "stage";

ALTER TABLE "TrackingEntry" RENAME COLUMN "stage_new" TO "stage";

ALTER TABLE "TrackingEntry" ALTER COLUMN "stage" SET NOT NULL;

ALTER TABLE "TrackingEntry" ALTER COLUMN "stage" SET DEFAULT 'NEW'::"EscalationStage";

ALTER TABLE "TrackingEvent" ADD COLUMN "reason" TEXT;

ALTER TABLE "TrackingEvent" ADD COLUMN "payload" JSONB;

CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "parentId" TEXT,
    "stage" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationTemplate_tenantId_stage_active_idx" ON "NotificationTemplate"("tenantId", "stage", "active");

ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
