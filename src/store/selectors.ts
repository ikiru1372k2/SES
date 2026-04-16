import { auditIssueKey } from '../lib/auditEngine';
import type { AuditIssue, AuditProcess, AuditResult, IssueComment, IssueCorrection } from '../lib/types';

export function selectIssueComments(process: AuditProcess, issue: AuditIssue): IssueComment[] {
  return process.comments?.[auditIssueKey(issue)] ?? [];
}

export function selectIssueCorrection(process: AuditProcess, issue: AuditIssue): IssueCorrection | undefined {
  return process.corrections?.[auditIssueKey(issue)];
}

export function selectLatestAuditResult(process: AuditProcess): AuditResult | null {
  return process.latestAuditResult ?? process.versions[0]?.result ?? null;
}

export function selectCorrectionCount(process: AuditProcess): number {
  return Object.keys(process.corrections ?? {}).length;
}

export function selectManagerRiskScore(process: AuditProcess, managerName: string): number {
  return selectLatestAuditResult(process)?.issues.filter((issue) => issue.projectManager === managerName).length ?? 0;
}
