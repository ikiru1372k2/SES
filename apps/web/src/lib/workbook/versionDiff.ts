// Lightweight wrappers over @ses/domain's compareResults, shaped for the
// UI surfaces that need a summary (Save split button, UnsavedAuditDialog,
// VersionCompare, post-run toast). Centralising here means we stop forking
// the "what changed" phrasing across three components.

import { compareResults } from '../domain/auditEngine';
import type { AuditResult, AuditVersion } from '../domain/types';

export type VersionDiffSummary = {
  added: number;
  resolved: number;
  changed: number;
  unchanged: number;
  severityBumps: number;
  managerReassignments: number;
  /** True when latest has identical findings to the anchor (by hash first, content second). */
  identical: boolean;
};

function sameHash(a: AuditResult, b: AuditResult): boolean {
  return Boolean(a.findingsHash && b.findingsHash && a.findingsHash === b.findingsHash);
}

export function summarizeDiff(anchor: AuditResult | null | undefined, latest: AuditResult | null | undefined): VersionDiffSummary | null {
  if (!anchor || !latest) return null;
  const comparison = compareResults(anchor, latest);
  const severityRank = { Low: 0, Medium: 1, High: 2 } as const;
  const severityBumps = comparison.changedIssues.filter((issue) => {
    const prev = anchor.issues.find((i) => (i.issueKey ?? i.id) === (issue.issueKey ?? issue.id));
    if (!prev) return false;
    return severityRank[issue.severity] > severityRank[prev.severity];
  }).length;
  return {
    added: comparison.newIssues.length,
    resolved: comparison.resolvedIssues.length,
    changed: comparison.changedIssues.length,
    unchanged: comparison.unchangedIssues.length,
    severityBumps,
    managerReassignments: comparison.managerChanges.length,
    identical: sameHash(anchor, latest) || (
      comparison.newIssues.length === 0 &&
      comparison.resolvedIssues.length === 0 &&
      comparison.changedIssues.length === 0
    ),
  };
}

/**
 * Suggest a name for a "Save as new version" based on the diff. Falls
 * back to `${processName} - V${n}` when no clear pattern is detectable.
 */
export function suggestVersionName(processName: string, nextVersionNumber: number, diff: VersionDiffSummary | null): string {
  const fallback = `${processName} - V${nextVersionNumber}`;
  if (!diff || diff.identical) return fallback;
  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (diff.added > 0 && diff.changed === 0 && diff.resolved === 0) {
    return `+${diff.added} finding${diff.added === 1 ? '' : 's'} — ${today}`;
  }
  if (diff.severityBumps > 0 && diff.added === 0 && diff.resolved === 0) {
    return `Severity bumps — ${today}`;
  }
  if (diff.managerReassignments > 0 && diff.added === 0 && diff.resolved === 0 && diff.severityBumps === 0) {
    return `Manager reassignments — ${today}`;
  }
  if (diff.resolved > 0 && diff.added === 0 && diff.changed === 0) {
    return `-${diff.resolved} resolved — ${today}`;
  }
  return fallback;
}

export function formatDiffChips(diff: VersionDiffSummary): string {
  if (diff.identical) return 'No change';
  const parts: string[] = [];
  if (diff.added) parts.push(`+${diff.added} new`);
  if (diff.resolved) parts.push(`-${diff.resolved} resolved`);
  if (diff.changed) parts.push(`~${diff.changed} changed`);
  return parts.length ? parts.join(' · ') : 'No change';
}

export function anchorResultForFile(
  versions: AuditVersion[] | undefined,
  fileId: string | undefined | null,
): AuditResult | null {
  if (!versions || !fileId) return null;
  return versions.find((v) => v.result.fileId === fileId)?.result ?? null;
}
