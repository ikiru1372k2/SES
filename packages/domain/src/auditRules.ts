import type { IssueCategory, Severity } from './types';
import { MASTER_DATA_RULE_CATALOG } from './functions-audit/master-data/rules';

export interface RuleCatalogEntry {
  ruleCode: string;
  name: string;
  category: IssueCategory;
  defaultSeverity: Severity;
  description: string;
  version: number;
  isEnabledDefault: boolean;
  paramsSchema: Record<string, unknown>;
}

const OVER_PLANNING_RULES: RuleCatalogEntry[] = [
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

// Global catalog used by the DB seed, the RulesService fallback, and any
// future consumer that wants a flat list. Per-function rulesets are defined
// in their own modules (e.g. functions-audit/master-data/rules.ts) and
// appended here so they seed into AuditRule and the AuditIssue FK holds.
export const AUDIT_RULE_CATALOG: RuleCatalogEntry[] = [
  ...OVER_PLANNING_RULES,
  ...MASTER_DATA_RULE_CATALOG,
];

export const AUDIT_RULES_BY_CODE = new Map(AUDIT_RULE_CATALOG.map((rule) => [rule.ruleCode, rule]));
