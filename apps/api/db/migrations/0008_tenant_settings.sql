-- Add tenant-level settings for feature flags such as manager directory.
-- Rollback: ALTER TABLE "Tenant" DROP COLUMN "settings";

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}'::jsonb;
