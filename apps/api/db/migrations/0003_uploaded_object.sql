-- =============================================================================
-- 0003_uploaded_object.sql — metadata for objects stored in S3-compatible
-- backends (MinIO local, AWS S3 prod). Raw bytes never live in Postgres.
--
-- One row per uploaded object. The bucket+object_key pair is the canonical
-- pointer; storage_provider/storage_endpoint identify which backend the
-- object lives on (so a future migration to a different bucket/region/
-- provider can be tracked per row).
--
-- Status lifecycle:
--   pending   — metadata reserved, upload in flight
--   uploaded  — object visible in storage, checksum verified
--   failed    — upload aborted; row kept for forensics
--   deleted   — soft-deleted; object removed from storage
--
-- Rollback: DROP TABLE "uploaded_object";
-- =============================================================================

CREATE TABLE "uploaded_object" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT,
  "ownerId"            TEXT,
  "bucket"             TEXT NOT NULL,
  "objectKey"          TEXT NOT NULL,
  "originalFileName"   TEXT NOT NULL,
  "contentType"        TEXT NOT NULL,
  "sizeBytes"          BIGINT NOT NULL,
  "checksumSha256"     TEXT NOT NULL,
  "storageProvider"    TEXT NOT NULL DEFAULT 's3',
  "storageEndpoint"    TEXT,
  "status"             TEXT NOT NULL,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "uploaded_object_status_chk"
    CHECK ("status" IN ('pending', 'uploaded', 'failed', 'deleted')),
  CONSTRAINT "uploaded_object_size_chk"
    CHECK ("sizeBytes" >= 0)
);

CREATE UNIQUE INDEX "uploaded_object_bucket_key_uniq"
  ON "uploaded_object" ("bucket", "objectKey");

CREATE INDEX "uploaded_object_tenantId_idx"
  ON "uploaded_object" ("tenantId");

CREATE INDEX "uploaded_object_ownerId_idx"
  ON "uploaded_object" ("ownerId");

CREATE INDEX "uploaded_object_checksum_idx"
  ON "uploaded_object" ("checksumSha256");

CREATE INDEX "uploaded_object_status_idx"
  ON "uploaded_object" ("status");

-- Auto-bump updatedAt on every UPDATE. Reusable per-table trigger fn —
-- if a shared set_updated_at() is added later, swap this for it.
CREATE OR REPLACE FUNCTION uploaded_object_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER uploaded_object_updated_at
  BEFORE UPDATE ON "uploaded_object"
  FOR EACH ROW EXECUTE FUNCTION uploaded_object_set_updated_at();
