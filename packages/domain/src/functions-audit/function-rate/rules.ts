import type { RuleCatalogEntry } from '../../auditRules';
// NOTE: keep `import type` — a value import would create a runtime cycle with
// auditRules.ts, which imports FUNCTION_RATE_RULE_CATALOG from us.

export const FR_RATE_ZERO_RULE_CODE = 'RUL-FR-RATE-ZERO';

export const FUNCTION_RATE_RULE_CATALOG: RuleCatalogEntry[] = [
  {
    ruleCode: FR_RATE_ZERO_RULE_CODE,
    name: 'Zero external rate',
    category: 'Function Rate',
    defaultSeverity: 'High',
    description:
      'One or more monthly External Rate columns have a value of exactly 0. A zero rate indicates the resource has not been priced for that period. Blank / missing rate cells are intentionally ignored.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const FUNCTION_RATE_RULES_BY_CODE = new Map<
  string,
  (typeof FUNCTION_RATE_RULE_CATALOG)[number]
>(FUNCTION_RATE_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
