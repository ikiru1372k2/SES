import type { FunctionId } from '@ses/domain';

/** Short subtitles for function tiles (presentation only). */
export const FUNCTION_DESCRIPTIONS: Record<FunctionId, string> = {
  'master-data': 'Manager mapping, cost centers, plant codes',
  'over-planning': 'Plan vs budget, overplanning flags',
  'missing-plan': 'Projects missing effort or plan coverage',
  'function-rate': 'Function rate validation and outliers',
  'internal-cost-rate': 'Internal cost rate alignment checks',
  'opportunities': 'Opportunity pipeline and effort linkage',
};
