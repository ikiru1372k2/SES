import type { RuleCatalogEntry } from '../../audit/auditRules';
// NOTE: keep `import type` — a value import here would create a runtime
// cycle with auditRules.ts, which imports MISSING_PLAN_RULE_CATALOG from us.

// Stable rule code for the zero-effort finding. Prefixed RUL-MP-* to keep
// the missing-plan namespace isolated from over-planning (RUL-EFFORT-*) and
// master-data (RUL-MD-*) rules.
export const MP_EFFORT_ZERO_RULE_CODE = 'RUL-MP-EFFORT-ZERO';
export const MP_EFFORT_MISSING_RULE_CODE = 'RUL-MP-EFFORT-MISSING';

export const MISSING_PLAN_RULE_CATALOG: RuleCatalogEntry[] = [
  {
    ruleCode: MP_EFFORT_ZERO_RULE_CODE,
    name: 'Zero effort',
    category: 'Missing Planning',
    defaultSeverity: 'Medium',
    description:
      'Project has Effort (H) = 0. Active projects should carry planned effort; a zero value indicates missing or deferred planning.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    ruleCode: MP_EFFORT_MISSING_RULE_CODE,
    name: 'Missing effort',
    category: 'Missing Planning',
    defaultSeverity: 'High',
    description:
      'Project has no Effort (H) value recorded. An absent effort entry indicates the project has not been planned.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const MISSING_PLAN_RULES_BY_CODE = new Map<string, (typeof MISSING_PLAN_RULE_CATALOG)[number]>(
  MISSING_PLAN_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]),
);
