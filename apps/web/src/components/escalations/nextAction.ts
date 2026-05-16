import type { ProcessEscalationManagerRow } from '@ses/domain';

export type NextAction =
  | { kind: 'add_to_directory'; label: string; tone: 'amber' }
  | { kind: 'send'; label: string; tone: 'blue' }
  | { kind: 'escalate_l1'; label: string; tone: 'amber' }
  | { kind: 'escalate_l2'; label: string; tone: 'red' }
  | { kind: 'resolve'; label: string; tone: 'emerald' }
  | { kind: 'wait'; label: string; tone: 'gray' };

const FOUR_HOURS_MS = 4 * 3_600_000;

export function effectiveManagerEmail(row: ProcessEscalationManagerRow): string | null {
  return row.resolvedEmail ?? row.directoryEmail ?? null;
}

/**
 * Deterministic next-action suggestion derived from escalation-ladder rules,
 * so auditors can triage by scanning the list.
 */
export function suggestNextAction(row: ProcessEscalationManagerRow, now = Date.now()): NextAction {
  if (row.resolved) {
    return { kind: 'wait', label: 'Resolved', tone: 'gray' };
  }
  if (!effectiveManagerEmail(row)) {
    return { kind: 'add_to_directory', label: 'Add to directory', tone: 'amber' };
  }

  const slaDueMs = row.slaDueAt ? new Date(row.slaDueAt).getTime() : null;
  const slaBreached = slaDueMs !== null && slaDueMs < now;

  switch (row.stage) {
    case 'NEW':
    case 'DRAFTED':
      return { kind: 'send', label: 'Send reminder', tone: 'blue' };

    case 'SENT':
    case 'AWAITING_RESPONSE':
      if (slaBreached) return { kind: 'escalate_l1', label: 'Escalate to L1', tone: 'amber' };
      if (slaDueMs !== null && slaDueMs - now < FOUR_HOURS_MS) {
        return { kind: 'escalate_l1', label: 'SLA due soon — escalate', tone: 'amber' };
      }
      return { kind: 'wait', label: 'Awaiting response', tone: 'gray' };

    case 'NO_RESPONSE':
      return { kind: 'escalate_l1', label: 'Escalate to L1', tone: 'amber' };

    case 'ESCALATED_L1':
      if (slaBreached) return { kind: 'escalate_l2', label: 'Escalate to L2', tone: 'red' };
      return { kind: 'wait', label: 'Waiting on L1 reply', tone: 'gray' };

    case 'ESCALATED_L2':
      return { kind: 'resolve', label: 'Confirm resolution', tone: 'emerald' };

    case 'RESPONDED':
      return { kind: 'resolve', label: 'Mark resolved', tone: 'emerald' };

    default:
      return { kind: 'wait', label: '—', tone: 'gray' };
  }
}

/**
 * Heuristic priority score (higher = more urgent). Factors: open issue count,
 * SLA pressure (breached > due-soon), missing-email de-weight.
 * Pure: used to default-sort the Escalation Center.
 */
export function computePriority(row: ProcessEscalationManagerRow, now = Date.now()): number {
  if (row.resolved) return 0;
  let score = row.totalIssues ?? 0;
  if (row.slaDueAt) {
    const diff = new Date(row.slaDueAt).getTime() - now;
    if (diff < 0) score += 50; // Breached — jump to top.
    else if (diff < 48 * 3_600_000) score += 15;
  }
  if (!effectiveManagerEmail(row)) score *= 0.4; // Can't act → de-weight.
  return Math.round(score * 10) / 10;
}
