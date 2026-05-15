import type { AuditPolicy } from '../core/types';

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
    onHoldEffortEnabled: true,
    onHoldEffortThreshold: 200,
    pdThreshold: 30,
    opportunities: {
      closeDateLowProbabilityMax: 75,
      projectStartLowProbabilityMax: 90,
      missingBcsProbabilityExact: 90,
      bcsAvailableLowProbabilityMax: 90,
      brazilExpectedBu: 'Brazil',
    },
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
  return (Object.keys(current) as Array<keyof AuditPolicy>).some((key) => key !== 'updatedAt' && current[key] !== snapshot[key]);
}
