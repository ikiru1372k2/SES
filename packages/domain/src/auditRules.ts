import type { IssueCategory, Severity } from './types';
import type { FunctionId } from './functions';
import { MASTER_DATA_RULE_CATALOG } from './functions-audit/master-data/rules';

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

export const OVER_PLANNING_RULE_CATALOG: RuleCatalogEntry[] = [
  {
    ruleCode: 'RUL-EFFORT-OVERPLAN-HIGH',
    name: 'Overplanned effort',
    category: 'Overplanning',
    defaultSeverity: 'High',
    description: 'Effort exceeds the configured overplanning threshold.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: { highEffortThreshold: { type: 'number' } }, required: ['highEffortThreshold'] },
  },
  {
    ruleCode: 'RUL-EFFORT-OVERPLAN-LOW',
    name: 'Low effort range',
    category: 'Effort Threshold',
    defaultSeverity: 'Low',
    description: 'Effort falls inside the low tracking range.',
    version: 1,
    isEnabledDefault: false,
    paramsSchema: {
      type: 'object',
      properties: { lowEffortMin: { type: 'number' }, lowEffortMax: { type: 'number' } },
      required: ['lowEffortMin', 'lowEffortMax'],
    },
  },
  {
    ruleCode: 'RUL-EFFORT-MISSING',
    name: 'Missing effort',
    category: 'Missing Planning',
    defaultSeverity: 'High',
    description: 'Active project has no effort value.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    ruleCode: 'RUL-EFFORT-ZERO',
    name: 'Zero effort',
    category: 'Missing Planning',
    defaultSeverity: 'Medium',
    description: 'Effort is explicitly zero.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    ruleCode: 'RUL-MGR-MISSING',
    name: 'Missing project manager',
    category: 'Missing Data',
    defaultSeverity: 'High',
    description: 'No project manager is assigned.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    ruleCode: 'RUL-STATE-ONHOLD-EFFORT',
    name: 'On Hold with effort',
    category: 'Planning Risk',
    defaultSeverity: 'High',
    description: 'Project is On Hold while still carrying effort.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: { onHoldEffortThreshold: { type: 'number' } }, required: ['onHoldEffortThreshold'] },
  },
  {
    ruleCode: 'RUL-STATE-INPLAN-EFFORT',
    name: 'In Planning with effort',
    category: 'Planning Risk',
    defaultSeverity: 'Medium',
    description: 'Project is in planning while already carrying effort.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// Per-function rule catalog. Every rule must live under exactly one function
// key — this is the structural guarantee the product needs: Master Data
// rules cannot accidentally run for Over Planning, etc. New functions add
// their own catalog and register it here; adding rules never requires
// touching another function's module.
//
// missing-plan / function-rate / internal-cost-rate are explicitly empty
// until business owners define the rules. The UI renders a clear
// "no rules configured" empty state rather than inheriting another
// function's rules.
export const RULE_CATALOG_BY_FUNCTION: Record<FunctionId, RuleCatalogEntry[]> = {
  'master-data': MASTER_DATA_RULE_CATALOG,
  'over-planning': OVER_PLANNING_RULE_CATALOG,
  'missing-plan': [],
  'function-rate': [],
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
