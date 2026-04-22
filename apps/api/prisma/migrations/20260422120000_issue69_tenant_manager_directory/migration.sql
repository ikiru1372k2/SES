-- Issue #69: Tenant, Process.tenantId, ManagerDirectory

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Tenant" ("id", "name", "createdAt", "updatedAt")
VALUES ('ses-tenant-default', 'Default organization', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Process" ADD COLUMN "tenantId" TEXT;

UPDATE "Process" SET "tenantId" = 'ses-tenant-default' WHERE "tenantId" IS NULL;

ALTER TABLE "Process" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "Process" ADD CONSTRAINT "Process_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Process_tenantId_idx" ON "Process"("tenantId");

CREATE TABLE "ManagerDirectory" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerDirectory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerDirectory_displayCode_key" ON "ManagerDirectory"("displayCode");

CREATE UNIQUE INDEX "ManagerDirectory_tenantId_email_key" ON "ManagerDirectory"("tenantId", "email");

CREATE INDEX "ManagerDirectory_tenantId_normalizedKey_idx" ON "ManagerDirectory"("tenantId", "normalizedKey");

CREATE INDEX "ManagerDirectory_tenantId_active_idx" ON "ManagerDirectory"("tenantId", "active");

ALTER TABLE "ManagerDirectory" ADD CONSTRAINT "ManagerDirectory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagerDirectory" ADD CONSTRAINT "ManagerDirectory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
