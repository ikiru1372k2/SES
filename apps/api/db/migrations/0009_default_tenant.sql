-- Provision the default tenant row that auth.service.ts and
-- escalation-templates.service.ts fall back to (DEFAULT_TENANT_ID =
-- 'ses-tenant-default'). Without this row, every fresh signup in prod
-- fails with "Default tenant is not provisioned" because the seeder
-- (which previously created it) is only wired into the demo overlay.
INSERT INTO "Tenant" ("id", "name", "updatedAt")
VALUES ('ses-tenant-default', 'Default organization', now())
ON CONFLICT ("id") DO NOTHING;
