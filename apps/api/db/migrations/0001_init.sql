-- =============================================================================
-- 0001_init.sql — consolidated SES baseline schema.
--
-- This file is the schema authority for SES. Apply it (then any
-- subsequent NNNN_*.sql migrations) against an empty Postgres database
-- to provision a fresh environment. The migration runner is at
-- `apps/api/db/runner.ts`.
--
-- Reference data (system functions, audit rule catalog, default tenant)
-- is NOT inserted here — it lives in db/seed.ts and runs idempotently.
--
-- Rollback: DROP SCHEMA "public" CASCADE; (destroys all data — only safe
-- on a fresh DB before any user data is inserted.)
-- =============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EscalationStage" AS ENUM ('NEW', 'DRAFTED', 'SENT', 'AWAITING_RESPONSE', 'RESPONDED', 'NO_RESPONSE', 'ESCALATED_L1', 'ESCALATED_L2', 'RESOLVED');

-- CreateTable
CREATE TABLE "IdentifierCounter" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentifierCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "ssoSubject" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'auditor',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "nextAuditDue" TIMESTAMP(3),
    "auditPolicy" JSONB NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "slaInitialHours" INTEGER NOT NULL DEFAULT 120,
    "createdById" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerDirectory" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemFunction" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemFunction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessFunction" (
    "processId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessFunction_pkey" PRIMARY KEY ("processId","functionId")
);

-- CreateTable
CREATE TABLE "FunctionAuditRequest" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunctionAuditRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessMember" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessMemberScopePermission" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "functionId" TEXT,
    "accessLevel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessMemberScopePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookFile" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL DEFAULT 'master-data',
    "name" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentSha256" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKind" TEXT NOT NULL,
    "parsedSheets" JSONB,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAuditedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'completed',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkbookFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileBlob" (
    "fileId" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "WorkbookSheet" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "isSelected" BOOLEAN NOT NULL DEFAULT true,
    "headerRowIx" INTEGER,
    "rows" JSONB NOT NULL,
    "originalHeaders" JSONB,
    "normalizedHeaders" JSONB,

    CONSTRAINT "WorkbookSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "functionId" TEXT NOT NULL DEFAULT 'over-planning',
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultSeverity" TEXT NOT NULL,
    "isEnabledDefault" BOOLEAN NOT NULL DEFAULT true,
    "paramsSchema" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPilotRuleMeta" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "logic" JSONB NOT NULL,
    "flagMessage" TEXT NOT NULL DEFAULT '',
    "authoredById" TEXT NOT NULL,
    "sourcePrompt" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "llmModel" TEXT NOT NULL DEFAULT 'qwen2.5:7b',
    "llmRawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPilotRuleMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPilotSandboxSession" (
    "id" TEXT NOT NULL,
    "authoredById" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "sheetName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPilotSandboxSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPilotAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ruleCode" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPilotAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "source" TEXT NOT NULL DEFAULT 'inline',
    "policySnapshot" JSONB NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "scannedRows" INTEGER NOT NULL DEFAULT 0,
    "flaggedRows" INTEGER NOT NULL DEFAULT 0,
    "findingsHash" TEXT NOT NULL DEFAULT '',
    "summary" JSONB NOT NULL,
    "ranById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedVersion" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionName" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditIssue" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "projectNo" TEXT,
    "projectName" TEXT,
    "sheetName" TEXT,
    "projectManager" TEXT,
    "projectState" TEXT,
    "effort" DOUBLE PRECISION,
    "severity" TEXT NOT NULL,
    "reason" TEXT,
    "thresholdLabel" TEXT,
    "recommendedAction" TEXT,
    "email" TEXT,
    "rowIndex" INTEGER,
    "missingMonths" JSONB,
    "zeroMonthCount" INTEGER,

    CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueCorrection" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "correctedEffort" DOUBLE PRECISION,
    "correctedState" TEXT,
    "correctedManager" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IssueCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAcknowledgment" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IssueAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEntry" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "managerKey" TEXT NOT NULL,
    "managerName" TEXT NOT NULL,
    "managerEmail" TEXT,
    "stage" "EscalationStage" NOT NULL DEFAULT 'NEW',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "outlookCount" INTEGER NOT NULL DEFAULT 0,
    "teamsCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "slaDueAt" TIMESTAMP(3),
    "projectStatuses" JSONB,
    "composeDraft" JSONB,
    "draftLockUserId" TEXT,
    "draftLockExpiresAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingStageComment" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "trackingEntryId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingStageComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingAttachment" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "trackingEntryId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrackingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'contact',
    "channel" TEXT NOT NULL,
    "note" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "triggeredById" TEXT,
    "requestId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComposerNotificationTemplate" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComposerNotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "parentId" TEXT,
    "stage" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "trackingId" TEXT,
    "templateId" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "processId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityCode" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "traceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT,
    "auditRunId" TEXT,
    "savedVersionId" TEXT,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestId" TEXT,
    "status" TEXT NOT NULL,
    "fileSha256" BYTEA,
    "sizeBytes" INTEGER,
    "content" BYTEA,
    "contentType" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "processId" TEXT,
    "requestId" TEXT,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastProcessId" TEXT,
    "defaultTab" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "scopes" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT,
    "url" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "signingSecret" BYTEA NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "socketId" TEXT NOT NULL,
    "currentTab" TEXT,
    "currentFocus" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedLink" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "issueKey" TEXT,
    "trackingId" TEXT,
    "managerEmail" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "singleUse" BOOLEAN NOT NULL DEFAULT true,
    "usedAt" TIMESTAMP(3),
    "usedFromIp" TEXT,
    "usedUserAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "trackingEntryId" TEXT,
    "managerEmail" TEXT NOT NULL,
    "managerName" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyPreview" TEXT NOT NULL,
    "resolvedBody" TEXT,
    "sources" JSONB,
    "severity" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "authorNote" TEXT NOT NULL DEFAULT '',
    "deadlineAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentifierCounter_prefix_scopeKey_year_key" ON "IdentifierCounter"("prefix", "scopeKey", "year");

-- CreateIndex
CREATE UNIQUE INDEX "User_displayCode_key" ON "User"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoSubject_key" ON "User"("ssoSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Process_displayCode_key" ON "Process"("displayCode");

-- CreateIndex
CREATE INDEX "Process_tenantId_idx" ON "Process"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerDirectory_displayCode_key" ON "ManagerDirectory"("displayCode");

-- CreateIndex
CREATE INDEX "ManagerDirectory_tenantId_normalizedKey_idx" ON "ManagerDirectory"("tenantId", "normalizedKey");

-- CreateIndex
CREATE INDEX "ManagerDirectory_tenantId_active_idx" ON "ManagerDirectory"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerDirectory_tenantId_email_key" ON "ManagerDirectory"("tenantId", "email");

-- CreateIndex
CREATE INDEX "ProcessFunction_processId_idx" ON "ProcessFunction"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "FunctionAuditRequest_displayCode_key" ON "FunctionAuditRequest"("displayCode");

-- CreateIndex
CREATE INDEX "FunctionAuditRequest_processId_createdAt_idx" ON "FunctionAuditRequest"("processId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessMember_displayCode_key" ON "ProcessMember"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessMember_processId_userId_key" ON "ProcessMember"("processId", "userId");

-- CreateIndex
CREATE INDEX "ProcessMemberScopePermission_processId_idx" ON "ProcessMemberScopePermission"("processId");

-- CreateIndex
CREATE INDEX "ProcessMemberScopePermission_memberId_idx" ON "ProcessMemberScopePermission"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessMemberScopePermission_memberId_scopeType_functionId_key" ON "ProcessMemberScopePermission"("memberId", "scopeType", "functionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookFile_displayCode_key" ON "WorkbookFile"("displayCode");

-- CreateIndex
CREATE INDEX "WorkbookFile_processId_idx" ON "WorkbookFile"("processId");

-- CreateIndex
CREATE INDEX "WorkbookFile_processId_functionId_idx" ON "WorkbookFile"("processId", "functionId");

-- CreateIndex
CREATE INDEX "FileVersion_fileId_idx" ON "FileVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_versionNumber_key" ON "FileVersion"("fileId", "versionNumber");

-- CreateIndex
CREATE INDEX "FileDraft_processId_functionId_idx" ON "FileDraft"("processId", "functionId");

-- CreateIndex
CREATE UNIQUE INDEX "FileDraft_userId_processId_functionId_key" ON "FileDraft"("userId", "processId", "functionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookSheet_displayCode_key" ON "WorkbookSheet"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookSheet_fileId_sheetName_key" ON "WorkbookSheet"("fileId", "sheetName");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRule_ruleCode_key" ON "AuditRule"("ruleCode");

-- CreateIndex
CREATE INDEX "AuditRule_functionId_idx" ON "AuditRule"("functionId");

-- CreateIndex
CREATE INDEX "AuditRule_source_status_idx" ON "AuditRule"("source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiPilotRuleMeta_ruleCode_key" ON "AiPilotRuleMeta"("ruleCode");

-- CreateIndex
CREATE INDEX "AiPilotRuleMeta_authoredById_idx" ON "AiPilotRuleMeta"("authoredById");

-- CreateIndex
CREATE INDEX "AiPilotRuleMeta_sourceSessionId_idx" ON "AiPilotRuleMeta"("sourceSessionId");

-- CreateIndex
CREATE INDEX "AiPilotSandboxSession_authoredById_idx" ON "AiPilotSandboxSession"("authoredById");

-- CreateIndex
CREATE INDEX "AiPilotSandboxSession_expiresAt_idx" ON "AiPilotSandboxSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_actorId_idx" ON "AiPilotAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_ruleCode_idx" ON "AiPilotAuditLog"("ruleCode");

-- CreateIndex
CREATE INDEX "AiPilotAuditLog_createdAt_idx" ON "AiPilotAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRun_displayCode_key" ON "AuditRun"("displayCode");

-- CreateIndex
CREATE INDEX "AuditRun_processId_idx" ON "AuditRun"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedVersion_displayCode_key" ON "SavedVersion"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "SavedVersion_processId_versionNumber_key" ON "SavedVersion"("processId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AuditIssue_displayCode_key" ON "AuditIssue"("displayCode");

-- CreateIndex
CREATE INDEX "AuditIssue_auditRunId_idx" ON "AuditIssue"("auditRunId");

-- CreateIndex
CREATE INDEX "AuditIssue_issueKey_idx" ON "AuditIssue"("issueKey");

-- CreateIndex
CREATE INDEX "AuditIssue_ruleCode_idx" ON "AuditIssue"("ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "IssueComment_displayCode_key" ON "IssueComment"("displayCode");

-- CreateIndex
CREATE INDEX "IssueComment_processId_issueKey_idx" ON "IssueComment"("processId", "issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueCorrection_displayCode_key" ON "IssueCorrection"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "IssueCorrection_processId_issueKey_key" ON "IssueCorrection"("processId", "issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAcknowledgment_displayCode_key" ON "IssueAcknowledgment"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAcknowledgment_processId_issueKey_key" ON "IssueAcknowledgment"("processId", "issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEntry_displayCode_key" ON "TrackingEntry"("displayCode");

-- CreateIndex
CREATE INDEX "TrackingEntry_processId_stage_slaDueAt_idx" ON "TrackingEntry"("processId", "stage", "slaDueAt");

-- CreateIndex
CREATE INDEX "TrackingEntry_processId_managerEmail_idx" ON "TrackingEntry"("processId", "managerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEntry_processId_managerKey_key" ON "TrackingEntry"("processId", "managerKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingStageComment_displayCode_key" ON "TrackingStageComment"("displayCode");

-- CreateIndex
CREATE INDEX "TrackingStageComment_trackingEntryId_stage_idx" ON "TrackingStageComment"("trackingEntryId", "stage");

-- CreateIndex
CREATE INDEX "TrackingStageComment_trackingEntryId_createdAt_idx" ON "TrackingStageComment"("trackingEntryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingAttachment_displayCode_key" ON "TrackingAttachment"("displayCode");

-- CreateIndex
CREATE INDEX "TrackingAttachment_trackingEntryId_idx" ON "TrackingAttachment"("trackingEntryId");

-- CreateIndex
CREATE INDEX "TrackingAttachment_trackingEntryId_deletedAt_idx" ON "TrackingAttachment"("trackingEntryId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_displayCode_key" ON "TrackingEvent"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "ComposerNotificationTemplate_displayCode_key" ON "ComposerNotificationTemplate"("displayCode");

-- CreateIndex
CREATE INDEX "NotificationTemplate_tenantId_stage_active_idx" ON "NotificationTemplate"("tenantId", "stage", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_displayCode_key" ON "Notification"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_displayCode_key" ON "ActivityLog"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "Export_displayCode_key" ON "Export"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "Job_displayCode_key" ON "Job"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_displayCode_key" ON "ApiToken"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_displayCode_key" ON "WebhookEndpoint"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_displayCode_key" ON "LiveSession"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "SignedLink_displayCode_key" ON "SignedLink"("displayCode");

-- CreateIndex
CREATE INDEX "SignedLink_processId_idx" ON "SignedLink"("processId");

-- CreateIndex
CREATE INDEX "SignedLink_issueKey_idx" ON "SignedLink"("issueKey");

-- CreateIndex
CREATE INDEX "SignedLink_expiresAt_idx" ON "SignedLink"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_displayCode_key" ON "notification_log"("displayCode");

-- CreateIndex
CREATE INDEX "notification_log_processId_sentAt_idx" ON "notification_log"("processId", "sentAt");

-- CreateIndex
CREATE INDEX "notification_log_managerEmail_sentAt_idx" ON "notification_log"("managerEmail", "sentAt");

-- CreateIndex
CREATE INDEX "notification_log_trackingEntryId_idx" ON "notification_log"("trackingEntryId");

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerDirectory" ADD CONSTRAINT "ManagerDirectory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerDirectory" ADD CONSTRAINT "ManagerDirectory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFunction" ADD CONSTRAINT "ProcessFunction_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFunction" ADD CONSTRAINT "ProcessFunction_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionAuditRequest" ADD CONSTRAINT "FunctionAuditRequest_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMember" ADD CONSTRAINT "ProcessMember_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMember" ADD CONSTRAINT "ProcessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMemberScopePermission" ADD CONSTRAINT "ProcessMemberScopePermission_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMemberScopePermission" ADD CONSTRAINT "ProcessMemberScopePermission_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProcessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMemberScopePermission" ADD CONSTRAINT "ProcessMemberScopePermission_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileBlob" ADD CONSTRAINT "FileBlob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDraft" ADD CONSTRAINT "FileDraft_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookSheet" ADD CONSTRAINT "WorkbookSheet_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRule" ADD CONSTRAINT "AuditRule_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_ruleCode_fkey" FOREIGN KEY ("ruleCode") REFERENCES "AuditRule"("ruleCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_authoredById_fkey" FOREIGN KEY ("authoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotRuleMeta" ADD CONSTRAINT "AiPilotRuleMeta_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "AiPilotSandboxSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotSandboxSession" ADD CONSTRAINT "AiPilotSandboxSession_authoredById_fkey" FOREIGN KEY ("authoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotSandboxSession" ADD CONSTRAINT "AiPilotSandboxSession_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "SystemFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPilotAuditLog" ADD CONSTRAINT "AiPilotAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRun" ADD CONSTRAINT "AuditRun_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRun" ADD CONSTRAINT "AuditRun_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRun" ADD CONSTRAINT "AuditRun_ranById_fkey" FOREIGN KEY ("ranById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedVersion" ADD CONSTRAINT "SavedVersion_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedVersion" ADD CONSTRAINT "SavedVersion_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedVersion" ADD CONSTRAINT "SavedVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_ruleCode_fkey" FOREIGN KEY ("ruleCode") REFERENCES "AuditRule"("ruleCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCorrection" ADD CONSTRAINT "IssueCorrection_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCorrection" ADD CONSTRAINT "IssueCorrection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAcknowledgment" ADD CONSTRAINT "IssueAcknowledgment_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAcknowledgment" ADD CONSTRAINT "IssueAcknowledgment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEntry" ADD CONSTRAINT "TrackingEntry_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEntry" ADD CONSTRAINT "TrackingEntry_draftLockUserId_fkey" FOREIGN KEY ("draftLockUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEntry" ADD CONSTRAINT "TrackingEntry_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStageComment" ADD CONSTRAINT "TrackingStageComment_trackingEntryId_fkey" FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStageComment" ADD CONSTRAINT "TrackingStageComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingAttachment" ADD CONSTRAINT "TrackingAttachment_trackingEntryId_fkey" FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingAttachment" ADD CONSTRAINT "TrackingAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComposerNotificationTemplate" ADD CONSTRAINT "ComposerNotificationTemplate_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComposerNotificationTemplate" ADD CONSTRAINT "ComposerNotificationTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "TrackingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ComposerNotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_savedVersionId_fkey" FOREIGN KEY ("savedVersionId") REFERENCES "SavedVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedLink" ADD CONSTRAINT "SignedLink_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedLink" ADD CONSTRAINT "SignedLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_trackingEntryId_fkey" FOREIGN KEY ("trackingEntryId") REFERENCES "TrackingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Tail: schema features (partial indexes, CHECK constraints) that the
-- consolidated baseline above cannot express directly. They are listed
-- here individually so a future schema reviewer can trace each back to
-- the original date-stamped migration that introduced them.
-- =============================================================================

-- From 20260426090000_add_process_member_scope_permissions:
-- Partial unique index for null-function rows (Postgres treats NULL as
-- distinct in standard unique indexes; this prevents duplicate
-- 'all-functions' or 'escalation-center' rows per member).
CREATE UNIQUE INDEX "ProcessMemberScopePermission_memberId_scopeType_null_function_key"
  ON "ProcessMemberScopePermission" ("memberId", "scopeType")
  WHERE "functionId" IS NULL;

-- From 20260426090000_add_process_member_scope_permissions:
-- Defensive CHECKs mirroring service-layer validation in
-- apps/api/src/common/access-scope.service.ts.
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
