import type { SheetStatus } from './primitives';
import type { AuditIssue, IssueComment, IssueCorrection, IssueAcknowledgment } from './issue';
import type { TrackingEntry } from './tracking';
import type { SavedTemplate } from './notification';

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

export interface WorkbookFile {
  id: string;
  displayCode?: string;
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
  pdThreshold?: number;
  opportunities?: {
    closeDateLowProbabilityMax?: number;
    projectStartLowProbabilityMax?: number;
    missingBcsProbabilityExact?: number;
    bcsAvailableLowProbabilityMax?: number;
    brazilExpectedBu?: string;
  };
  updatedAt: string;
}

export interface SheetAuditResult {
  sheetName: string;
  rowCount: number;
  flaggedCount: number;
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
  findingsHash?: string;
  issues: AuditIssue[];
  sheets: SheetAuditResult[];
  policySnapshot?: AuditPolicy;
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

export interface AuditProcess {
  id: string;
  displayCode?: string;
  serverBacked?: boolean;
  rowVersion?: number;
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
