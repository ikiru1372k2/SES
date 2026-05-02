-- =============================================================================
-- 0005_pdf_processing_jobs.sql — persistent state for the gRPC PDF pipeline.
--
-- Each row is one job's lifecycle: queued → running → (succeeded|failed|cancelled).
-- The sidecar progresses the row via the Nest API; the API never trusts the
-- sidecar for status — it confirms via gRPC GetJob before promoting state.
--
-- Idempotency: (idempotency_key) is unique. A retry with the same key returns
-- the existing job rather than creating a duplicate. Clients should derive
-- the key from (tenantId, objectKey, kind, optionsHash).
--
-- Object reference points at uploaded_object.id; cascade-delete on tenant/object
-- removal keeps history coherent without orphan rows.
--
-- Rollback: DROP TABLE "pdf_processing_job";
-- =============================================================================

CREATE TABLE "pdf_processing_job" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT,
  "requestedById"   TEXT,
  "idempotencyKey"  TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "uploadedObjectId" TEXT NOT NULL,
  "attempt"         INTEGER NOT NULL DEFAULT 0,
  "options"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result"          JSONB,
  "errorCode"       TEXT,
  "errorMessage"    TEXT,
  "startedAt"       TIMESTAMPTZ,
  "finishedAt"      TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pdf_processing_job_kind_chk"
    CHECK ("kind" IN ('extract', 'summarize')),
  CONSTRAINT "pdf_processing_job_status_chk"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX "pdf_processing_job_idempotency_key_uniq"
  ON "pdf_processing_job"("idempotencyKey");

CREATE INDEX "pdf_processing_job_tenant_status_idx"
  ON "pdf_processing_job"("tenantId", "status", "updatedAt" DESC);

CREATE INDEX "pdf_processing_job_object_idx"
  ON "pdf_processing_job"("uploadedObjectId");

CREATE INDEX "pdf_processing_job_status_updated_idx"
  ON "pdf_processing_job"("status", "updatedAt");

ALTER TABLE "pdf_processing_job"
  ADD CONSTRAINT "pdf_processing_job_uploadedObjectId_fkey"
    FOREIGN KEY ("uploadedObjectId") REFERENCES "uploaded_object"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION pdf_processing_job_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pdf_processing_job_updated_at
  BEFORE UPDATE ON "pdf_processing_job"
  FOR EACH ROW EXECUTE FUNCTION pdf_processing_job_set_updated_at();
