-- Issue #74: stable identity for an audit run's issue set so the web
-- client can auto-save a version only when findings actually changed.
ALTER TABLE "AuditRun" ADD COLUMN "findingsHash" TEXT NOT NULL DEFAULT '';
