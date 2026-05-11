/**
 * Static, hand-derived metadata for every table in the SES schema.
 * Source of truth: `apps/api/db/migrations/*.sql`. The map describes
 * each model's table name, columns, JSONB/BYTEA columns, primary key,
 * composite-key aliases, and inter-table relations — everything the
 * pg-backed data client needs to translate query shapes into SQL.
 *
 * Read by `pg-pg-data-client.ts` to compile queries that mirror the
 * shapes the service layer was already using (find/create/update/etc.
 * with Prisma-style arguments). Updating this map and the SQL
 * migrations is the only place schema changes need to land.
 */

export type RelationKind = 'one' | 'many';

export interface RelationMeta {
  kind: RelationKind;
  target: string;
  /** PK column on the local side when kind='one'; defaults to model PK. */
  localKey?: string;
  /** FK column on the related table. */
  foreignKey?: string;
}

export interface ModelMeta {
  model: string;
  table: string;
  columns: ReadonlySet<string>;
  jsonCols: ReadonlySet<string>;
  byteaCols: ReadonlySet<string>;
  id: readonly string[];
  /** Composite-key aliases used by `where: { a_b: { a, b } }`. */
  uniques: Record<string, readonly string[]>;
  relations: Record<string, RelationMeta>;
}

const def = (spec: {
  model: string;
  table: string;
  columns: readonly string[];
  jsonCols?: readonly string[];
  byteaCols?: readonly string[];
  id: readonly string[];
  uniques?: Record<string, readonly string[]>;
  relations?: Record<string, RelationMeta>;
}): ModelMeta => ({
  model: spec.model,
  table: spec.table,
  columns: new Set(spec.columns),
  jsonCols: new Set(spec.jsonCols ?? []),
  byteaCols: new Set(spec.byteaCols ?? []),
  id: spec.id,
  uniques: spec.uniques ?? {},
  relations: spec.relations ?? {},
});

export const MODELS: Record<string, ModelMeta> = {
  IdentifierCounter: def({
    model: 'IdentifierCounter',
    table: 'IdentifierCounter',
    columns: ['id', 'prefix', 'scopeKey', 'year', 'currentValue', 'createdAt', 'updatedAt'],
    id: ['id'],
    uniques: { prefix_scopeKey_year: ['prefix', 'scopeKey', 'year'] },
  }),
  Tenant: def({
    model: 'Tenant',
    table: 'Tenant',
    columns: ['id', 'name', 'settings', 'createdAt', 'updatedAt'],
    jsonCols: ['settings'],
    id: ['id'],
  }),
  User: def({
    model: 'User',
    table: 'User',
    columns: [
      'id', 'displayCode', 'email', 'displayName', 'ssoSubject', 'passwordHash',
      'role', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt',
    ],
    id: ['id'],
    uniques: { email: ['email'], displayCode: ['displayCode'], ssoSubject: ['ssoSubject'] },
  }),
  Process: def({
    model: 'Process',
    table: 'Process',
    columns: [
      'id', 'displayCode', 'name', 'description', 'nextAuditDue', 'auditPolicy',
      'policyVersion', 'slaInitialHours', 'createdById', 'tenantId', 'rowVersion',
      'createdAt', 'updatedAt', 'archivedAt',
    ],
    jsonCols: ['auditPolicy'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      members: { kind: 'many', target: 'ProcessMember', foreignKey: 'processId' },
      processFunctions: { kind: 'many', target: 'ProcessFunction', foreignKey: 'processId' },
      tenant: { kind: 'one', target: 'Tenant', localKey: 'tenantId' },
      createdBy: { kind: 'one', target: 'User', localKey: 'createdById' },
      files: { kind: 'many', target: 'WorkbookFile', foreignKey: 'processId' },
      auditRuns: { kind: 'many', target: 'AuditRun', foreignKey: 'processId' },
      versions: { kind: 'many', target: 'SavedVersion', foreignKey: 'processId' },
      trackingEntries: { kind: 'many', target: 'TrackingEntry', foreignKey: 'processId' },
    },
  }),
  ManagerDirectory: def({
    model: 'ManagerDirectory',
    table: 'ManagerDirectory',
    columns: [
      'id', 'displayCode', 'tenantId', 'firstName', 'lastName', 'email',
      'normalizedKey', 'aliases', 'active', 'source', 'createdById',
      'createdAt', 'updatedAt',
    ],
    jsonCols: ['aliases'],
    id: ['id'],
    uniques: { tenantId_email: ['tenantId', 'email'], displayCode: ['displayCode'] },
  }),
  SystemFunction: def({
    model: 'SystemFunction',
    table: 'SystemFunction',
    columns: ['id', 'label', 'displayOrder', 'isSystem', 'createdAt', 'updatedAt'],
    id: ['id'],
  }),
  ProcessFunction: def({
    model: 'ProcessFunction',
    table: 'ProcessFunction',
    columns: ['processId', 'functionId', 'enabled', 'createdAt', 'updatedAt'],
    id: ['processId', 'functionId'],
    uniques: { processId_functionId: ['processId', 'functionId'] },
  }),
  FunctionAuditRequest: def({
    model: 'FunctionAuditRequest',
    table: 'FunctionAuditRequest',
    columns: [
      'id', 'displayCode', 'processId', 'requestedById', 'proposedName',
      'description', 'contactEmail', 'status', 'createdAt',
    ],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  ProcessMember: def({
    model: 'ProcessMember',
    table: 'ProcessMember',
    columns: ['id', 'displayCode', 'processId', 'userId', 'permission', 'addedById', 'addedAt'],
    id: ['id'],
    uniques: { processId_userId: ['processId', 'userId'], displayCode: ['displayCode'] },
    relations: {
      user: { kind: 'one', target: 'User', localKey: 'userId' },
      process: { kind: 'one', target: 'Process', localKey: 'processId' },
      scopePermissions: { kind: 'many', target: 'ProcessMemberScopePermission', foreignKey: 'memberId' },
    },
  }),
  ProcessMemberScopePermission: def({
    model: 'ProcessMemberScopePermission',
    table: 'ProcessMemberScopePermission',
    columns: [
      'id', 'processId', 'memberId', 'scopeType', 'functionId',
      'accessLevel', 'createdAt', 'updatedAt',
    ],
    id: ['id'],
    uniques: { memberId_scopeType_functionId: ['memberId', 'scopeType', 'functionId'] },
  }),
  WorkbookFile: def({
    model: 'WorkbookFile',
    table: 'WorkbookFile',
    columns: [
      'id', 'displayCode', 'processId', 'functionId', 'name', 'sizeBytes',
      'contentSha256', 'mimeType', 'storageKind', 'parsedSheets', 'uploadedById',
      'uploadedAt', 'lastAuditedAt', 'rowVersion', 'state', 'currentVersion',
      'uploadedObjectId',
    ],
    jsonCols: ['parsedSheets'],
    byteaCols: ['contentSha256'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      sheets: { kind: 'many', target: 'WorkbookSheet', foreignKey: 'fileId' },
      blob: { kind: 'one', target: 'FileBlob', localKey: 'id', foreignKey: 'fileId' },
      process: { kind: 'one', target: 'Process', localKey: 'processId' },
      uploadedBy: { kind: 'one', target: 'User', localKey: 'uploadedById' },
      fileVersions: { kind: 'many', target: 'FileVersion', foreignKey: 'fileId' },
      auditRuns: { kind: 'many', target: 'AuditRun', foreignKey: 'fileId' },
    },
  }),
  FileBlob: def({
    model: 'FileBlob',
    table: 'FileBlob',
    columns: ['fileId', 'content', 'createdAt'],
    byteaCols: ['content'],
    id: ['fileId'],
  }),
  FileVersion: def({
    model: 'FileVersion',
    table: 'FileVersion',
    columns: [
      'id', 'fileId', 'versionNumber', 'content', 'contentSha256', 'sizeBytes',
      'note', 'createdById', 'createdAt', 'uploadedObjectId',
    ],
    byteaCols: ['content', 'contentSha256'],
    id: ['id'],
    uniques: { fileId_versionNumber: ['fileId', 'versionNumber'] },
    relations: {
      createdBy: { kind: 'one', target: 'User', localKey: 'createdById' },
      file: { kind: 'one', target: 'WorkbookFile', localKey: 'fileId' },
    },
  }),
  FileDraft: def({
    model: 'FileDraft',
    table: 'FileDraft',
    columns: [
      'id', 'userId', 'processId', 'functionId', 'fileName', 'content',
      'sizeBytes', 'updatedAt', 'createdAt', 'uploadedObjectId',
    ],
    byteaCols: ['content'],
    id: ['id'],
    uniques: { userId_processId_functionId: ['userId', 'processId', 'functionId'] },
  }),
  WorkbookSheet: def({
    model: 'WorkbookSheet',
    table: 'WorkbookSheet',
    columns: [
      'id', 'displayCode', 'fileId', 'sheetName', 'status', 'rowCount',
      'isSelected', 'headerRowIx', 'rows', 'originalHeaders', 'normalizedHeaders',
    ],
    jsonCols: ['rows', 'originalHeaders', 'normalizedHeaders'],
    id: ['id'],
    uniques: { fileId_sheetName: ['fileId', 'sheetName'], displayCode: ['displayCode'] },
    relations: { file: { kind: 'one', target: 'WorkbookFile', localKey: 'fileId' } },
  }),
  AuditRule: def({
    model: 'AuditRule',
    table: 'AuditRule',
    columns: [
      'id', 'ruleCode', 'functionId', 'name', 'category', 'description',
      'defaultSeverity', 'isEnabledDefault', 'paramsSchema', 'version',
      'source', 'status', 'createdAt',
    ],
    jsonCols: ['paramsSchema'],
    id: ['id'],
    uniques: { ruleCode: ['ruleCode'] },
    relations: {
      aiMeta: { kind: 'one', target: 'AiPilotRuleMeta', localKey: 'ruleCode', foreignKey: 'ruleCode' },
    },
  }),
  AiPilotRuleMeta: def({
    model: 'AiPilotRuleMeta',
    table: 'AiPilotRuleMeta',
    columns: [
      'id', 'ruleCode', 'description', 'logic', 'flagMessage', 'authoredById',
      'sourcePrompt', 'sourceSessionId', 'llmModel', 'llmRawResponse',
      'createdAt', 'updatedAt',
    ],
    jsonCols: ['logic', 'llmRawResponse'],
    id: ['id'],
    uniques: { ruleCode: ['ruleCode'] },
    relations: { authoredBy: { kind: 'one', target: 'User', localKey: 'authoredById' } },
  }),
  AiPilotSandboxSession: def({
    model: 'AiPilotSandboxSession',
    table: 'AiPilotSandboxSession',
    columns: [
      'id', 'authoredById', 'functionId', 'fileName', 'fileBytes', 'sheetName',
      'expiresAt', 'createdAt', 'uploadedObjectId',
    ],
    byteaCols: ['fileBytes'],
    id: ['id'],
  }),
  AiPilotAuditLog: def({
    model: 'AiPilotAuditLog',
    table: 'AiPilotAuditLog',
    columns: ['id', 'actorId', 'action', 'ruleCode', 'payload', 'createdAt'],
    jsonCols: ['payload'],
    id: ['id'],
    relations: { actor: { kind: 'one', target: 'User', localKey: 'actorId' } },
  }),
  AuditRun: def({
    model: 'AuditRun',
    table: 'AuditRun',
    columns: [
      'id', 'displayCode', 'processId', 'fileId', 'requestId', 'status',
      'source', 'policySnapshot', 'rulesSnapshot', 'scannedRows', 'flaggedRows',
      'findingsHash', 'summary', 'ranById', 'startedAt', 'completedAt',
    ],
    jsonCols: ['policySnapshot', 'rulesSnapshot', 'summary'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      issues: { kind: 'many', target: 'AuditIssue', foreignKey: 'auditRunId' },
      file: { kind: 'one', target: 'WorkbookFile', localKey: 'fileId' },
      process: { kind: 'one', target: 'Process', localKey: 'processId' },
      ranBy: { kind: 'one', target: 'User', localKey: 'ranById' },
    },
  }),
  SavedVersion: def({
    model: 'SavedVersion',
    table: 'SavedVersion',
    columns: [
      'id', 'displayCode', 'processId', 'auditRunId', 'versionNumber',
      'versionName', 'notes', 'createdById', 'createdAt',
    ],
    id: ['id'],
    uniques: { processId_versionNumber: ['processId', 'versionNumber'], displayCode: ['displayCode'] },
    relations: {
      auditRun: { kind: 'one', target: 'AuditRun', localKey: 'auditRunId' },
      createdBy: { kind: 'one', target: 'User', localKey: 'createdById' },
    },
  }),
  AuditIssue: def({
    model: 'AuditIssue',
    table: 'AuditIssue',
    columns: [
      'id', 'displayCode', 'issueKey', 'auditRunId', 'ruleCode', 'projectNo',
      'projectName', 'sheetName', 'projectManager', 'projectState', 'effort',
      'severity', 'reason', 'thresholdLabel', 'recommendedAction', 'email',
      'rowIndex', 'missingMonths', 'zeroMonthCount',
    ],
    jsonCols: ['missingMonths'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      rule: { kind: 'one', target: 'AuditRule', localKey: 'ruleCode', foreignKey: 'ruleCode' },
      auditRun: { kind: 'one', target: 'AuditRun', localKey: 'auditRunId' },
    },
  }),
  IssueComment: def({
    model: 'IssueComment',
    table: 'IssueComment',
    columns: [
      'id', 'displayCode', 'processId', 'issueKey', 'authorId', 'body',
      'createdAt', 'editedAt', 'deletedAt', 'rowVersion',
    ],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: { author: { kind: 'one', target: 'User', localKey: 'authorId' } },
  }),
  IssueCorrection: def({
    model: 'IssueCorrection',
    table: 'IssueCorrection',
    columns: [
      'id', 'displayCode', 'processId', 'issueKey', 'correctedEffort',
      'correctedState', 'correctedManager', 'note', 'updatedById',
      'updatedAt', 'rowVersion',
    ],
    id: ['id'],
    uniques: { processId_issueKey: ['processId', 'issueKey'], displayCode: ['displayCode'] },
    relations: { updatedBy: { kind: 'one', target: 'User', localKey: 'updatedById' } },
  }),
  IssueAcknowledgment: def({
    model: 'IssueAcknowledgment',
    table: 'IssueAcknowledgment',
    columns: [
      'id', 'displayCode', 'processId', 'issueKey', 'status', 'updatedById',
      'updatedAt', 'rowVersion',
    ],
    id: ['id'],
    uniques: { processId_issueKey: ['processId', 'issueKey'], displayCode: ['displayCode'] },
    relations: { updatedBy: { kind: 'one', target: 'User', localKey: 'updatedById' } },
  }),
  TrackingEntry: def({
    model: 'TrackingEntry',
    table: 'TrackingEntry',
    columns: [
      'id', 'displayCode', 'processId', 'managerKey', 'managerName',
      'managerEmail', 'stage', 'escalationLevel', 'outlookCount', 'teamsCount',
      'lastContactAt', 'resolved', 'slaDueAt', 'projectStatuses',
      'composeDraft', 'draftLockUserId', 'draftLockExpiresAt', 'verifiedById',
      'verifiedAt', 'rowVersion', 'updatedAt',
    ],
    jsonCols: ['projectStatuses', 'composeDraft'],
    id: ['id'],
    uniques: { processId_managerKey: ['processId', 'managerKey'], displayCode: ['displayCode'] },
    relations: {
      process: { kind: 'one', target: 'Process', localKey: 'processId' },
      events: { kind: 'many', target: 'TrackingEvent', foreignKey: 'trackingId' },
      stageComments: { kind: 'many', target: 'TrackingStageComment', foreignKey: 'trackingEntryId' },
      attachments: { kind: 'many', target: 'TrackingAttachment', foreignKey: 'trackingEntryId' },
      verifiedBy: { kind: 'one', target: 'User', localKey: 'verifiedById' },
      draftLockUser: { kind: 'one', target: 'User', localKey: 'draftLockUserId' },
    },
  }),
  TrackingStageComment: def({
    model: 'TrackingStageComment',
    table: 'TrackingStageComment',
    columns: [
      'id', 'displayCode', 'trackingEntryId', 'stage', 'authorId',
      'authorName', 'body', 'createdAt',
    ],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      author: { kind: 'one', target: 'User', localKey: 'authorId' },
      trackingEntry: { kind: 'one', target: 'TrackingEntry', localKey: 'trackingEntryId' },
    },
  }),
  TrackingAttachment: def({
    model: 'TrackingAttachment',
    table: 'TrackingAttachment',
    columns: [
      'id', 'displayCode', 'trackingEntryId', 'uploadedById', 'fileName',
      'mimeType', 'sizeBytes', 'content', 'comment', 'createdAt', 'deletedAt',
    ],
    byteaCols: ['content'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      uploadedBy: { kind: 'one', target: 'User', localKey: 'uploadedById' },
      trackingEntry: { kind: 'one', target: 'TrackingEntry', localKey: 'trackingEntryId' },
    },
  }),
  TrackingEvent: def({
    model: 'TrackingEvent',
    table: 'TrackingEvent',
    columns: [
      'id', 'displayCode', 'trackingId', 'kind', 'channel', 'note', 'reason',
      'payload', 'triggeredById', 'requestId', 'at',
    ],
    jsonCols: ['payload'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
    relations: {
      triggeredBy: { kind: 'one', target: 'User', localKey: 'triggeredById' },
      tracking: { kind: 'one', target: 'TrackingEntry', localKey: 'trackingId' },
    },
  }),
  ComposerNotificationTemplate: def({
    model: 'ComposerNotificationTemplate',
    table: 'ComposerNotificationTemplate',
    columns: [
      'id', 'displayCode', 'processId', 'ownerId', 'name', 'theme',
      'template', 'createdAt',
    ],
    jsonCols: ['template'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  NotificationTemplate: def({
    model: 'NotificationTemplate',
    table: 'NotificationTemplate',
    columns: [
      'id', 'tenantId', 'parentId', 'stage', 'subject', 'body', 'channel',
      'active', 'version', 'createdBy', 'createdAt', 'updatedAt',
    ],
    id: ['id'],
  }),
  Notification: def({
    model: 'Notification',
    table: 'Notification',
    columns: [
      'id', 'displayCode', 'processId', 'trackingId', 'templateId', 'channel',
      'subject', 'body', 'sentById', 'sentAt', 'status',
    ],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  ActivityLog: def({
    model: 'ActivityLog',
    table: 'ActivityLog',
    columns: [
      'id', 'displayCode', 'occurredAt', 'actorId', 'actorEmail', 'processId',
      'entityType', 'entityId', 'entityCode', 'action', 'before', 'after',
      'requestId', 'traceId', 'ipAddress', 'userAgent', 'metadata',
    ],
    jsonCols: ['before', 'after', 'metadata'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  Export: def({
    model: 'Export',
    table: 'Export',
    columns: [
      'id', 'displayCode', 'processId', 'auditRunId', 'savedVersionId',
      'kind', 'format', 'requestedById', 'requestId', 'status', 'fileSha256',
      'sizeBytes', 'content', 'contentType', 'downloadedAt', 'expiresAt',
      'createdAt',
    ],
    byteaCols: ['fileSha256', 'content'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  Job: def({
    model: 'Job',
    table: 'Job',
    columns: [
      'id', 'displayCode', 'kind', 'processId', 'requestId', 'state',
      'attempts', 'payload', 'result', 'error', 'createdById', 'createdAt',
      'startedAt', 'finishedAt',
    ],
    jsonCols: ['payload', 'result'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  UserPreference: def({
    model: 'UserPreference',
    table: 'UserPreference',
    columns: [
      'id', 'userId', 'lastProcessId', 'defaultTab', 'data', 'createdAt',
      'updatedAt',
    ],
    jsonCols: ['data'],
    id: ['id'],
    uniques: { userId: ['userId'] },
  }),
  ApiToken: def({
    model: 'ApiToken',
    table: 'ApiToken',
    columns: [
      'id', 'displayCode', 'ownerId', 'name', 'tokenHash', 'scopes',
      'expiresAt', 'lastUsedAt', 'revokedAt', 'createdAt',
    ],
    jsonCols: ['scopes'],
    byteaCols: ['tokenHash'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  WebhookEndpoint: def({
    model: 'WebhookEndpoint',
    table: 'WebhookEndpoint',
    columns: [
      'id', 'displayCode', 'processId', 'url', 'events', 'signingSecret',
      'isEnabled', 'createdById', 'createdAt',
    ],
    jsonCols: ['events'],
    byteaCols: ['signingSecret'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  LiveSession: def({
    model: 'LiveSession',
    table: 'LiveSession',
    columns: [
      'id', 'displayCode', 'userId', 'processId', 'socketId', 'currentTab',
      'currentFocus', 'connectedAt', 'lastHeartbeat',
    ],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  SignedLink: def({
    model: 'SignedLink',
    table: 'SignedLink',
    columns: [
      'id', 'displayCode', 'purpose', 'processId', 'issueKey', 'trackingId',
      'managerEmail', 'tokenHash', 'allowedActions', 'singleUse', 'usedAt',
      'usedFromIp', 'usedUserAgent', 'revokedAt', 'expiresAt', 'createdById',
      'createdAt',
    ],
    jsonCols: ['allowedActions'],
    byteaCols: ['tokenHash'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
  NotificationLog: def({
    model: 'NotificationLog',
    table: 'notification_log',
    columns: [
      'id', 'displayCode', 'processId', 'actorUserId', 'trackingEntryId',
      'managerEmail', 'managerName', 'channel', 'subject', 'bodyPreview',
      'resolvedBody', 'sources', 'severity', 'issueCount', 'authorNote',
      'deadlineAt', 'sentAt',
    ],
    jsonCols: ['sources'],
    id: ['id'],
    uniques: { displayCode: ['displayCode'] },
  }),
};
