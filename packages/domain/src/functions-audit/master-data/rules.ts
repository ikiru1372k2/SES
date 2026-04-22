import type { RuleCatalogEntry } from '../../auditRules';
// NOTE: keep `import type` — a value import here would create a runtime
// cycle with auditRules.ts, which imports MASTER_DATA_RULE_CATALOG from us.
import { MD_REQUIRED_COLUMNS } from './columns';

// Every Master Data rule is keyed by a stable ruleCode so audit findings
// keep their identity across runs and the DB catalog (AuditRule.ruleCode)
// can foreign-key into it. Adding a column? Append to MD_REQUIRED_COLUMNS
// in columns.ts — the rule code below is generated deterministically from
// the column's id.

export function missingFieldRuleCode(columnId: string): string {
  return `RUL-MD-${columnId.toUpperCase()}-MISSING`;
}

export const MD_REVIEW_OTHERS_RULE_CODE = 'RUL-MD-PROJECT_PRODUCT-REVIEW-OTHERS';

export const MASTER_DATA_RULE_CATALOG: RuleCatalogEntry[] = [
  ...MD_REQUIRED_COLUMNS.map<RuleCatalogEntry>((column) => ({
    ruleCode: missingFieldRuleCode(column.id),
    name: `${column.label} required`,
    category: 'Data Quality',
    defaultSeverity: 'High',
    description: `${column.label} must be populated with a real value (not blank, null, "not assigned", "undefined", …).`,
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  })),
  {
    ruleCode: MD_REVIEW_OTHERS_RULE_CODE,
    name: 'Project Product "Others" needs review',
    category: 'Needs Review',
    defaultSeverity: 'Medium',
    description:
      'Project Product is set to "Other"/"Others". Treated as a manual review item — the auditor should confirm the actual product or correct the entry.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const MASTER_DATA_RULES_BY_CODE = new Map(
  MASTER_DATA_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]),
);
