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
 * Given a tracking row, decide what a human auditor would most likely
 * do next. Deterministic, no AI — just the rules the escalation ladder
 * implies — but packaged as a single visible suggestion so auditors can
 * triage by scanning the list instead of reading every row.
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
 * Heuristic priority score: the row with the highest number is the most
 * urgent to act on. Factors (in descending weight):
 *   1. Open issue count — more findings = bigger blast radius.
 *   2. SLA pressure — breached counts 2x, due-soon 1x.
 *   3. Missing-email penalty — can't be actioned until the directory is
 *      fixed, so it sinks below actionable rows but stays visible.
 *
 * Pure function so it can be tested and reused. The Escalation Center
 * uses this to default-sort rows before the user picks a column sort.
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
