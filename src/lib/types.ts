export type SheetStatus = 'valid' | 'duplicate' | 'invalid';
export type Severity = 'High' | 'Medium' | 'Low';
export type WorkspaceTab = 'preview' | 'results' | 'notifications' | 'tracking' | 'versions' | 'analytics';
export type IssueCategory = 'Overplanning' | 'Missing Planning' | 'Other' | 'Effort Threshold' | 'Missing Data' | 'Planning Risk' | 'Capacity Risk';

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
}

export interface WorkbookFile {
  id: string;
  name: string;
  uploadedAt: string;
  lastAuditedAt: string | null;
  isAudited: boolean;
  sheets: SheetInfo[];
  rawData: Record<string, unknown[][]>;
}

export interface SheetInfo {
  name: string;
  status: SheetStatus;
  rowCount: number;
  isSelected: boolean;
  skipReason?: string;
  headerRowIndex?: number;
  originalHeaders?: string[];
  normalizedHeaders?: string[];
}

export interface AuditResult {
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
  email?: string;
  ruleId?: string;
  ruleName?: string;
  category?: IssueCategory;
  reason?: string;
  thresholdLabel?: string;
  recommendedAction?: string;
}

export interface IssueComment {
  id: string;
  issueKey: string;
  processId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueCorrection {
  issueKey: string;
  processId: string;
  effort?: number;
  projectState?: string;
  projectManager?: string;
  note: string;
  updatedAt: string;
}

export interface SheetAuditResult {
  sheetName: string;
  rowCount: number;
  flaggedCount: number;
}

export interface AuditVersion {
  id: string;
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
  pmName: string;
  email: string | null;
  recipientKey: string;
  hasValidRecipient: boolean;
  issueCount: number;
  projects: AuditIssue[];
  stage: 'Reminder 1' | 'Reminder 2' | 'Escalation';
  theme: 'Company Reminder' | 'Executive Summary' | 'Compact Update';
  subject: string;
  htmlBody: string;
  corrections: Record<string, IssueCorrection>;
  pendingCorrectionCount: number;
}
