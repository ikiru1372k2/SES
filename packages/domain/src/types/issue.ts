import type { Severity, IssueCategory, AcknowledgmentStatus } from './primitives';

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

export interface IssueAcknowledgment {
  id?: string | undefined;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  issueKey: string;
  processId: string;
  status: AcknowledgmentStatus;
  updatedAt: string;
}

export type IssueFieldDiff<T = unknown> = { from: T; to: T };
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
  changedIssues: ChangedIssue[];
  unchangedIssues: AuditIssue[];
  managerChanges: AuditIssue[];
  effortChanges: AuditIssue[];
  stateChanges: AuditIssue[];
}
