import type { AuditPolicy, AuditResult, WorkbookFile } from '../types';
import { FUNCTION_IDS, type FunctionId } from '../functions';
import { masterDataAuditEngine } from './master-data';
import { createLegacyEngine } from './legacy-engine';
import type { FunctionAuditEngine, FunctionAuditOptions } from './types';

// Registry keyed by functionId. Each function has its own ruleset — do not
// mix them. To swap an engine for a function, register the new one here.
export const FUNCTION_AUDIT_ENGINES: Record<FunctionId, FunctionAuditEngine> = {
  'master-data': masterDataAuditEngine,
  'over-planning': createLegacyEngine('over-planning'),
  'missing-plan': createLegacyEngine('missing-plan'),
  'function-rate': createLegacyEngine('function-rate'),
  'internal-cost-rate': createLegacyEngine('internal-cost-rate'),
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
  missingFieldRuleCode,
} from './master-data';
export { isBadValue, isOthersToken, BAD_VALUE_TOKENS } from './bad-values';
