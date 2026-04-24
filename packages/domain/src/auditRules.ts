import type { IssueCategory, Severity } from './types';
import type { FunctionId } from './functions';
import { FUNCTION_RATE_RULE_CATALOG } from './functions-audit/function-rate/rules';
import { MASTER_DATA_RULE_CATALOG } from './functions-audit/master-data/rules';
import { MISSING_PLAN_RULE_CATALOG } from './functions-audit/missing-plan/rules';
import { OVER_PLANNING_ENGINE_RULE_CATALOG as OVER_PLANNING_RULE_CATALOG_IMPORT } from './functions-audit/over-planning/rules';

export interface RuleCatalogEntry {
  ruleCode: string;
  /**
   * Function that owns this rule. Every rule belongs to exactly one
   * function. Optional on write (derived from the catalog position) but
   * always populated on read via `RULE_CATALOG_BY_FUNCTION`.
   */
  functionId?: FunctionId;
  name: string;
  category: IssueCategory;
  defaultSeverity: Severity;
  description: string;
  version: number;
  isEnabledDefault: boolean;
  paramsSchema: Record<string, unknown>;
}

// Sourced from the dedicated over-planning module so there is one source of truth.
export const OVER_PLANNING_RULE_CATALOG: RuleCatalogEntry[] = OVER_PLANNING_RULE_CATALOG_IMPORT;

// Per-function rule catalog. Every rule must live under exactly one function
// key — this is the structural guarantee the product needs: Master Data
// rules cannot accidentally run for Over Planning, etc. New functions add
// their own catalog and register it here; adding rules never requires
// touching another function's module.
//
// internal-cost-rate is explicitly empty until business owners define its
// rules. The UI renders a clear "no rules configured" empty state rather
// than inheriting another function's rules.
export const RULE_CATALOG_BY_FUNCTION: Record<FunctionId, RuleCatalogEntry[]> = {
  'master-data': MASTER_DATA_RULE_CATALOG,
  'over-planning': OVER_PLANNING_RULE_CATALOG,
  'missing-plan': MISSING_PLAN_RULE_CATALOG,
  'function-rate': FUNCTION_RATE_RULE_CATALOG,
  'internal-cost-rate': [],
};

export function getRuleCatalogForFunction(functionId: FunctionId): RuleCatalogEntry[] {
  return RULE_CATALOG_BY_FUNCTION[functionId] ?? [];
}

// Flat list used by the DB seed loop and the RulesService in-memory fallback.
// Derived from the per-function map so there is exactly one source of truth —
// no risk of the flat list drifting from the per-function registry. Each
// entry's `functionId` is populated from its map key so downstream consumers
// (seed, rules service) can persist the column without looking it up again.
export const AUDIT_RULE_CATALOG: RuleCatalogEntry[] = (
  Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[FunctionId, RuleCatalogEntry[]]>
).flatMap(([functionId, rules]) => rules.map((rule) => ({ ...rule, functionId })));

export const AUDIT_RULES_BY_CODE = new Map(AUDIT_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
