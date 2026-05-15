import type { RuleCatalogEntry } from '../../audit/auditRules';
// NOTE: keep `import type` — a value import would create a runtime cycle with
// auditRules.ts, which imports INTERNAL_COST_RATE_RULE_CATALOG from us.

export const ICR_COST_ZERO_RULE_CODE = 'RUL-ICR-COST-ZERO';

export const INTERNAL_COST_RATE_RULE_CATALOG: RuleCatalogEntry[] = [
  {
    ruleCode: ICR_COST_ZERO_RULE_CODE,
    name: 'Zero internal cost rate',
    category: 'Internal Cost Rate',
    defaultSeverity: 'High',
    description:
      'One or more monthly Internal Cost Rate columns have a value of exactly 0. A zero cost rate indicates the resource has not been costed for that period. Blank / missing cells are intentionally ignored.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const INTERNAL_COST_RATE_RULES_BY_CODE = new Map<
  string,
  (typeof INTERNAL_COST_RATE_RULE_CATALOG)[number]
>(INTERNAL_COST_RATE_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
