-- =============================================================================
-- 0004_ai_pilot_session_uploaded_object.sql
--
-- Replaces in-Postgres BYTEA storage of AI Pilot sample files with a
-- pointer to an `uploaded_object` row. Keeps the old `fileBytes` column
-- around but makes it nullable so legacy rows still parse — new rows
-- write null bytes and rely on uploadedObjectId.
--
-- A future migration (after backfill of historical sessions) can drop
-- "fileBytes" entirely.
--
-- Rollback:
--   ALTER TABLE "AiPilotSandboxSession" DROP COLUMN "uploadedObjectId";
--   UPDATE "AiPilotSandboxSession" SET "fileBytes" = '\x00' WHERE "fileBytes" IS NULL;
--   ALTER TABLE "AiPilotSandboxSession" ALTER COLUMN "fileBytes" SET NOT NULL;
-- =============================================================================

ALTER TABLE "AiPilotSandboxSession"
  ADD COLUMN "uploadedObjectId" TEXT NULL,
  ALTER COLUMN "fileBytes" DROP NOT NULL;

ALTER TABLE "AiPilotSandboxSession"
  ADD CONSTRAINT "AiPilotSandboxSession_uploadedObjectId_fkey"
    FOREIGN KEY ("uploadedObjectId") REFERENCES "uploaded_object"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AiPilotSandboxSession_uploadedObjectId_idx"
  ON "AiPilotSandboxSession"("uploadedObjectId");
