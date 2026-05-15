export const ESCALATION_STAGES = [
  'NEW',
  'DRAFTED',
  'SENT',
  'AWAITING_RESPONSE',
  'RESPONDED',
  'NO_RESPONSE',
  'ESCALATED_L1',
  'ESCALATED_L2',
  'RESOLVED',
] as const;

export type EscalationStage = (typeof ESCALATION_STAGES)[number];

export function isEscalationStage(value: unknown): value is EscalationStage {
  return typeof value === 'string' && (ESCALATION_STAGES as readonly string[]).includes(value);
}

const LEGAL: Record<EscalationStage, readonly EscalationStage[]> = {
  NEW: ['DRAFTED', 'SENT', 'AWAITING_RESPONSE', 'RESOLVED'],
  DRAFTED: ['NEW', 'SENT'],
  SENT: ['AWAITING_RESPONSE', 'RESPONDED', 'NO_RESPONSE', 'RESOLVED'],
  AWAITING_RESPONSE: ['RESPONDED', 'NO_RESPONSE', 'SENT', 'ESCALATED_L1', 'RESOLVED'],
  RESPONDED: ['RESOLVED', 'AWAITING_RESPONSE', 'NO_RESPONSE'],
  NO_RESPONSE: ['ESCALATED_L1', 'SENT', 'AWAITING_RESPONSE', 'RESOLVED'],
  ESCALATED_L1: ['ESCALATED_L2', 'SENT', 'AWAITING_RESPONSE', 'RESOLVED', 'NO_RESPONSE'],
  ESCALATED_L2: ['RESOLVED', 'SENT', 'NO_RESPONSE', 'AWAITING_RESPONSE'],
  RESOLVED: [],
};

export function canTransition(from: EscalationStage, to: EscalationStage): boolean {
  if (from === to) return false;
  return (LEGAL[from] as readonly string[]).includes(to);
}

export function assertTransition(from: EscalationStage, to: EscalationStage): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal escalation transition ${from} -> ${to}`);
  }
}

export function allStagePairs(): Array<[EscalationStage, EscalationStage]> {
  const out: Array<[EscalationStage, EscalationStage]> = [];
  for (const from of ESCALATION_STAGES) {
    for (const to of ESCALATION_STAGES) {
      out.push([from, to]);
    }
  }
  return out;
}

export type TransitionActor = { id: string; email: string; displayName: string };

export type TransitionSlice = {
  stage: EscalationStage;
  escalationLevel: number;
  resolved: boolean;
};

function nextEscalationLevel(from: EscalationStage, to: EscalationStage, current: number): number {
  if (to === 'RESOLVED') return 0;
  if (to === 'ESCALATED_L1') return Math.max(current, 1);
  if (to === 'ESCALATED_L2') return 2;
  return current;
}

export function transition(
  entry: TransitionSlice,
  to: EscalationStage,
  actor: TransitionActor,
  reason: string,
  sourceAction: string,
): {
  next: { stage: EscalationStage; escalationLevel: number; resolved: boolean };
  eventPayload: {
    previousStage: EscalationStage;
    nextStage: EscalationStage;
    reason: string;
    actor: TransitionActor;
    sourceAction: string;
  };
} {
  if (!canTransition(entry.stage, to)) {
    throw new Error(`Illegal transition ${entry.stage} -> ${to}`);
  }
  const resolved = to === 'RESOLVED' ? true : entry.resolved;
  const escalationLevel = nextEscalationLevel(entry.stage, to, entry.escalationLevel);
  return {
    next: { stage: to, escalationLevel, resolved },
    eventPayload: {
      previousStage: entry.stage,
      nextStage: to,
      reason,
      actor,
      sourceAction,
    },
  };
}
