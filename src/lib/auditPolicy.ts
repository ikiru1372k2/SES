import type { AuditPolicy } from './types';

export function createDefaultAuditPolicy(now = new Date().toISOString()): AuditPolicy {
  return {
    highEffortThreshold: 900,
    mediumEffortMin: 400,
    mediumEffortMax: 800,
    lowEffortMin: 1,
    lowEffortMax: 399,
    lowEffortEnabled: false,
    zeroEffortEnabled: true,
    missingEffortEnabled: true,
    missingManagerEnabled: true,
    inPlanningEffortEnabled: true,
    onHoldEffortThreshold: 200,
    updatedAt: now,
  };
}

export function normalizeAuditPolicy(policy?: Partial<AuditPolicy>): AuditPolicy {
  return {
    ...createDefaultAuditPolicy(policy?.updatedAt ?? new Date().toISOString()),
    ...policy,
  };
}

export function policySummary(policy: AuditPolicy): string {
  const missing = [
    policy.missingEffortEnabled ? 'missing effort' : '',
    policy.zeroEffortEnabled ? 'zero effort' : '',
  ].filter(Boolean);
  return `QGC Policy: Overplanning >${policy.highEffortThreshold}h${missing.length ? `, ${missing.join(', ')} enabled` : ''}`;
}

export function isPolicyChanged(current: AuditPolicy, snapshot?: AuditPolicy): boolean {
  if (!snapshot) return false;
  return current.updatedAt !== snapshot.updatedAt;
}
