import type { FunctionId } from '../functions';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../auditPolicy';
import type { AuditPolicy } from '../types';
import type { OpportunitiesPolicy } from './opportunities';

export type { OpportunitiesPolicy } from './opportunities';

// Per-function policy slice. Over-planning keeps its effort thresholds
// under the historical name (AuditPolicy) so existing code and DB rows
// continue to work unchanged. Other functions get their own empty slice
// for now — we'll fill these in as the product adds real rules.
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

/**
 * Accept either the legacy single-blob `AuditPolicy` (all tenants before
 * the rework) or the new `ProcessPolicies` shape. Legacy blobs map to the
 * over-planning slice — that's what they always drove. Nothing in storage
 * needs to be migrated: the read-time normaliser handles both forever.
 */
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
  // Legacy shape: treat the blob as the over-planning slice. Opportunities
  // settings live nested under AuditPolicy.opportunities, so normalising the
  // blob via normalizeAuditPolicy already preserves them — we still expose an
  // empty per-function slice here to keep the FunctionPolicies shape uniform.
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

/**
 * Resolve the policy slice that a specific function engine should see.
 * Engines can accept `undefined` — they fall back to defaults — but this
 * keeps the call site readable and typed.
 */
export function resolveFunctionPolicy<K extends FunctionId>(
  policies: ProcessPolicies,
  functionId: K,
): FunctionPolicies[K] {
  return policies.byFunction[functionId];
}
