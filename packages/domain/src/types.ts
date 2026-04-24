import type { EscalationStage } from './escalationStages';
import type { ProjectStatusesV2 } from './projectStatuses';

export type { EscalationStage } from './escalationStages';
export type { ProjectStatusesV2, EngineProjectStatus, EngineSubStatus, ProjectStatusesAggregate } from './projectStatuses';

export type SheetStatus = 'valid' | 'duplicate' | 'invalid';
export type Severity = 'High' | 'Medium' | 'Low';
export type WorkspaceTab = 'preview' | 'results' | 'notifications' | 'tracking' | 'versions' | 'analytics';
export type IssueCategory =
  | 'Overplanning'
  | 'Missing Planning'
  | 'Function Rate'
  | 'Internal Cost Rate'
  | 'Other'
  | 'Effort Threshold'
  | 'Missing Data'
  | 'Planning Risk'
  | 'Capacity Risk'
  | 'Data Quality'
  | 'Needs Review';
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
  /** Per-month PD threshold for the over-planning engine (default 30). */
  pdThreshold?: number;
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
  /**
   * Deterministic identity of the issue set. Used client-side (Issue #74) to
   * skip auto-saving a version when two consecutive runs produce the same
   * findings.
   */
  findingsHash?: string;
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
  // Function-rate context: every zero-rate month label for the row, and the
  // cardinality of that list. Populated only by the function-rate engine.
  missingMonths?: readonly string[] | undefined;
  zeroMonthCount?: number | undefined;
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

export type TrackingChannel =
  | 'outlook'
  | 'eml'
  | 'teams'
  | 'manual'
  | 'sendAll'
  | 'manager_response'
  | 'stage_transition';

export interface TrackingEvent {
  channel: TrackingChannel;
  kind?: string | undefined;
  at: string;
  note: string;
  reason?: string | undefined;
  payload?: unknown;
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
  stage: EscalationStage;
  escalationLevel?: number | undefined;
  resolved: boolean;
  history: TrackingEvent[];
  projectStatuses: ProjectStatusesV2;
}

export type ProjectTrackingStage = 'open' | 'acknowledged' | 'corrected' | 'resolved';

export interface ProjectTrackingStatus {
  projectNo: string;
  stage: ProjectTrackingStage;
  feedback: string;
  history: TrackingEvent[];
  updatedAt: string;
}

export type IssueFieldDiff<T = unknown> = { from: T; to: T };
// Subset of AuditIssue fields that the UI renders per-row diffs for. Kept
// narrow on purpose — rotating internal IDs / row indexes into diffs would
// produce noise.
export type DiffableIssueField =
  | 'severity'
  | 'projectManager'
  | 'projectState'
  | 'effort'
  | 'auditStatus'
  | 'email'
  | 'reason'
  | 'recommendedAction'
  | 'category';
export type IssueDiffMap = Partial<Record<DiffableIssueField, IssueFieldDiff>>;
export interface ChangedIssue extends AuditIssue {
  diffs: IssueDiffMap;
}

export interface ComparisonResult {
  newIssues: AuditIssue[];
  resolvedIssues: AuditIssue[];
  // `changedIssues` now carries per-field from/to pairs so the UI can render
  // "Severity: Medium → High" style diffs. The enclosing AuditIssue fields
  // reflect the "to" state (i.e. the latest), matching the previous shape.
  changedIssues: ChangedIssue[];
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

export interface NotificationComposeTemplate {
  greeting: string;
  intro: string;
  actionLine: string;
  deadlineLine: string;
  closing: string;
  signature1: string;
  signature2: string;
}

/** @deprecated Use `NotificationComposeTemplate`; alias kept for workspace imports. */
export type NotificationTemplate = NotificationComposeTemplate;

export interface SavedTemplate {
  displayCode?: string | undefined;
  name: string;
  theme: NotificationTheme;
  template: NotificationComposeTemplate;
}

export interface SessionUser {
  id: string;
  displayCode: string;
  email: string;
  displayName: string;
  role: 'admin' | 'auditor' | 'viewer';
  tenantId?: string;
  tenantDisplayCode?: string;
  managerDirectoryEnabled?: boolean;
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
