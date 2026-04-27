import { createHash } from 'node:crypto';
import type { AuditIssue, AuditResult } from '@ses/domain';

/**
 * Stable sha256 over the sorted identity of each issue.
 * Two runs with the same issues (any order) produce the same hash, so the
 * web store can skip creating duplicate SavedVersion rows when an auditor
 * re-runs against an unchanged file.
 */
export function computeFindingsHash(
  issues: Array<{ issueKey: string; ruleCode?: string | null; severity?: string | null }>,
): string {
  const normalized = issues
    .map((i) => `${i.issueKey}|${i.ruleCode ?? ''}|${i.severity ?? ''}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(`${issues.length}\n${normalized}`).digest('hex');
}

export function serializeIssue(issue: {
  id: string;
  displayCode: string;
  issueKey: string;
  ruleCode: string;
  projectNo: string | null;
  projectName: string | null;
  sheetName: string | null;
  projectManager: string | null;
  projectState: string | null;
  effort: number | null;
  severity: string;
  reason: string | null;
  thresholdLabel: string | null;
  recommendedAction: string | null;
  email: string | null;
  rowIndex: number | null;
  auditRun: { displayCode: string };
  rule: { name: string; version: number; category: string; source?: string };
}) {
  return {
    id: issue.id,
    displayCode: issue.displayCode,
    issueKey: issue.issueKey,
    projectNo: issue.projectNo ?? '',
    projectName: issue.projectName ?? '',
    sheetName: issue.sheetName ?? '',
    severity: issue.severity as AuditIssue['severity'],
    projectManager: issue.projectManager ?? '',
    projectState: issue.projectState ?? '',
    effort: issue.effort ?? 0,
    auditStatus: issue.ruleCode,
    notes: issue.reason ?? '',
    rowIndex: issue.rowIndex ?? 0,
    email: issue.email ?? '',
    ruleId: issue.ruleCode,
    ruleCode: issue.ruleCode,
    ruleVersion: issue.rule.version,
    ruleName: issue.rule.name,
    ruleSource: issue.rule.source ?? 'system',
    auditRunCode: issue.auditRun.displayCode,
    category: issue.rule.category as AuditIssue['category'],
    reason: issue.reason ?? '',
    thresholdLabel: issue.thresholdLabel ?? '',
    recommendedAction: issue.recommendedAction ?? '',
  };
}

export function serializeRun(run: {
  id: string;
  displayCode: string;
  fileId: string;
  requestId: string;
  status: string;
  source: string;
  scannedRows: number;
  flaggedRows: number;
  findingsHash?: string;
  startedAt: Date;
  completedAt: Date | null;
  issues?: Array<{
    id: string;
    displayCode: string;
    issueKey: string;
    ruleCode: string;
    projectNo: string | null;
    projectName: string | null;
    sheetName: string | null;
    projectManager: string | null;
    projectState: string | null;
    effort: number | null;
    severity: string;
    reason: string | null;
    thresholdLabel: string | null;
    recommendedAction: string | null;
    email: string | null;
    rowIndex: number | null;
    auditRun: { displayCode: string };
    rule: { name: string; version: number; category: string; source?: string };
  }>;
  policySnapshot: unknown;
  summary: unknown;
}) {
  const issues = run.issues?.map(serializeIssue) ?? [];
  return {
    id: run.id,
    displayCode: run.displayCode,
    fileId: run.fileId,
    requestId: run.requestId,
    status: run.status,
    source: run.source,
    runAt: (run.completedAt ?? run.startedAt).toISOString(),
    scannedRows: run.scannedRows,
    flaggedRows: run.flaggedRows,
    findingsHash: run.findingsHash ?? '',
    issues,
    sheets: ((run.summary as { sheets?: AuditResult['sheets'] } | null)?.sheets ?? []),
    policySnapshot: run.policySnapshot,
    summary: run.summary,
  };
}
