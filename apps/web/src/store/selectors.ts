import { auditIssueKey } from '../lib/domain/auditEngine';
import type { AuditIssue, AuditProcess, AuditResult, IssueComment, IssueCorrection } from '../lib/domain/types';

export function selectIssueComments(process: AuditProcess, issue: AuditIssue): IssueComment[] {
  return process.comments?.[auditIssueKey(issue)] ?? [];
}

export function selectIssueCorrection(process: AuditProcess, issue: AuditIssue): IssueCorrection | undefined {
  return process.corrections?.[auditIssueKey(issue)];
}

export function selectLatestAuditResult(process: AuditProcess): AuditResult | null {
  // `latestAuditResult` is a single process-wide field that may belong to a
  // different function. Only trust it when it matches a file in this
  // process's (possibly function-scoped) file list; otherwise fall back to
  // the head version's result. Callers passing the full process are
  // unaffected (every file matches).
  const latest = process.latestAuditResult;
  if (latest && process.files.some((f) => f.id === latest.fileId)) return latest;
  return process.versions[0]?.result ?? null;
}

// Fallback identity hash for pre-#74 audits (no findingsHash). Sort by
// issueKey so engine iteration order doesn't register as a change; content
// digest avoids collisions across different issue sets of the same size.
export function localFindingsSignature(issues: AuditResult['issues']): string {
  const normalized = issues
    .map((i) => `${i.issueKey ?? i.id}|${i.ruleCode ?? ''}|${i.severity ?? ''}`)
    .sort()
    .join('\n');
  // djb2 — non-cryptographic; session-local identity only. Server-side
  // AuditResult.findingsHash is the authoritative identity when available.
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `local:${issues.length}:${(hash >>> 0).toString(16)}`;
}

export function selectHasUnsavedAudit(process: AuditProcess): boolean {
  const latestRun = process.latestAuditResult;
  if (!latestRun) return false;
  // Compare findingsHash content (not timestamps): rerunning on unchanged
  // data has a new runAt but identical findings. Anchor by fileId so multi-
  // file workspaces don't show noisy cross-file "unsaved" banners.
  const sameFileVersion = process.versions.find((v) => v.result.fileId === latestRun.fileId);
  if (!sameFileVersion) return true;
  const savedHash = sameFileVersion.result.findingsHash;
  const latestHash = latestRun.findingsHash;
  if (savedHash && latestHash) return savedHash !== latestHash;
  // Pre-#74 fallback: one side has no hash, compare via local signature.
  return localFindingsSignature(latestRun.issues) !== localFindingsSignature(sameFileVersion.result.issues);
}

export function selectCorrectionCount(process: AuditProcess): number {
  return Object.keys(process.corrections ?? {}).length;
}
