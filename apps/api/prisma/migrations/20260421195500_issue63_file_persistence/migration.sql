-- Issue #63: split workbook BYTEA out of metadata rows, add file-scoped
-- versions, and add user/process/function drafts.

-- Workbook metadata columns. `state` is string-backed to stay compatible with
-- the rest of the schema, which currently uses strings for workflow states.
ALTER TABLE "WorkbookFile" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "WorkbookFile" ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- Raw current bytes live 1:1 beside WorkbookFile so metadata list queries
-- never transfer BYTEA.
CREATE TABLE "FileBlob" (
    "fileId" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("fileId")
);

-- Append-only file versions. This is intentionally separate from SavedVersion,
-- which versions audit runs rather than source files.
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "contentSha256" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileVersion_fileId_versionNumber_key" ON "FileVersion"("fileId", "versionNumber");
CREATE INDEX "FileVersion_fileId_idx" ON "FileVersion"("fileId");

-- One draft per user/process/function. Draft bytes are isolated from formal
-- versions until promoted.
CREATE TABLE "FileDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileDraft_userId_processId_functionId_key" ON "FileDraft"("userId", "processId", "functionId");
CREATE INDEX "FileDraft_processId_functionId_idx" ON "FileDraft"("processId", "functionId");

-- Backfill current blobs from the legacy nullable content column.
INSERT INTO "FileBlob" ("fileId", "content", "createdAt")
SELECT "id", "content", COALESCE("uploadedAt", CURRENT_TIMESTAMP)
FROM "WorkbookFile"
WHERE "content" IS NOT NULL
ON CONFLICT ("fileId") DO NOTHING;

-- Seed v1 for existing files. `id` is deterministic for idempotent deploy
-- retries; current code only requires uniqueness.
INSERT INTO "FileVersion" (
    "id",
    "fileId",
    "versionNumber",
    "content",
    "contentSha256",
    "sizeBytes",
    "note",
    "createdById",
    "createdAt"
)
SELECT
    'fv_' || "id" || '_1',
    "id",
    1,
    "content",
    "contentSha256",
    "sizeBytes",
    'Initial uploaded version',
    "uploadedById",
    COALESCE("uploadedAt", CURRENT_TIMESTAMP)
FROM "WorkbookFile"
WHERE "content" IS NOT NULL
ON CONFLICT ("fileId", "versionNumber") DO NOTHING;

ALTER TABLE "FileBlob" ADD CONSTRAINT "FileBlob_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_processId_fkey"
    FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_functionId_fkey"
    FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contract step: remove BYTEA from metadata rows after successful backfill.
ALTER TABLE "WorkbookFile" DROP COLUMN "content";
