-- =============================================================================
-- 0002_ai_pilot_jobs.sql — gRPC job tracking for the AI Pilot transport.
--
-- Persists every AI Pilot RPC (upload/generate/enhance) so retries can return
-- a cached result instead of re-calling the FastAPI sidecar, and so failures
-- can be inspected. The unique idempotency_key is the (sessionId, opType,
-- payloadHash) digest computed by the gRPC client.
--
-- Logs never include uploaded file bytes. `request` and `result` JSONB
-- store only metadata (columns, prompt, engine, sizes) — see
-- apps/api/src/ai-pilot/ai-grpc.client.ts.
--
-- Rollback: DROP TABLE "ai_pilot_job"; DELETE FROM "_schema_migrations"
--          WHERE version='0002_ai_pilot_jobs';
-- =============================================================================

CREATE TABLE "ai_pilot_job" (
  "id"              TEXT PRIMARY KEY,
  "idempotencyKey"  TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "opType"          TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "attempt"         INTEGER NOT NULL DEFAULT 0,
  "request"         JSONB NOT NULL,
  "result"          JSONB,
  "errorCode"       TEXT,
  "errorMessage"    TEXT,
  "startedAt"       TIMESTAMP(3),
  "finishedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_pilot_job_op_type_chk"
    CHECK ("opType" IN ('upload','generate','enhance')),
  CONSTRAINT "ai_pilot_job_status_chk"
    CHECK ("status" IN ('queued','running','succeeded','failed'))
);

CREATE UNIQUE INDEX "ai_pilot_job_idempotency_key_uniq"
  ON "ai_pilot_job"("idempotencyKey");

CREATE INDEX "ai_pilot_job_session_idx"
  ON "ai_pilot_job"("sessionId", "createdAt" DESC);

CREATE INDEX "ai_pilot_job_status_idx"
  ON "ai_pilot_job"("status", "updatedAt");

ALTER TABLE "ai_pilot_job"
  ADD CONSTRAINT "ai_pilot_job_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AiPilotSandboxSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
