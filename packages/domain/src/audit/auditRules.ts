import type { IssueCategory, Severity } from '../core/types';
import type { FunctionId } from '../project/functions';
import { FUNCTION_RATE_RULE_CATALOG } from '../functions-audit/function-rate/rules';
import { INTERNAL_COST_RATE_RULE_CATALOG } from '../functions-audit/internal-cost-rate/rules';
import { MASTER_DATA_RULE_CATALOG } from '../functions-audit/master-data/rules';
import { MISSING_PLAN_RULE_CATALOG } from '../functions-audit/missing-plan/rules';
import { OPPORTUNITIES_RULE_CATALOG } from '../functions-audit/opportunities/rules';
import { OVER_PLANNING_ENGINE_RULE_CATALOG as OVER_PLANNING_RULE_CATALOG_IMPORT } from '../functions-audit/over-planning/rules';

export interface RuleCatalogEntry {
  ruleCode: string;
  /** Owning function. Optional on write (derived from catalog position); always populated on read. */
  functionId?: FunctionId;
  name: string;
  category: IssueCategory;
  defaultSeverity: Severity;
  description: string;
  version: number;
  isEnabledDefault: boolean;
  paramsSchema: Record<string, unknown>;
}

export const OVER_PLANNING_RULE_CATALOG: RuleCatalogEntry[] = OVER_PLANNING_RULE_CATALOG_IMPORT;

// Per-function rule catalog. Every rule lives under exactly one function key — no cross-function sharing.
export const RULE_CATALOG_BY_FUNCTION: Record<FunctionId, RuleCatalogEntry[]> = {
  'master-data': MASTER_DATA_RULE_CATALOG,
  'over-planning': OVER_PLANNING_RULE_CATALOG,
  'missing-plan': MISSING_PLAN_RULE_CATALOG,
  'function-rate': FUNCTION_RATE_RULE_CATALOG,
  'internal-cost-rate': INTERNAL_COST_RATE_RULE_CATALOG,
  'opportunities': OPPORTUNITIES_RULE_CATALOG,
};

export function getRuleCatalogForFunction(functionId: FunctionId): RuleCatalogEntry[] {
  return RULE_CATALOG_BY_FUNCTION[functionId] ?? [];
}

// Flat list (DB seed + RulesService fallback) derived from the per-function map; functionId populated from key.
export const AUDIT_RULE_CATALOG: RuleCatalogEntry[] = (
  Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[FunctionId, RuleCatalogEntry[]]>
).flatMap(([functionId, rules]) => rules.map((rule) => ({ ...rule, functionId })));

export const AUDIT_RULES_BY_CODE = new Map(AUDIT_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
