import type { AuditPolicy, AuditResult, WorkbookFile } from '../core/types';
import { FUNCTION_IDS, type FunctionId } from '../project/functions';
import { functionRateAuditEngine } from './function-rate';
import { internalCostRateAuditEngine } from './internal-cost-rate';
import { masterDataAuditEngine } from './master-data';
import { missingPlanAuditEngine } from './missing-plan';
import { opportunitiesAuditEngine } from './opportunities';
import { overPlanningAuditEngine } from './over-planning';
import type { FunctionAuditEngine, FunctionAuditOptions } from './types';

// Registry keyed by functionId. Each function has its own ruleset — do not
// mix them. To swap an engine for a function, register the new one here.
export const FUNCTION_AUDIT_ENGINES: Record<FunctionId, FunctionAuditEngine> = {
  'master-data': masterDataAuditEngine,
  'over-planning': overPlanningAuditEngine,
  'missing-plan': missingPlanAuditEngine,
  'function-rate': functionRateAuditEngine,
  'internal-cost-rate': internalCostRateAuditEngine,
  'opportunities': opportunitiesAuditEngine,
};

export function getFunctionAuditEngine(functionId: string | undefined): FunctionAuditEngine {
  const id = (functionId ?? 'master-data') as FunctionId;
  const engine = FUNCTION_AUDIT_ENGINES[id];
  if (engine) return engine;
  // Unknown / legacy function id — route through the effort-based engine
  // so we never fail silently on a new registry entry. FUNCTION_IDS kept
  // around for anyone debugging (e.g. log the expected values).
  void FUNCTION_IDS;
  return FUNCTION_AUDIT_ENGINES['over-planning'];
}

export function runFunctionAudit(
  functionId: string | undefined,
  file: WorkbookFile,
  policy: AuditPolicy | undefined,
  options: FunctionAuditOptions = {},
): AuditResult {
  return getFunctionAuditEngine(functionId).run(file, policy, options);
}

export { FUNCTION_AUDIT_ENGINES as functionAuditEngines };
export type { FunctionAuditEngine, FunctionAuditOptions } from './types';
export {
  MASTER_DATA_RULE_CATALOG,
  MASTER_DATA_RULES_BY_CODE,
  MD_REQUIRED_COLUMNS,
  MD_COLUMNS,
  MD_REVIEW_OTHERS_RULE_CODE,
  MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
  missingFieldRuleCode,
} from './master-data';
export { isBadValue, isOthersToken, isNotAssignedToken, BAD_VALUE_TOKENS } from './bad-values';
export {
  MISSING_PLAN_RULE_CATALOG,
  MISSING_PLAN_RULES_BY_CODE,
  MP_EFFORT_ZERO_RULE_CODE,
  MP_EFFORT_MISSING_RULE_CODE,
  MP_EFFORT_ALIASES,
} from './missing-plan';
export {
  OVER_PLANNING_ENGINE_RULE_CATALOG,
  OVER_PLANNING_RULES_BY_CODE,
  OP_MONTH_PD_HIGH_RULE_CODE,
  detectPdColumns,
  isPdColumn,
  DEFAULT_PD_THRESHOLD,
} from './over-planning';
export {
  FUNCTION_RATE_RULE_CATALOG,
  FUNCTION_RATE_RULES_BY_CODE,
  FR_RATE_ZERO_RULE_CODE,
  detectRateColumns,
  isRateColumn,
  classifyRateCell,
} from './function-rate';
export {
  INTERNAL_COST_RATE_RULE_CATALOG,
  INTERNAL_COST_RATE_RULES_BY_CODE,
  ICR_COST_ZERO_RULE_CODE,
  detectCostRateColumns,
  isCostRateMonthColumn,
  classifyCostRateCell,
} from './internal-cost-rate';
export {
  OPPORTUNITIES_RULE_CATALOG,
  OPPORTUNITIES_RULES_BY_CODE,
  OPP_CLOSED_DATE_PAST_RULE_CODE,
  OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
  OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
  OPP_BCS_MISSING_RULE_CODE,
  OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
  OPP_INCORRECT_BU_RULE_CODE,
  OPP_COMPOSITE_RULE_CODE,
  DEFAULT_OPPORTUNITIES_POLICY,
} from './opportunities';
export type { OpportunitiesPolicy } from './opportunities';
export {
  normalizeProcessPolicies,
  createDefaultProcessPolicies,
  resolveFunctionPolicy,
} from './policies';
export type {
  OverPlanningPolicy,
  MasterDataPolicy,
  EmptyPolicy,
  FunctionPolicies,
  ProcessPolicies,
} from './policies';