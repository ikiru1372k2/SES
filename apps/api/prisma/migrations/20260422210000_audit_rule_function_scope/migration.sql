-- Audit rules are now owned by exactly one function (master-data,
-- over-planning, etc.). Without this column the AuditRule table is a
-- shared pool and the "functions have separate rules" invariant lives
-- only in TypeScript. The column + FK makes the DB refuse to register
-- a rule under a function that doesn't exist.
--
-- Expand/contract safe: default = 'over-planning' so existing rows keep
-- resolving to the legacy effort engine until the seed migrates them.
-- Master Data rule codes (RUL-MD-*) are backfilled explicitly below.

ALTER TABLE "AuditRule"
    ADD COLUMN "functionId" TEXT NOT NULL DEFAULT 'over-planning';

UPDATE "AuditRule"
    SET "functionId" = 'master-data'
    WHERE "ruleCode" LIKE 'RUL-MD-%';

-- FK to SystemFunction so we can't insert a rule for a non-existent
-- function. ON UPDATE CASCADE keeps us safe if a function id is ever
-- renamed in the registry.
ALTER TABLE "AuditRule"
    ADD CONSTRAINT "AuditRule_functionId_fkey"
    FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "AuditRule_functionId_idx" ON "AuditRule"("functionId");
