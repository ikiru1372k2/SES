import { auditIssueKey } from './auditEngine';
import type { AuditIssue, AuditVersion } from './types';

export type EffortAnomaly = {
  issue: AuditIssue;
  previousEffort: number;
  delta: number;
};

export function effortAnomalies(versions: AuditVersion[], minimumDelta = 200): EffortAnomaly[] {
  const [latest, previous] = versions;
  if (!latest || !previous) return [];
  const previousByKey = new Map(previous.result.issues.map((issue) => [auditIssueKey(issue), issue]));
  return latest.result.issues
    .map((issue) => {
      const prev = previousByKey.get(auditIssueKey(issue));
      if (!prev) return null;
      const delta = issue.effort - prev.effort;
      return Math.abs(delta) >= minimumDelta ? { issue, previousEffort: prev.effort, delta } : null;
    })
    .filter((item): item is EffortAnomaly => item !== null);
}
