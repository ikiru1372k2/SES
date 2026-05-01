ALTER TABLE "AuditRule"
    ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "AuditRule_functionId_status_deletedAt_idx"
    ON "AuditRule"("functionId", "status", "deletedAt");
