import type { FunctionId } from '../project/functions';

/**
 * Scope contract for every analytics request.
 * - omit functionId for the process-level rollup
 * - omit versionRef to use the latest completed version in scope
 * - set compareTo for diff/compare views
 */
export interface AnalyticsScope {
  processCode: string;
  functionId?: FunctionId;
  versionRef?: string;
  compareTo?: string;
}

/**
 * Per-function freshness thresholds. A run older than this is shown with
 * a stale ⚠ badge in the dashboard. Default = 90 days; per-function
 * cadence overrides match how often each function actually runs.
 */
export const DEFAULT_FRESHNESS_DAYS: Record<FunctionId | 'default', number> = {
  'master-data': 14,
  'over-planning': 30,
  'missing-plan': 30,
  'function-rate': 120,
  'internal-cost-rate': 120,
  opportunities: 30,
  default: 90,
};

export function freshnessForFunction(functionId: FunctionId | undefined): number {
  if (!functionId) return DEFAULT_FRESHNESS_DAYS.default;
  return DEFAULT_FRESHNESS_DAYS[functionId] ?? DEFAULT_FRESHNESS_DAYS.default;
}
