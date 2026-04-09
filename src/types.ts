export type Severity = "High" | "Medium" | "Low";

export type IssueCategory = "Data Quality" | "Planning Issue" | "Capacity Risk";

export type IssueCode =
  | "MISSING_EFFORT"
  | "PENDING_ESTIMATION"
  | "ON_HOLD_WITH_NO_EFFORT"
  | "AUTHORISED_WITH_ZERO_EFFORT"
  | "PRE_APPROVAL_EFFORT_ENTERED"
  | "HIGH_EFFORT_PROJECT"
  | "ELEVATED_EFFORT_PROJECT"
  | "MISSING_CONTACT_DATA"
  | "DUPLICATE_PROJECT_NUMBER";

export interface WorkbookTemplateInfo {
  sourceSheetName: string;
  scannedSheetNames: string[];
  duplicateSheetNames: string[];
  headerRow: number;
  firstDataRow: number;
}

export interface DetectedSheetMetadata {
  name: string;
  auditable: boolean;
  duplicate: boolean;
  rowCount: number;
  reason?: string;
}

export interface EffortRow {
  sourceSheetName: string;
  sourceRowNumber: number;
  country: string;
  businessUnit: string;
  customerName: string;
  projectNo: string;
  project: string;
  projectState: string;
  projectCountryManager: string;
  projectManager: string;
  email: string;
  projectCategory: string;
  pspType: string;
  effortHours: number | null;
  rawEffortValue: unknown;
}

export interface AuditIssue {
  code: IssueCode;
  label: string;
  category: IssueCategory;
  severity: Severity;
  details?: string;
}

export interface AuditedRow extends EffortRow {
  issues: AuditIssue[];
  highestSeverity: Severity | null;
  auditStatus: string;
  auditSeverity: Severity | "OK";
  auditNotes: string;
}

export interface AuditSummary {
  totalRows: number;
  flaggedRows: number;
  issueCount: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<IssueCategory, number>;
}

export interface NotificationProjectRow {
  projectNo: string;
  project: string;
  projectState: string;
  effortHours: number | null;
  auditStatus: string;
  auditSeverity: Severity | "OK";
  auditNotes: string;
}

export interface NotificationDraft {
  recipientEmail: string;
  projectManager: string;
  subject: string;
  summary: AuditSummary;
  rows: NotificationProjectRow[];
  html: string;
  text: string;
}

export interface Snapshot {
  sessionId: string;
  version: number;
  createdAt: string;
  workbookPath: string;
  sourceSheetName: string;
  scannedSheetNames: string[];
  duplicateSheetNames: string[];
  summary: AuditSummary;
  rows: AuditedRow[];
  notifications: NotificationDraft[];
}

export interface SnapshotIssueDelta {
  projectNo: string;
  project: string;
  projectManager: string;
  email: string;
  sourceSheetName: string;
  auditStatus: string;
  auditSeverity: Severity | "OK";
  issueCodes: IssueCode[];
}

export interface SnapshotComparison {
  fromVersion: number;
  toVersion: number | null;
  baselineVersion: number;
  baselineCreatedAt: string;
  newIssues: number;
  resolvedIssues: number;
  newIssueRows: SnapshotIssueDelta[];
  resolvedIssueRows: SnapshotIssueDelta[];
  severityChanges: Array<{
    projectNo: string;
    project: string;
    projectManager: string;
    from: Severity | "OK";
    to: Severity | "OK";
  }>;
  managerChanges: Array<{
    projectNo: string;
    project: string;
    fromManager: string;
    toManager: string;
  }>;
}
