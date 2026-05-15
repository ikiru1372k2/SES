import type { RuleCatalogEntry } from '../../audit/auditRules';
// NOTE: keep `import type` — a value import would create a runtime cycle with
// auditRules.ts, which imports OPPORTUNITIES_RULE_CATALOG from us.

// All rule codes prefixed RUL-OPP-* so the opportunities namespace cannot
// collide with master-data (RUL-MD-*), missing-plan (RUL-MP-*), function-rate
// (RUL-FR-*), internal-cost-rate (RUL-ICR-*), or over-planning (RUL-EFFORT-*).
export const OPP_CLOSED_DATE_PAST_RULE_CODE = 'RUL-OPP-CLOSED-DATE-PAST';
export const OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE =
  'RUL-OPP-CLOSED-DATE-PAST-LOW-PROB';
export const OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE =
  'RUL-OPP-PROJECT-START-PAST-LOW-PROB';
export const OPP_BCS_MISSING_RULE_CODE = 'RUL-OPP-BCS-MISSING';
export const OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE =
  'RUL-OPP-BCS-AVAILABLE-LOW-PROB';
export const OPP_INCORRECT_BU_RULE_CODE = 'RUL-OPP-INCORRECT-BU';
// Composite code emitted when ≥2 specific checks fire on the same row. The
// reason text always carries every triggered message joined by '; '; the
// `notes` field additionally lists the matched specific codes.
export const OPP_COMPOSITE_RULE_CODE = 'RUL-OPP-COMPOSITE';

const baseSchema = { type: 'object', properties: {}, additionalProperties: false } as const;

export const OPPORTUNITIES_RULE_CATALOG: RuleCatalogEntry[] = [
  {
    ruleCode: OPP_CLOSED_DATE_PAST_RULE_CODE,
    name: 'Opportunity closed date in past',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'CLS_DATE_IN_PAST is true. The opportunity record carries a close date that has already passed and should be reviewed.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
    name: 'Opportunity closed date in past with low probability',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'Closed date is in the past and the win probability is below the configured threshold (default 75).',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
    name: 'Project start date in past with low probability',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'PRJ_START_IN_PAST is true and the win probability is below the configured threshold (default 90).',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_BCS_MISSING_RULE_CODE,
    name: 'BCS code missing',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'Service category opportunity at the configured probability (default 90) has BCS_FLAG = "#" — the BCS code is missing.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
    name: 'BCS code available with less than 90%',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'Service category opportunity carries a BCS code but the win probability is below the configured threshold (default 90).',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_INCORRECT_BU_RULE_CODE,
    name: 'Incorrect BU mapping',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'Country is Brazil but the Business Unit does not match the configured expected value (default "Brazil").',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
  {
    ruleCode: OPP_COMPOSITE_RULE_CODE,
    name: 'Composite opportunity finding',
    category: 'Data Quality',
    defaultSeverity: 'High',
    description:
      'Two or more opportunity checks fired on the same row. The reason field carries the combined messages and the notes field lists the matched specific rule codes.',
    version: 1,
    isEnabledDefault: true,
    paramsSchema: baseSchema,
  },
];

export const OPPORTUNITIES_RULES_BY_CODE = new Map<
  string,
  (typeof OPPORTUNITIES_RULE_CATALOG)[number]
>(OPPORTUNITIES_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
