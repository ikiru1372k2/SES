-- =============================================================================
-- 0006_workbook_object_refs.sql
--
-- Add nullable pointers to `uploaded_object` on workbook tables so the
-- file bytes can live in MinIO/S3 instead of Postgres BYTEA. The legacy
-- BYTEA columns are kept readable (NOT NULL constraint dropped on
-- FileBlob.content) so existing rows continue to work via the legacy
-- fallback in files.repository.ts. New writes only set the object ref.
--
-- Bucket name lives on the `uploaded_object.bucket` row, so multi-bucket
-- routing (workbooks vs ai-pilot vs pdfs) needs no schema change.
--
-- Rollback:
--   ALTER TABLE "WorkbookFile" DROP COLUMN "uploadedObjectId";
--   ALTER TABLE "FileVersion" DROP COLUMN "uploadedObjectId";
--   ALTER TABLE "FileDraft"   DROP COLUMN "uploadedObjectId";
--   ALTER TABLE "FileBlob"    ALTER COLUMN "content" SET NOT NULL;
-- =============================================================================

ALTER TABLE "WorkbookFile"
  ADD COLUMN "uploadedObjectId" TEXT NULL,
  ADD CONSTRAINT "WorkbookFile_uploadedObjectId_fkey"
    FOREIGN KEY ("uploadedObjectId") REFERENCES "uploaded_object"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FileVersion"
  ADD COLUMN "uploadedObjectId" TEXT NULL,
  ADD CONSTRAINT "FileVersion_uploadedObjectId_fkey"
    FOREIGN KEY ("uploadedObjectId") REFERENCES "uploaded_object"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FileDraft"
  ADD COLUMN "uploadedObjectId" TEXT NULL,
  ADD CONSTRAINT "FileDraft_uploadedObjectId_fkey"
    FOREIGN KEY ("uploadedObjectId") REFERENCES "uploaded_object"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkbookFile_uploadedObjectId_idx"
  ON "WorkbookFile"("uploadedObjectId");
CREATE INDEX "FileVersion_uploadedObjectId_idx"
  ON "FileVersion"("uploadedObjectId");
CREATE INDEX "FileDraft_uploadedObjectId_idx"
  ON "FileDraft"("uploadedObjectId");

-- Allow new writes to skip BYTEA. Existing rows keep their bytes.
ALTER TABLE "FileBlob"    ALTER COLUMN "content" DROP NOT NULL;
ALTER TABLE "FileVersion" ALTER COLUMN "content" DROP NOT NULL;
ALTER TABLE "FileDraft"   ALTER COLUMN "content" DROP NOT NULL;
