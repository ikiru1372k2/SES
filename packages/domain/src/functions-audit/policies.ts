import type { FunctionId } from '../project/functions';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../audit/auditPolicy';
import type { AuditPolicy } from '../core/types';
import type { OpportunitiesPolicy } from './opportunities';

export type { OpportunitiesPolicy } from './opportunities';

// Over-planning reuses the legacy AuditPolicy shape for backward compatibility with stored rows.
export type OverPlanningPolicy = AuditPolicy;
export interface MasterDataPolicy {
  /** Reserved for future per-column toggles. */
  enabled?: boolean;
}
export type EmptyPolicy = Record<string, never>;

export interface FunctionPolicies {
  'over-planning': OverPlanningPolicy;
  'master-data': MasterDataPolicy;
  'missing-plan': EmptyPolicy;
  'function-rate': EmptyPolicy;
  'internal-cost-rate': EmptyPolicy;
  'opportunities': OpportunitiesPolicy;
}

export interface ProcessPolicies {
  byFunction: FunctionPolicies;
  updatedAt: string;
}

function isProcessPolicies(value: unknown): value is ProcessPolicies {
  return (
    typeof value === 'object' &&
    value !== null &&
    'byFunction' in value &&
    typeof (value as { byFunction: unknown }).byFunction === 'object'
  );
}

/** Accept legacy `AuditPolicy` or new `ProcessPolicies`. Legacy blobs map to the over-planning slice; no storage migration needed. */
export function normalizeProcessPolicies(raw: unknown): ProcessPolicies {
  const now = new Date().toISOString();
  if (isProcessPolicies(raw)) {
    const by = raw.byFunction ?? ({} as Partial<FunctionPolicies>);
    return {
      byFunction: {
        'over-planning': normalizeAuditPolicy(by['over-planning']),
        'master-data': by['master-data'] ?? {},
        'missing-plan': by['missing-plan'] ?? {},
        'function-rate': by['function-rate'] ?? {},
        'internal-cost-rate': by['internal-cost-rate'] ?? {},
        'opportunities': by['opportunities'] ?? {},
      },
      updatedAt: raw.updatedAt ?? now,
    };
  }
  // Legacy: treat blob as over-planning slice; opportunities live nested under AuditPolicy.opportunities.
  return {
    byFunction: {
      'over-planning': normalizeAuditPolicy(raw as Partial<AuditPolicy> | undefined),
      'master-data': {},
      'missing-plan': {},
      'function-rate': {},
      'internal-cost-rate': {},
      'opportunities': {},
    },
    updatedAt: now,
  };
}

export function createDefaultProcessPolicies(now = new Date().toISOString()): ProcessPolicies {
  return {
    byFunction: {
      'over-planning': createDefaultAuditPolicy(now),
      'master-data': {},
      'missing-plan': {},
      'function-rate': {},
      'internal-cost-rate': {},
      'opportunities': {},
    },
    updatedAt: now,
  };
}

/** Resolve the policy slice for a given function engine (typed call site). */
export function resolveFunctionPolicy<K extends FunctionId>(
  policies: ProcessPolicies,
  functionId: K,
): FunctionPolicies[K] {
  return policies.byFunction[functionId];
}
