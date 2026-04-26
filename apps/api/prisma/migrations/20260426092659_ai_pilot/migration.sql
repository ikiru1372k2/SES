-- DropForeignKey
ALTER TABLE "ProcessFunction" DROP CONSTRAINT "ProcessFunction_functionId_fkey";

-- DropForeignKey
ALTER TABLE "ProcessMemberScopePermission" DROP CONSTRAINT "ProcessMemberScopePermission_functionId_fkey";

-- DropForeignKey
ALTER TABLE "TrackingAttachment" DROP CONSTRAINT "TrackingAttachment_trackingEntryId_fkey";

-- DropForeignKey
ALTER TABLE "TrackingAttachment" DROP CONSTRAINT "TrackingAttachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "TrackingEntry" DROP CONSTRAINT "TrackingEntry_verifiedById_fkey";

-- DropForeignKey
ALTER TABLE "TrackingStageComment" DROP CONSTRAINT "TrackingStageComment_authorId_fkey";

-- DropForeignKey
ALTER TABLE "TrackingStageComment" DROP CONSTRAINT "TrackingStageComment_trackingEntryId_fkey";

-- DropForeignKey
ALTER TABLE "WorkbookFile" DROP CONSTRAINT "WorkbookFile_functionId_fkey";

-- DropIndex
DROP INDEX "TrackingEntry_verifiedAt_idx";

-- AlterTable
ALTER TABLE "AuditRule" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "TrackingAttachment" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingEntry" ALTER COLUMN "verifiedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingStageComment" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_log" ALTER COLUMN "deadlineAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiPilotRuleMeta" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "logic" JSONB NOT NULL,
    "flagMessage" TEXT NOT NULL DEFAULT '',
    "authoredById" TEXT NOT NULL,
    "sourcePrompt" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "llmModel" TEXT NOT NULL DEFAULT 'qwen2.5:7b',
    "llmRawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPilotRuleMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPilotSandboxSession" (
    "id" TEXT NOT NULL,
    "authoredById" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "sheetName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPilotSandboxSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPilotAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ruleCode" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPilotAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPilotRuleMeta_ruleCode_key" ON "AiPilotRuleMeta"("ruleCode");

-- CreateIndex
CREATE INDEX "AiPilotRuleMeta_authoredById_idx" ON "AiPilotRuleMeta"("authoredById");

-- CreateIndex
CREATE INDEX "AiPilotRuleMeta_sourceSessionId_idx" ON "AiPilotRuleMeta"("sourceSessionId");

-- CreateIndex
CREATE INDEX "AiPilotSandboxSession_authoredById_idx" ON "AiPilotSandboxSession"("authoredById");

-- CreateIndex
CREATE INDEX "AiPilotSandboxSession_expiresAt_idx" ON "AiPilotSandboxSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_actorId_idx" ON "AiPilotAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_ruleCode_idx" ON "AiPilotAuditLog"("ruleCode");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_createdAt_idx" ON "AiPilotAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditRule_source_status_idx" ON "AuditRule"("source", "status");

-- AddForeignKey
ALTER TABLE "ProcessFunction" ADD CONSTRAINT "ProcessFunction_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMemberScopePermission" ADD CONSTRAINT "ProcessMemberScopePermission_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_ruleCode_fkey" FOREIGN KEY ("ruleCode") REFERENCES "AuditRule"("ruleCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_authoredById_fkey" FOREIGN KEY ("authoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "AiPilotSandboxSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotSandboxSession" ADD CONSTRAINT "AiPilotSandboxSession_authoredById_fkey" FOREIGN KEY ("authoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotSandboxSession" ADD CONSTRAINT "AiPilotSandboxSession_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotAuditLog" ADD CONSTRAINT "AiPilotAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEntry" ADD CONSTRAINT "TrackingEntry_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStageComment" ADD CONSTRAINT "TrackingStageComment_trackingEntryId_fkey" FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStageComment" ADD CONSTRAINT "TrackingStageComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingAttachment" ADD CONSTRAINT "TrackingAttachment_trackingEntryId_fkey" FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingAttachment" ADD CONSTRAINT "TrackingAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
