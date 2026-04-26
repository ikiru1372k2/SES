import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook.js';
import { RULE_CATALOG_BY_FUNCTION } from '../src/auditRules.js';
import {
  getFunctionAuditEngine,
  runFunctionAudit,
  OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
  OPP_BCS_MISSING_RULE_CODE,
  OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
  OPP_CLOSED_DATE_PAST_RULE_CODE,
  OPP_COMPOSITE_RULE_CODE,
  OPP_INCORRECT_BU_RULE_CODE,
  OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
  OPPORTUNITIES_RULE_CATALOG,
} from '../src/functions-audit/index.js';
import { FUNCTION_REGISTRY } from '../src/functions.js';
import type { AuditPolicy, WorkbookFile } from '../src/types.js';

class TestFile extends Blob {
  name: string;
  lastModified: number;
  constructor(parts: BlobPart[], name: string) {
    super(parts);
    this.name = name;
    this.lastModified = Date.now();
  }
}

// Headers mirror the real opportunity export. The workbook parser now accepts
// an opportunities-specific template profile, so the sheet validates without
// needing the classic 'Project No.' / 'Project Manager' columns.
const OPP_HEADERS = [
  'OPP_ID',
  'Opportunity',
  'Country',
  'Probability',
  'Category',
  'Business Unit',
  'BCS_FLAG',
  'PRJ_START_IN_PAST',
  'CLS_DATE_IN_PAST',
  'CLS_DATE',
] as const;

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  // Defaults are a clean row that triggers no rule.
  const defaults: Record<string, unknown> = {
    OPP_ID: 'OPP-1001',
    Opportunity: 'ABC_papm',
    Country: 'Germany',
    Probability: 50,
    Category: 'Other',
    'Business Unit': 'EMEA',
    BCS_FLAG: 12345,
    PRJ_START_IN_PAST: 0,
    CLS_DATE_IN_PAST: 0,
    CLS_DATE: '',
  };
  const merged = { ...defaults, ...overrides };
  return OPP_HEADERS.map((h) => merged[h] ?? '');
}

async function buildWorkbook(
  dataRows: unknown[][],
  fileName = 'opportunities.xlsx',
): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  // The workbook parser requires ≥5 rows to mark a sheet valid.
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) =>
    makeRow({ OPP_ID: `OPP-FILL-${i}` }),
  );
  workbook.addWorksheet('Pipeline').addRows([Array.from(OPP_HEADERS), ...dataRows, ...filler]);
  const buffer = await workbook.xlsx.writeBuffer();
  return parseWorkbook(new TestFile([buffer], fileName) as File);
}

// Pull only the issues that came from the opportunities rule namespace.
// Filler rows are clean by construction, so this should always be the
// intended-under-test rows.
function oppIssues(file: WorkbookFile, policy?: unknown) {
  const result = runFunctionAudit('opportunities', file, policy as AuditPolicy | undefined);
  return result.issues.filter((i) => (i.ruleCode ?? '').startsWith('RUL-OPP-'));
}

test('opportunities workbook headers are recognized as a valid upload template', async () => {
  const file = await buildWorkbook([makeRow()]);
  assert.equal(file.sheets[0]!.status, 'valid');
  assert.deepEqual(file.sheets[0]!.normalizedHeaders?.slice(0, 6), [
    'projectNo',
    'projectName',
    'country',
    'probability',
    'category',
    'businessUnit',
  ]);
});

// ─── Rule-coverage tests ────────────────────────────────────────────────────

test('rule 1: CLS_DATE_IN_PAST=true alone fires closed-date-past', async () => {
  const file = await buildWorkbook([makeRow({ CLS_DATE_IN_PAST: 1, Probability: 95, Category: 'Other' })]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_CLOSED_DATE_PAST_RULE_CODE);
  assert.match(issues[0]!.reason ?? '', /Opportunity closed date in past/);
  assert.equal(issues[0]!.severity, 'High');
  assert.equal(issues[0]!.category, 'Data Quality');
});

test('rule 2 (composite): CLS_DATE_IN_PAST=true + Probability<75 fires both A and B as composite', async () => {
  const file = await buildWorkbook([makeRow({ CLS_DATE_IN_PAST: 1, Probability: 50, Category: 'Other' })]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1, 'expected exactly one consolidated issue per row');
  assert.equal(issues[0]!.ruleCode, OPP_COMPOSITE_RULE_CODE);
  assert.match(issues[0]!.reason ?? '', /Opportunity closed date in past/);
  assert.match(issues[0]!.reason ?? '', /low probability/);
  assert.match(issues[0]!.reason ?? '', /; /, 'composite reason joined by "; "');
  assert.match(issues[0]!.notes ?? '', /\[matched: .*RUL-OPP-CLOSED-DATE-PAST.*RUL-OPP-CLOSED-DATE-PAST-LOW-PROB.*\]/);
});

test('rule 3: PRJ_START_IN_PAST=true + Probability<90 fires project-start-past-low-prob', async () => {
  const file = await buildWorkbook([
    makeRow({ PRJ_START_IN_PAST: 1, Probability: 70, Category: 'Other', CLS_DATE_IN_PAST: 0 }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE);
});

test('rule 4: Service + Probability=90 + BCS_FLAG=# fires BCS missing', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: 90, BCS_FLAG: '#' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_MISSING_RULE_CODE);
});

test('rule 5: Service + Probability<90 + BCS present fires BCS-available-low-prob', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: 80, BCS_FLAG: '12345' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE);
});

test('rule 6: Country=Brazil + BU != Brazil fires incorrect-BU', async () => {
  const file = await buildWorkbook([makeRow({ Country: 'Brazil', 'Business Unit': 'APAC' })]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_INCORRECT_BU_RULE_CODE);
});

test('multi-condition row produces ONE composite issue with all messages joined by "; "', async () => {
  const file = await buildWorkbook([
    makeRow({
      CLS_DATE_IN_PAST: 1,
      Probability: 50,
      Country: 'Brazil',
      'Business Unit': 'APAC',
    }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1, 'multi-condition row collapses to one issue');
  assert.equal(issues[0]!.ruleCode, OPP_COMPOSITE_RULE_CODE);
  const reason = issues[0]!.reason ?? '';
  assert.match(reason, /Opportunity closed date in past/);
  assert.match(reason, /low probability/);
  assert.match(reason, /Incorrect BU mapping/);
  // semicolon-separated, three messages → exactly two separators
  assert.equal(reason.split('; ').length, 3);
  // notes carry the matched rule codes for observability
  assert.match(issues[0]!.notes ?? '', /\[matched: /);
});

test('clean row produces no issues', async () => {
  const file = await buildWorkbook([makeRow()]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 0);
});

// ─── Locked-decision guard tests ────────────────────────────────────────────

test('decision 5 (BCS strict): empty BCS_FLAG does NOT trigger BCS-missing rule', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: 90, BCS_FLAG: '' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 0, 'empty BCS at prob 90 must not fire BCS-missing per locked decision 5');
});

test('decision 5 (BCS strict): whitespace-padded "  #  " still fires BCS-missing (trim applied)', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: 90, BCS_FLAG: '  #  ' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_MISSING_RULE_CODE);
});

test('decision 6 (Brazil BU case-insensitive): lowercase + trailing space matches expected Brazil', async () => {
  const file = await buildWorkbook([
    makeRow({ Country: 'brazil', 'Business Unit': 'brazil ' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 0, 'case/whitespace differences must not fire BU mismatch');
});

test('decision 6 (Brazil BU): "Brasil" (Portuguese spelling) fires incorrect-BU', async () => {
  const file = await buildWorkbook([
    makeRow({ Country: 'Brazil', 'Business Unit': 'Brasil' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_INCORRECT_BU_RULE_CODE);
});

test('decision 8 (probability normalisation): "90.0" string fires BCS-missing', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: '90.0', BCS_FLAG: '#' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_MISSING_RULE_CODE);
});

test('decision 8 (probability normalisation): "90 " whitespace-padded fires BCS-missing', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: '90 ', BCS_FLAG: '#' }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_MISSING_RULE_CODE);
});

test('decision 9 (policy namespace): nested opportunities slice overrides default threshold', async () => {
  // Default close-date low-prob max is 75. Override to 50 → row at prob 60
  // should fire only the closed-date rule (prob 60 ≥ 50, so low-prob check
  // does NOT trigger). Without the override it would fire both as composite.
  const file = await buildWorkbook([
    makeRow({ CLS_DATE_IN_PAST: 1, Probability: 60, Category: 'Other' }),
  ]);
  const overridden = { opportunities: { closeDateLowProbabilityMax: 50 } };
  const issues = oppIssues(file, overridden);
  assert.equal(issues.length, 1);
  assert.equal(
    issues[0]!.ruleCode,
    OPP_CLOSED_DATE_PAST_RULE_CODE,
    'override must suppress the low-prob variant; only the always-on rule fires',
  );
});

test('boolean coercion: PRJ_START_IN_PAST=1 (number) triggers rule 3', async () => {
  const file = await buildWorkbook([
    makeRow({ PRJ_START_IN_PAST: 1, Probability: 70, Category: 'Other', CLS_DATE_IN_PAST: 0 }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE);
});

test('BCS numeric: BCS_FLAG=12345 (number, not string) treated as present', async () => {
  const file = await buildWorkbook([
    makeRow({ Category: 'Service', Probability: 80, BCS_FLAG: 12345 }),
  ]);
  const issues = oppIssues(file);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.ruleCode, OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE);
});

// ─── Regression / isolation tests ───────────────────────────────────────────

test('rule code exclusivity: RUL-OPP-* codes only appear under opportunities', () => {
  for (const [functionId, rules] of Object.entries(RULE_CATALOG_BY_FUNCTION)) {
    if (functionId === 'opportunities') {
      for (const rule of rules) {
        assert.ok(
          rule.ruleCode.startsWith('RUL-OPP-'),
          `opportunities rule ${rule.ruleCode} must start with RUL-OPP-`,
        );
      }
    } else {
      for (const rule of rules) {
        assert.ok(
          !rule.ruleCode.startsWith('RUL-OPP-'),
          `${functionId} must not contain RUL-OPP-* code (${rule.ruleCode})`,
        );
      }
    }
  }
});

test('engine wiring: getFunctionAuditEngine resolves opportunities engine', () => {
  const engine = getFunctionAuditEngine('opportunities');
  assert.equal(engine.functionId, 'opportunities');
});

test('FUNCTION_REGISTRY contains opportunities tile at displayOrder 6', () => {
  const entry = FUNCTION_REGISTRY.find((f) => f.id === 'opportunities');
  assert.ok(entry, 'opportunities must be in FUNCTION_REGISTRY');
  assert.equal(entry!.label, 'Opportunities');
  assert.equal(entry!.displayOrder, 6);
});

test('rule catalog has all 7 opportunities rules', () => {
  assert.equal(OPPORTUNITIES_RULE_CATALOG.length, 7);
  const codes = new Set(OPPORTUNITIES_RULE_CATALOG.map((r) => r.ruleCode));
  for (const required of [
    OPP_CLOSED_DATE_PAST_RULE_CODE,
    OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
    OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
    OPP_BCS_MISSING_RULE_CODE,
    OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
    OPP_INCORRECT_BU_RULE_CODE,
    OPP_COMPOSITE_RULE_CODE,
  ]) {
    assert.ok(codes.has(required), `catalog missing ${required}`);
  }
});

// Policy isolation: prove that a policy containing only opportunities settings
// produces byte-identical output to undefined when run against the missing-plan
// engine. Confirms no other engine reads from policy.opportunities.
test('policy isolation: opportunities slice does not affect missing-plan engine', async () => {
  const ExcelJSMod = (await import('exceljs')).default;
  const wb = new ExcelJSMod.Workbook();
  const headers = ['Project No.', 'Project', 'Project State', 'Project Manager', 'Effort (H)'];
  const rows = [
    headers,
    ['90032101', 'A', 'Opened', 'M1', 0],
    ['90032102', 'B', 'Opened', 'M2', 40],
    ['90032103', 'C', 'Opened', 'M3', 40],
    ['90032104', 'D', 'Opened', 'M4', 40],
    ['90032105', 'E', 'Opened', 'M5', 40],
  ];
  wb.addWorksheet('Effort').addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  const file = await parseWorkbook(new TestFile([buf], 'effort.xlsx') as File);

  const baseline = runFunctionAudit('missing-plan', file, undefined);
  const withOpp = runFunctionAudit('missing-plan', file, {
    opportunities: { closeDateLowProbabilityMax: 0, brazilExpectedBu: 'X' },
  } as unknown as AuditPolicy);

  assert.equal(baseline.issues.length, withOpp.issues.length);
  const codesBaseline = baseline.issues.map((i) => i.ruleCode).sort();
  const codesWithOpp = withOpp.issues.map((i) => i.ruleCode).sort();
  assert.deepEqual(codesBaseline, codesWithOpp);
});

// workbook.ts alias regression: the new OPP_ID/Opportunity aliases must not
// break header detection for existing engines. Build a mixed-header sheet
// using both the new aliases and standard missing-plan headers; confirm the
// missing-plan engine still detects zero-effort rows.
test('workbook alias regression: missing-plan engine still detects zero effort with mixed opportunity-style headers', async () => {
  const ExcelJSMod = (await import('exceljs')).default;
  const wb = new ExcelJSMod.Workbook();
  // OPP_ID aliases projectNo, Opportunity aliases projectName. Project State,
  // Project Manager, Effort (H) provide the rest of CORE_COLUMNS.
  const headers = ['OPP_ID', 'Opportunity', 'Project State', 'Project Manager', 'Effort (H)'];
  const rows = [
    headers,
    ['OPP-1', 'A', 'Opened', 'M1', 0],
    ['OPP-2', 'B', 'Opened', 'M2', 40],
    ['OPP-3', 'C', 'Opened', 'M3', 40],
    ['OPP-4', 'D', 'Opened', 'M4', 40],
    ['OPP-5', 'E', 'Opened', 'M5', 40],
  ];
  wb.addWorksheet('Mixed').addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  const file = await parseWorkbook(new TestFile([buf], 'mixed.xlsx') as File);
  // Sheet must validate (otherwise the engine would see zero rows).
  assert.equal(file.sheets[0]!.status, 'valid');

  const result = runFunctionAudit('missing-plan', file, undefined);
  // Exactly one zero-effort issue from row OPP-1.
  const zeroIssues = result.issues.filter((i) => i.ruleCode === 'RUL-MP-EFFORT-ZERO');
  assert.equal(zeroIssues.length, 1);
  assert.equal(zeroIssues[0]!.projectNo, 'OPP-1');
});
