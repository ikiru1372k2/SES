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
// Missing-plan toggles share the same names as the legacy AuditPolicy
// fields. Having them on the slice lets `normalizeProcessPolicies` carry
// the legacy single-blob settings forward so the engine sees them
// regardless of whether the caller stores ProcessPolicies or the legacy
// AuditPolicy shape.
export interface MissingPlanPolicy {
  zeroEffortEnabled?: boolean;
  missingEffortEnabled?: boolean;
}
export type EmptyPolicy = Record<string, never>;

export interface FunctionPolicies {
  'over-planning': OverPlanningPolicy;
  'master-data': MasterDataPolicy;
  'missing-plan': MissingPlanPolicy;
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

// Pull missing-plan flags out of a legacy AuditPolicy blob. The two
// toggles historically lived on the over-planning blob even though the
// missing-plan engine consumes them — the per-function rework moved each
// engine to its own slice but this carry-over keeps stored legacy policies
// (and the QGC drawer, which still writes the flat AuditPolicy shape)
// driving the missing-plan engine the same way they always did.
function extractMissingPlanFromLegacy(
  raw: Partial<AuditPolicy> | undefined,
): MissingPlanPolicy {
  if (!raw) return {};
  const slice: MissingPlanPolicy = {};
  if (raw.zeroEffortEnabled !== undefined) slice.zeroEffortEnabled = raw.zeroEffortEnabled;
  if (raw.missingEffortEnabled !== undefined) slice.missingEffortEnabled = raw.missingEffortEnabled;
  return slice;
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
    const op = normalizeAuditPolicy(by['over-planning']);
    // Carry the missing-plan flags from over-planning if the missing-plan
    // slice did not set them itself. Keeps the legacy QGC drawer (which
    // writes the flags onto the over-planning blob) driving the missing-
    // plan engine after a process has been migrated to ProcessPolicies.
    const missingPlanExplicit = (by['missing-plan'] ?? {}) as MissingPlanPolicy;
    const missingPlan: MissingPlanPolicy = {
      ...extractMissingPlanFromLegacy(op),
      ...missingPlanExplicit,
    };
    return {
      byFunction: {
        'over-planning': op,
        'master-data': by['master-data'] ?? {},
        'missing-plan': missingPlan,
        'function-rate': by['function-rate'] ?? {},
        'internal-cost-rate': by['internal-cost-rate'] ?? {},
        'opportunities': by['opportunities'] ?? {},
      },
      updatedAt: raw.updatedAt ?? now,
    };
  }
  // Legacy shape: treat the blob as the over-planning slice. Opportunities
  // settings live nested under AuditPolicy.opportunities, so normalising the
  // blob via normalizeAuditPolicy already preserves them. The missing-plan
  // toggles also live on the legacy blob — copy them to the missing-plan
  // slice so `resolveFunctionPolicy(_, 'missing-plan')` returns the toggles
  // instead of an empty object.
  const legacy = raw as Partial<AuditPolicy> | undefined;
  return {
    byFunction: {
      'over-planning': normalizeAuditPolicy(legacy),
      'master-data': {},
      'missing-plan': extractMissingPlanFromLegacy(legacy),
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
