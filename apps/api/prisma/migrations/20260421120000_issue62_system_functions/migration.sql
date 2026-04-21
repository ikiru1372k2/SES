-- Issue #62: system-defined function registry + process mapping + file scoping
-- Expand/contract safe: `functionId` is added with a default so existing rows
-- backfill to 'master-data' without requiring app changes first.

-- CreateTable: SystemFunction
CREATE TABLE "SystemFunction" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemFunction_pkey" PRIMARY KEY ("id")
);

-- Seed the 5 system functions. Idempotent via ON CONFLICT — the app also
-- seeds on boot so schema changes here do not drift from the registry.
INSERT INTO "SystemFunction" ("id", "label", "displayOrder", "isSystem", "createdAt", "updatedAt") VALUES
    ('master-data',        'Master Data',         1, true, NOW(), NOW()),
    ('over-planning',      'Over Planning',       2, true, NOW(), NOW()),
    ('missing-plan',       'Missing Plan',        3, true, NOW(), NOW()),
    ('function-rate',      'Function Rate',       4, true, NOW(), NOW()),
    ('internal-cost-rate', 'Internal Cost Rate',  5, true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- CreateTable: ProcessFunction
CREATE TABLE "ProcessFunction" (
    "processId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessFunction_pkey" PRIMARY KEY ("processId", "functionId")
);

CREATE INDEX "ProcessFunction_processId_idx" ON "ProcessFunction"("processId");

-- Seed all 5 functions for every existing process so old UIs continue to work.
INSERT INTO "ProcessFunction" ("processId", "functionId", "enabled", "createdAt", "updatedAt")
SELECT p."id", f."id", true, NOW(), NOW()
FROM "Process" p
CROSS JOIN "SystemFunction" f
ON CONFLICT ("processId", "functionId") DO NOTHING;

-- CreateTable: FunctionAuditRequest
CREATE TABLE "FunctionAuditRequest" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunctionAuditRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FunctionAuditRequest_displayCode_key" ON "FunctionAuditRequest"("displayCode");
CREATE INDEX "FunctionAuditRequest_processId_createdAt_idx" ON "FunctionAuditRequest"("processId", "createdAt");

-- AlterTable: WorkbookFile.functionId
ALTER TABLE "WorkbookFile" ADD COLUMN "functionId" TEXT NOT NULL DEFAULT 'master-data';
CREATE INDEX "WorkbookFile_processId_functionId_idx" ON "WorkbookFile"("processId", "functionId");

-- Foreign keys
ALTER TABLE "ProcessFunction" ADD CONSTRAINT "ProcessFunction_processId_fkey"
    FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessFunction" ADD CONSTRAINT "ProcessFunction_functionId_fkey"
    FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON UPDATE CASCADE;

ALTER TABLE "FunctionAuditRequest" ADD CONSTRAINT "FunctionAuditRequest_processId_fkey"
    FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_functionId_fkey"
    FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON UPDATE CASCADE;
