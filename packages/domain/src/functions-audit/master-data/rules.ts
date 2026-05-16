import type { RuleCatalogEntry } from '../../audit/auditRules';
// NOTE: keep `import type` — value import would create a runtime cycle with auditRules.ts.
import { MD_REQUIRED_COLUMNS } from './columns';

// ruleCode is stable across runs and FK'd from AuditRule.ruleCode. Add columns via MD_REQUIRED_COLUMNS.
export function missingFieldRuleCode(columnId: string): string {
  return `RUL-MD-${columnId.toUpperCase()}-MISSING`;
}

// Project Product has three rules (see engine.ts dispatch); MISSING is auto-generated, these two are named.
export const MD_REVIEW_OTHERS_RULE_CODE = 'RUL-MD-PROJECT_PRODUCT-REVIEW-OTHERS';
export const MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE = 'RUL-MD-PROJECT_PRODUCT-NOT-ASSIGNED';

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
    ruleCode: MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
    name: 'Project Product "Not assigned" needs review',
    category: 'Needs Review',
    defaultSeverity: 'Medium',
    description:
      'Project Product contains the literal token "Not assigned" — alone or alongside other entries (e.g. "Not assigned, SAP X"). Treated as a manual review item: someone explicitly deferred picking the product and the auditor needs to follow up with the project team.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    ruleCode: MD_REVIEW_OTHERS_RULE_CODE,
    name: 'Project Product "Others" needs review',
    category: 'Needs Review',
    defaultSeverity: 'Medium',
    description:
      'Project Product contains the literal token "Other" / "Others" — alone or alongside other entries (e.g. "Other, SAP Emarsys"). Treated as a manual review item: the auditor should confirm the actual product or correct the entry.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const MASTER_DATA_RULES_BY_CODE = new Map(
  MASTER_DATA_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]),
);