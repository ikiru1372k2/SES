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
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "ssoSubject" TEXT,
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
    "createdById" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "WorkbookFile" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentSha256" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKind" TEXT NOT NULL,
    "content" BYTEA,
    "parsedSheets" JSONB,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAuditedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkbookFile_pkey" PRIMARY KEY ("id")
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
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultSeverity" TEXT NOT NULL,
    "isEnabledDefault" BOOLEAN NOT NULL DEFAULT true,
    "paramsSchema" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRule_pkey" PRIMARY KEY ("id")
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
    "stage" TEXT NOT NULL,
    "outlookCount" INTEGER NOT NULL DEFAULT 0,
    "teamsCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "slaDueAt" TIMESTAMP(3),
    "projectStatuses" JSONB,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "note" TEXT,
    "triggeredById" TEXT,
    "requestId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
CREATE UNIQUE INDEX "ProcessMember_displayCode_key" ON "ProcessMember"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessMember_processId_userId_key" ON "ProcessMember"("processId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookFile_displayCode_key" ON "WorkbookFile"("displayCode");

-- CreateIndex
CREATE INDEX "WorkbookFile_processId_idx" ON "WorkbookFile"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookSheet_displayCode_key" ON "WorkbookSheet"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookSheet_fileId_sheetName_key" ON "WorkbookSheet"("fileId", "sheetName");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRule_ruleCode_key" ON "AuditRule"("ruleCode");

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
CREATE UNIQUE INDEX "TrackingEntry_processId_managerKey_key" ON "TrackingEntry"("processId", "managerKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_displayCode_key" ON "TrackingEvent"("displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_displayCode_key" ON "NotificationTemplate"("displayCode");

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

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMember" ADD CONSTRAINT "ProcessMember_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMember" ADD CONSTRAINT "ProcessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookFile" ADD CONSTRAINT "WorkbookFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookSheet" ADD CONSTRAINT "WorkbookSheet_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkbookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "TrackingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "TrackingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
