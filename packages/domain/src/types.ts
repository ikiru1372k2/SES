export type SheetStatus = 'valid' | 'duplicate' | 'invalid';
export type Severity = 'High' | 'Medium' | 'Low';
export type WorkspaceTab = 'preview' | 'results' | 'notifications' | 'tracking' | 'versions' | 'analytics';
export type IssueCategory = 'Overplanning' | 'Missing Planning' | 'Other' | 'Effort Threshold' | 'Missing Data' | 'Planning Risk' | 'Capacity Risk';
export type NotificationTheme =
  | 'Company Reminder'
  | 'Executive Summary'
  | 'Compact Update'
  | 'Formal'
  | 'Urgent'
  | 'Friendly Follow-up'
  | 'Escalation';

export interface AuditPolicy {
  highEffortThreshold: number;
  mediumEffortMin: number;
  mediumEffortMax: number;
  lowEffortMin: number;
  lowEffortMax: number;
  lowEffortEnabled: boolean;
  zeroEffortEnabled: boolean;
  missingEffortEnabled: boolean;
  missingManagerEnabled: boolean;
  inPlanningEffortEnabled: boolean;
  onHoldEffortEnabled: boolean;
  onHoldEffortThreshold: number;
  updatedAt: string;
}

export interface AuditProcess {
  id: string;
  /**
   * Stable human-readable code assigned by the server (PRC-YYYY-NNNN).
   * Optional because legacy local-only processes may not have one yet.
   */
  displayCode?: string;
  /** When true, process metadata is owned by the API; list/create/delete use Postgres. */
  serverBacked?: boolean;
  /** Optimistic concurrency token from the API. */
  rowVersion?: number;
  /** Summary counts from list endpoints before detailed workspace hydration. */
  serverFilesCount?: number;
  serverVersionsCount?: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  nextAuditDue: string | null;
  files: WorkbookFile[];
  activeFileId: string | null;
  versions: AuditVersion[];
  latestAuditResult?: AuditResult;
  auditPolicy: AuditPolicy;
  notificationTracking: Record<string, TrackingEntry>;
  comments: Record<string, IssueComment[]>;
  corrections: Record<string, IssueCorrection>;
  acknowledgments: Record<string, IssueAcknowledgment>;
  savedTemplates: Record<string, SavedTemplate>;
}

export interface WorkbookFile {
  id: string;
  displayCode?: string;
  /** Analysis lane / function tile that owns this file. */
  functionId?: string;
  rowVersion?: number;
  processId?: string;
  currentVersion?: number;
  state?: 'uploaded' | 'processing' | 'completed' | 'draft';
  sizeBytes?: number;
  mimeType?: string;
  name: string;
  uploadedAt: string;
  lastAuditedAt: string | null;
  isAudited: boolean;
  serverBacked?: boolean;
  sheets: SheetInfo[];
  rawData: Record<string, unknown[][]>;
  fileVersions?: FileVersionMetadata[];
}

export interface FileVersionMetadata {
  id: string;
  fileId: string;
  versionNumber: number;
  note: string;
  sizeBytes: number;
  createdAt: string;
  isCurrent: boolean;
  createdBy?: {
    displayCode: string;
    displayName: string;
    email: string;
  };
}

export interface FileDraftMetadata {
  id?: string;
  userId?: string;
  processId?: string;
  functionId?: string;
  fileName?: string;
  sizeBytes?: number;
  updatedAt?: string;
  createdAt?: string;
  hasDraft?: boolean;
}

export interface SheetInfo {
  id?: string;
  displayCode?: string;
  name: string;
  status: SheetStatus;
  rowCount: number;
  isSelected: boolean;
  skipReason?: string | undefined;
  headerRowIndex?: number | undefined;
  originalHeaders?: string[] | undefined;
  normalizedHeaders?: string[] | undefined;
}

export interface AuditResult {
  id?: string | undefined;
  displayCode?: string | undefined;
  requestId?: string | undefined;
  jobCode?: string | undefined;
  source?: 'inline' | 'job' | 'legacy_import' | undefined;
  fileId: string;
  runAt: string;
  scannedRows: number;
  flaggedRows: number;
  issues: AuditIssue[];
  sheets: SheetAuditResult[];
  policySnapshot?: AuditPolicy;
}

export interface AuditIssue {
  id: string;
  displayCode?: string | undefined;
  issueKey?: string | undefined;
  projectNo: string;
  projectName: string;
  sheetName: string;
  severity: Severity;
  projectManager: string;
  projectState: string;
  effort: number;
  auditStatus: string;
  notes: string;
  rowIndex: number;
  email?: string | undefined;
  ruleId?: string | undefined;
  ruleCode?: string | undefined;
  ruleVersion?: number | undefined;
  ruleName?: string | undefined;
  auditRunCode?: string | undefined;
  trackingCode?: string | undefined;
  notificationCode?: string | undefined;
  category?: IssueCategory | undefined;
  reason?: string | undefined;
  thresholdLabel?: string | undefined;
  recommendedAction?: string | undefined;
}

export interface IssueComment {
  id: string;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  issueKey: string;
  processId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueCorrection {
  id?: string | undefined;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  issueKey: string;
  processId: string;
  effort?: number | undefined;
  projectState?: string | undefined;
  projectManager?: string | undefined;
  note: string;
  updatedAt: string;
}

export type AcknowledgmentStatus = 'needs_review' | 'acknowledged' | 'corrected';

export interface IssueAcknowledgment {
  id?: string | undefined;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  issueKey: string;
  processId: string;
  status: AcknowledgmentStatus;
  updatedAt: string;
}

export interface SheetAuditResult {
  sheetName: string;
  rowCount: number;
  flaggedCount: number;
}

export interface AuditVersion {
  id: string;
  displayCode?: string | undefined;
  versionId: string;
  versionNumber: number;
  versionName: string;
  notes: string;
  createdAt: string;
  result: AuditResult;
  auditPolicy?: AuditPolicy;
  label?: string;
}

export type TrackingStage = 'Not contacted' | 'Reminder 1 sent' | 'Reminder 2 sent' | 'Teams escalated' | 'Resolved';
export type TrackingChannel = 'outlook' | 'eml' | 'teams' | 'manual' | 'sendAll';

export interface TrackingEvent {
  channel: TrackingChannel;
  at: string;
  note: string;
}

export interface TrackingEntry {
  key: string;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  processId: string;
  managerName: string;
  managerEmail: string;
  flaggedProjectCount: number;
  outlookCount: number;
  teamsCount: number;
  lastContactAt: string | null;
  stage: TrackingStage;
  resolved: boolean;
  history: TrackingEvent[];
  projectStatuses: Record<string, ProjectTrackingStatus>;
}

export type ProjectTrackingStage = 'open' | 'acknowledged' | 'corrected' | 'resolved';

export interface ProjectTrackingStatus {
  projectNo: string;
  stage: ProjectTrackingStage;
  feedback: string;
  history: TrackingEvent[];
  updatedAt: string;
}

export interface ComparisonResult {
  newIssues: AuditIssue[];
  resolvedIssues: AuditIssue[];
  changedIssues: AuditIssue[];
  unchangedIssues: AuditIssue[];
  managerChanges: AuditIssue[];
  effortChanges: AuditIssue[];
  stateChanges: AuditIssue[];
}

export interface NotificationDraft {
  displayCode?: string | undefined;
  pmName: string;
  email: string | null;
  recipientKey: string;
  hasValidRecipient: boolean;
  issueCount: number;
  projects: AuditIssue[];
  corrections: Record<string, IssueCorrection>;
  comments: Record<string, IssueComment[]>;
  acknowledgments: Record<string, IssueAcknowledgment>;
  pendingCorrectionCount: number;
  unreviewedCount: number;
  stage: 'Reminder 1' | 'Reminder 2' | 'Escalation';
  theme: NotificationTheme;
  subject: string;
  htmlBody: string;
}

export interface NotificationTemplate {
  greeting: string;
  intro: string;
  actionLine: string;
  deadlineLine: string;
  closing: string;
  signature1: string;
  signature2: string;
}

export interface SavedTemplate {
  displayCode?: string | undefined;
  name: string;
  theme: NotificationTheme;
  template: NotificationTemplate;
}

export interface SessionUser {
  id: string;
  displayCode: string;
  email: string;
  displayName: string;
  role: 'admin' | 'auditor' | 'viewer';
}

export interface ProcessSummary {
  id: string;
  displayCode: string;
  rowVersion: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  nextAuditDue: string | null;
  archivedAt?: string | null;
  latestAuditRunCode?: string | null;
  latestRunAt?: string | null;
  latestIssueCount: number;
  filesCount: number;
  versionsCount: number;
}

export interface SheetPreviewRow {
  rowIndex: number;
  values: string[];
  issue?: Pick<AuditIssue, 'id' | 'displayCode' | 'severity' | 'issueKey'>;
}

export interface SheetPreviewPage {
  fileId: string;
  fileCode?: string;
  sheetName: string;
  sheetCode?: string;
  page: number;
  pageSize: number;
  totalRows: number;
  headerRowIndex: number;
  headers: string[];
  rows: SheetPreviewRow[];
}

export interface ActivityEvent {
  id: string;
  displayCode: string;
  occurredAt: string;
  actorDisplayName?: string | null;
  actorCode?: string | null;
  entityType: string;
  entityId?: string | null;
  entityCode?: string | null;
  action: string;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}
