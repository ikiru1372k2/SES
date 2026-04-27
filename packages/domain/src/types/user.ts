import type { AuditIssue } from './issue';

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
