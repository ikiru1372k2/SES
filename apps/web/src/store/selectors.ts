import { auditIssueKey } from '../lib/domain/auditEngine';
import type { AuditIssue, AuditProcess, AuditResult, IssueComment, IssueCorrection } from '../lib/domain/types';

export function selectIssueComments(process: AuditProcess, issue: AuditIssue): IssueComment[] {
  return process.comments?.[auditIssueKey(issue)] ?? [];
}

export function selectIssueCorrection(process: AuditProcess, issue: AuditIssue): IssueCorrection | undefined {
  return process.corrections?.[auditIssueKey(issue)];
}

export function selectLatestAuditResult(process: AuditProcess): AuditResult | null {
  return process.latestAuditResult ?? process.versions[0]?.result ?? null;
}

// Fallback identity hash for audits that predate issue #74 (no findingsHash
// on server-side results, no local signature persisted). Same shape as the
// signature used by the runAudit autosave so comparisons stay consistent.
// L6: sort by issueKey first so re-orders (parallel engine, different
// iteration order) don't register as different findings. Content-derived
// digest (not just length) so two different issue sets of the same size
// don't collide.
export function localFindingsSignature(issues: AuditResult['issues']): string {
  const normalized = issues
    .map((i) => `${i.issueKey ?? i.id}|${i.ruleCode ?? ''}|${i.severity ?? ''}`)
    .sort()
    .join('\n');
  // djb2 is a tiny, dependency-free non-cryptographic hash. Good enough for
  // session-local identity checks — the *real* identity hash comes from the
  // server via AuditResult.findingsHash whenever it exists.
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `local:${issues.length}:${(hash >>> 0).toString(16)}`;
}

export function selectHasUnsavedAudit(process: AuditProcess): boolean {
  const latestRun = process.latestAuditResult;
  if (!latestRun) return false;
  // Compare findings content (findingsHash), not timestamps. Rerunning an
  // audit on unchanged data produces a newer runAt but identical findings;
  // the prior saved version is still a valid anchor — nothing needs saving.
  // Anchor the comparison to the same file: different files produce
  // different findings by construction, and cross-file comparison produced
  // noisy "unsaved" banners on workspaces with multiple files.
  const sameFileVersion = process.versions.find((v) => v.result.fileId === latestRun.fileId);
  if (!sameFileVersion) return true;
  const savedHash = sameFileVersion.result.findingsHash;
  const latestHash = latestRun.findingsHash;
  if (savedHash && latestHash) return savedHash !== latestHash;
  // Legacy fallback: one side has no hash (pre-#74 version). Compute a
  // local signature from the issues array instead.
  return localFindingsSignature(latestRun.issues) !== localFindingsSignature(sameFileVersion.result.issues);
}

export function selectCorrectionCount(process: AuditProcess): number {
  return Object.keys(process.corrections ?? {}).length;
}
