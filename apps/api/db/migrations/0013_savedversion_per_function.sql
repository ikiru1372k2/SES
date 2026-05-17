-- Independent versioning per function.
--
-- Until now SavedVersion.versionNumber was a single per-process counter
-- (UNIQUE (processId, versionNumber)), so saving a version for one audit
-- function consumed numbers shared by every other function in the process.
-- This decouples the lifecycle: each (process, function) gets its own
-- 1..N sequence.
--
-- Migration strategy (no reset to v1 across the board):
--   1. Add functionId, derived from the version's audit run ->
--      workbook file -> functionId. Legacy rows whose file has no
--      functionId fall back to 'master-data' (the app's default function).
--   2. Drop the old per-process unique BEFORE renumbering, otherwise the
--      re-based per-function numbers collide on the old constraint.
--   3. Re-base each function's numbers to a contiguous 1..N preserving the
--      original chronological order (old versionNumber, then createdAt,
--      then displayCode as a stable tie-break). Relative order and history
--      are preserved; only the counter is re-scoped per function.
--   4. Add the new per-(process, function) unique + lookup index.

ALTER TABLE "SavedVersion" ADD COLUMN "functionId" TEXT;

UPDATE "SavedVersion" sv
SET "functionId" = COALESCE(wf."functionId", 'master-data')
FROM "AuditRun" ar
JOIN "WorkbookFile" wf ON wf."id" = ar."fileId"
WHERE ar."id" = sv."auditRunId";

UPDATE "SavedVersion" SET "functionId" = 'master-data' WHERE "functionId" IS NULL;

ALTER TABLE "SavedVersion" ALTER COLUMN "functionId" SET NOT NULL;

DROP INDEX IF EXISTS "SavedVersion_processId_versionNumber_key";

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "processId", "functionId"
      ORDER BY "versionNumber" ASC, "createdAt" ASC, "displayCode" ASC
    ) AS rn
  FROM "SavedVersion"
)
UPDATE "SavedVersion" sv
SET "versionNumber" = ranked.rn
FROM ranked
WHERE ranked."id" = sv."id";

CREATE UNIQUE INDEX "SavedVersion_processId_functionId_versionNumber_key"
  ON "SavedVersion" ("processId", "functionId", "versionNumber");

CREATE INDEX "SavedVersion_processId_functionId_idx"
  ON "SavedVersion" ("processId", "functionId");
