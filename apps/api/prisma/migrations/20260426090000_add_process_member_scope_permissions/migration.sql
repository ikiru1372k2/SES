-- ProcessMemberScopePermission: optional per-(member, scope) overrides
-- layered on top of ProcessMember.permission. Absence of rows preserves
-- legacy behavior (member.permission applies process-wide).
CREATE TABLE "ProcessMemberScopePermission" (
  "id"          TEXT NOT NULL,
  "processId"   TEXT NOT NULL,
  "memberId"    TEXT NOT NULL,
  "scopeType"   TEXT NOT NULL,
  "functionId"  TEXT,
  "accessLevel" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcessMemberScopePermission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProcessMemberScopePermission"
  ADD CONSTRAINT "ProcessMemberScopePermission_processId_fkey"
    FOREIGN KEY ("processId")  REFERENCES "Process"("id")        ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcessMemberScopePermission_memberId_fkey"
    FOREIGN KEY ("memberId")   REFERENCES "ProcessMember"("id")  ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcessMemberScopePermission_functionId_fkey"
    FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard composite uniqueness (function rows have non-null functionId).
CREATE UNIQUE INDEX "ProcessMemberScopePermission_memberId_scopeType_functionId_key"
  ON "ProcessMemberScopePermission" ("memberId", "scopeType", "functionId");

-- Partial uniqueness for null-function rows (Postgres treats NULL as distinct
-- in standard unique indexes, so we need this to prevent duplicate
-- 'all-functions' or 'escalation-center' rows per member).
CREATE UNIQUE INDEX "ProcessMemberScopePermission_memberId_scopeType_null_function_key"
  ON "ProcessMemberScopePermission" ("memberId", "scopeType")
  WHERE "functionId" IS NULL;

CREATE INDEX "ProcessMemberScopePermission_processId_idx"
  ON "ProcessMemberScopePermission" ("processId");
CREATE INDEX "ProcessMemberScopePermission_memberId_idx"
  ON "ProcessMemberScopePermission" ("memberId");

-- Defensive CHECKs mirroring service-layer validation.
ALTER TABLE "ProcessMemberScopePermission"
  ADD CONSTRAINT "ProcessMemberScopePermission_function_scope_consistent" CHECK (
    ("scopeType" = 'function' AND "functionId" IS NOT NULL)
    OR ("scopeType" <> 'function' AND "functionId" IS NULL)
  ),
  ADD CONSTRAINT "ProcessMemberScopePermission_scopeType_enum" CHECK (
    "scopeType" IN ('all-functions', 'function', 'escalation-center')
  ),
  ADD CONSTRAINT "ProcessMemberScopePermission_accessLevel_enum" CHECK (
    "accessLevel" IN ('viewer', 'editor')
  );
