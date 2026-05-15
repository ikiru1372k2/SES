import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook/workbook.js';
import { RULE_CATALOG_BY_FUNCTION, getRuleCatalogForFunction } from '../src/audit/auditRules.js';
import {
  getFunctionAuditEngine,
  MP_EFFORT_ALIASES,
  MP_EFFORT_ZERO_RULE_CODE,
  MP_EFFORT_MISSING_RULE_CODE,
  MISSING_PLAN_RULE_CATALOG,
  runFunctionAudit,
} from '../src/functions-audit/index.js';
import type { WorkbookFile } from '../src/core/types.js';

class TestFile extends Blob {
  name: string;
  lastModified: number;

  constructor(parts: BlobPart[], name: string) {
    super(parts);
    this.name = name;
    this.lastModified = Date.now();
  }
}

// Minimal header set that satisfies the workbook parser's CORE_COLUMNS
// threshold (projectNo + projectManager + projectState + effort) so the sheet
// is marked valid and selected.
const BASE_HEADERS = [
  'Project No.',
  'Project',
  'Project State',
  'Project Manager',
  'Project Manager Email',
  'Effort (H)',
];

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    'Project No.': '90032101',
    Project: 'Digital Core SAP S4',
    'Project State': 'Opened',
    'Project Manager': 'Wagner, Anna',
    'Project Manager Email': 'anna.wagner@example.com',
    'Effort (H)': 40,
  };
  const merged = { ...defaults, ...overrides };
  return BASE_HEADERS.map((h) => merged[h] ?? '');
}

async function buildWorkbook(
  headers: string[],
  dataRows: unknown[][],
  fileName = 'effort-tracker.xlsx',
): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  // The workbook parser requires ≥5 rows to mark a sheet valid.
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) => {
    const base = headers.map(() => '');
    // projectNo is always first in BASE_HEADERS; supply unique values for filler
    const projectNoIndex = headers.indexOf('Project No.');
    if (projectNoIndex >= 0) base[projectNoIndex] = `FILL-${i}`;
    const effortIndex = headers.findIndex((h) =>
      ['effort (h)', 'effort h', 'effort', 'hours', 'planned effort'].includes(h.toLowerCase()),
    );
    if (effortIndex >= 0) base[effortIndex] = 40; // non-zero filler so they don't pollute issue counts
    const stateIndex = headers.indexOf('Project State');
    if (stateIndex >= 0) base[stateIndex] = 'Opened';
    const mgrIndex = headers.indexOf('Project Manager');
    if (mgrIndex >= 0) base[mgrIndex] = 'Filler Manager';
    return base;
  });
  workbook.addWorksheet('Effort').addRows([headers, ...dataRows, ...filler]);
  const buffer = await workbook.xlsx.writeBuffer();
  return parseWorkbook(new TestFile([buffer], fileName) as File);
}

// ─── Column matching ────────────────────────────────────────────────────────

test('MP_EFFORT_ALIASES includes all expected variants', () => {
  const lower = MP_EFFORT_ALIASES.map((a) => a.toLowerCase());
  for (const variant of ['effort (h)', 'effort(h)', 'effort h', 'effort', 'hours', 'planned effort']) {
    assert.ok(lower.includes(variant), `expected alias list to include "${variant}"`);
  }
});

test('engine resolves effort column with messy header spellings', async () => {
  const variants: Array<[string, unknown]> = [
    ['effort(h)', 0],
    ['EFFORT (H)', 0],
    ['Effort H', 0],
    ['planned effort', 0],
    ['hours', 0],
  ];

  for (const [header, effortValue] of variants) {
    const headers = ['Project No.', 'Project', 'Project State', 'Project Manager', header];
    const dataRow = ['90032101', 'Test Project', 'Opened', 'Wagner, Anna', effortValue];
    const file = await buildWorkbook(headers, [dataRow]);
    const result = runFunctionAudit('missing-plan', file, undefined);
    assert.ok(
      result.issues.length >= 1,
      `expected at least 1 issue for header variant "${header}", got ${result.issues.length}`,
    );
    assert.equal(result.issues[0]!.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
  }
});

// ─── Zero effort detection ──────────────────────────────────────────────────

test('flags row with numeric effort = 0', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0 })]);
  const result = runFunctionAudit('missing-plan', file, undefined, { issueScope: 'PRC-TEST' });

  assert.ok(result.scannedRows >= 1);
  assert.equal(result.flaggedRows, 1);
  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
  assert.equal(issue.effort, 0);
  assert.equal(issue.severity, 'Medium');
  assert.equal(issue.category, 'Missing Planning');
});

test('flags row with string effort "0"', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': '0' })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
});

test('flags row with float effort 0.0', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0.0 })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
});

// ─── Non-zero rows not flagged ───────────────────────────────────────────────

test('does not flag row with effort = 40', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 40 })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 0);
  assert.equal(result.flaggedRows, 0);
});

test('does not flag row with effort = 0.5', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0.5 })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 0);
});

// ─── Missing effort (blank/absent) flagged when missingEffortEnabled ─────────

test('flags row with blank effort cell (missingEffortEnabled=true by default)', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': '' })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 1, 'blank effort should produce a missing-effort finding');
  assert.equal(result.issues[0]!.ruleCode, 'RUL-MP-EFFORT-MISSING');
});

test('flags row with undefined effort cell (missingEffortEnabled=true by default)', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': undefined })]);
  const result = runFunctionAudit('missing-plan', file, undefined);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, 'RUL-MP-EFFORT-MISSING');
});

test('does NOT flag blank effort when missingEffortEnabled=false', async () => {
  const { normalizeAuditPolicy } = await import('../src/audit/auditPolicy.js');
  const policy = normalizeAuditPolicy({ missingEffortEnabled: false });
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': '' })]);
  const result = runFunctionAudit('missing-plan', file, policy);

  assert.equal(result.issues.length, 0, 'blank effort should NOT be flagged when missingEffortEnabled=false');
});

test('does NOT flag zero effort when zeroEffortEnabled=false', async () => {
  const { normalizeAuditPolicy } = await import('../src/audit/auditPolicy.js');
  const policy = normalizeAuditPolicy({ zeroEffortEnabled: false });
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0 })]);
  const result = runFunctionAudit('missing-plan', file, policy);

  assert.equal(result.issues.length, 0, 'zero effort should NOT be flagged when zeroEffortEnabled=false');
});

// ─── Engine registration ─────────────────────────────────────────────────────

test('missing-plan routes to the dedicated engine, not the legacy engine', () => {
  const engine = getFunctionAuditEngine('missing-plan');
  assert.equal(engine.functionId, 'missing-plan');
  // The legacy engine wraps runAudit and does NOT expose a named property we
  // can inspect, so we verify via the rule catalog: the dedicated engine
  // populates issues with MP_EFFORT_ZERO_RULE_CODE, which the legacy engine
  // would never produce. We verify this indirectly via the catalog check below.
});

test('missing-plan rule catalog is not empty', () => {
  const catalog = getRuleCatalogForFunction('missing-plan');
  assert.ok(catalog.length > 0, 'expected at least one rule in the missing-plan catalog');
  assert.ok(
    catalog.some((r) => r.ruleCode === MP_EFFORT_ZERO_RULE_CODE),
    `expected ${MP_EFFORT_ZERO_RULE_CODE} in the catalog`,
  );
});

// ─── Rule isolation ──────────────────────────────────────────────────────────

test('RUL-MP-* codes appear only under missing-plan in RULE_CATALOG_BY_FUNCTION', () => {
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[string, typeof MISSING_PLAN_RULE_CATALOG]>;
  for (const [functionId, rules] of entries) {
    if (functionId === 'missing-plan') continue;
    for (const rule of rules) {
      assert.ok(
        !rule.ruleCode.startsWith('RUL-MP-'),
        `found RUL-MP-* code "${rule.ruleCode}" under function "${functionId}" — rule codes must be function-owned`,
      );
    }
  }
});

test('no ruleCode appears in more than one function catalog', () => {
  const seen = new Map<string, string>();
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[string, typeof MISSING_PLAN_RULE_CATALOG]>;
  for (const [functionId, rules] of entries) {
    for (const rule of rules) {
      if (seen.has(rule.ruleCode)) {
        assert.fail(
          `ruleCode "${rule.ruleCode}" appears under both "${seen.get(rule.ruleCode)}" and "${functionId}"`,
        );
      }
      seen.set(rule.ruleCode, functionId);
    }
  }
});

// ─── Issue metadata ──────────────────────────────────────────────────────────

test('issue payload carries all required metadata fields', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0 })]);
  const result = runFunctionAudit('missing-plan', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;

  assert.ok(issue.projectNo, 'projectNo must be populated');
  assert.ok(issue.projectName, 'projectName must be populated');
  assert.ok(issue.projectManager, 'projectManager must be populated');
  assert.ok(issue.projectState, 'projectState must be populated');
  assert.ok(issue.sheetName, 'sheetName must be populated');
  assert.ok(typeof issue.rowIndex === 'number', 'rowIndex must be a number');
  assert.equal(issue.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
  assert.ok(issue.severity, 'severity must be populated');
  assert.equal(issue.category, 'Missing Planning');
  assert.ok(issue.reason, 'reason must be populated');
  assert.ok(issue.recommendedAction, 'recommendedAction must be populated');
});

// ─── End-to-end with issueKey ─────────────────────────────────────────────────

test('end-to-end: zero-effort row produces issue with IKY- issueKey', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Effort (H)': 0 })]);
  const result = runFunctionAudit('missing-plan', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.ok(issue.issueKey, 'issueKey must be present when issueScope is provided');
  assert.match(issue.issueKey!, /^IKY-/, 'issueKey must start with IKY-');
  assert.equal(issue.ruleCode, MP_EFFORT_ZERO_RULE_CODE);
  assert.equal(issue.effort, 0);
});

test('end-to-end: mixed rows — zero-effort and blank-effort rows flagged', async () => {
  const rows = [
    makeRow({ 'Project No.': 'P001', 'Effort (H)': 0 }),    // zero → RUL-MP-EFFORT-ZERO
    makeRow({ 'Project No.': 'P002', 'Effort (H)': 100 }),   // positive → not flagged
    makeRow({ 'Project No.': 'P003', 'Effort (H)': 0 }),    // zero → RUL-MP-EFFORT-ZERO
    makeRow({ 'Project No.': 'P004', 'Effort (H)': 50 }),    // positive → not flagged
    makeRow({ 'Project No.': 'P005', 'Effort (H)': '' }),    // blank → RUL-MP-EFFORT-MISSING
  ];
  const file = await buildWorkbook(BASE_HEADERS, rows);
  const result = runFunctionAudit('missing-plan', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.flaggedRows, 3, 'two zero-effort and one blank-effort row should be flagged');
  assert.equal(result.issues.length, 3);
  const flaggedNos = result.issues.map((i) => i.projectNo).sort();
  assert.deepEqual(flaggedNos, ['P001', 'P003', 'P005']);
});
