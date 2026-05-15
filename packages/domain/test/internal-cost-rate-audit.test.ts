import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook/workbook.js';
import { RULE_CATALOG_BY_FUNCTION, getRuleCatalogForFunction } from '../src/audit/auditRules.js';
import { FUNCTION_REGISTRY } from '../src/project/functions.js';
import {
  FR_RATE_ZERO_RULE_CODE,
  ICR_COST_ZERO_RULE_CODE,
  INTERNAL_COST_RATE_RULE_CATALOG,
  classifyCostRateCell,
  detectCostRateColumns,
  getFunctionAuditEngine,
  isCostRateMonthColumn,
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

// Real ICR files lack `Project Manager` / `Project State` columns — the API
// Project-ID → Manager pre-pass fills those post-engine. For unit fixtures we
// include them so the parser's identity-score gate (score ≥ 4) passes without
// needing to duplicate parser internals; case 9 below exercises the true
// no-PM/no-state shape via the real sample file.
const BASE_HEADERS = [
  'Project ID',
  'Project Name',
  'Project State',
  'Project Manager',
  'Function',
  'Employee Name',
  'Cost Rate',
  'Jan 31, 2026',
  'Feb 28, 2026',
  'Mar 31, 2026',
];

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    'Project ID': 'ICR-001',
    'Project Name': 'Internal Cost Rate Test Project',
    'Project State': 'Opened',
    'Project Manager': 'Wagner, Anna',
    Function: 'msg contractor',
    'Employee Name': 'Corl, Cristina',
    'Cost Rate': 150,
    'Jan 31, 2026': 150,
    'Feb 28, 2026': 150,
    'Mar 31, 2026': 150,
  };
  const merged = { ...defaults, ...overrides };
  return BASE_HEADERS.map((h) => merged[h] ?? '');
}

async function buildWorkbook(
  headers: string[],
  dataRows: unknown[][],
  fileName = 'internal-cost-rate.xlsx',
): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  // Pad to ≥5 data rows so the parser classifies the sheet as valid. Fillers
  // carry nonzero cost rates so only explicit test rows can flag.
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) => {
    const base = headers.map(() => '' as unknown);
    const idCol = headers.indexOf('Project ID');
    if (idCol >= 0) base[idCol] = `FILL-${i}`;
    const stateCol = headers.indexOf('Project State');
    if (stateCol >= 0) base[stateCol] = 'Opened';
    const mgrCol = headers.indexOf('Project Manager');
    if (mgrCol >= 0) base[mgrCol] = 'Filler Manager';
    for (const h of ['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026']) {
      const idx = headers.indexOf(h);
      if (idx >= 0) base[idx] = 100;
    }
    return base;
  });
  workbook.addWorksheet('Cost Rates').addRows([headers, ...dataRows, ...filler]);
  const buffer = await workbook.xlsx.writeBuffer();
  return parseWorkbook(new TestFile([buffer], fileName) as File);
}

// ─── isCostRateMonthColumn unit tests ──────────────────────────────────────

test('isCostRateMonthColumn: positive cases', () => {
  const positives = [
    'Jan 31, 2026',
    'Feb 28 2026',
    'March 2026',
    'September 30, 2026',
    '2026 January',
    'Jan-2026',
    'Apr 30 2025',
  ];
  for (const header of positives) {
    assert.ok(isCostRateMonthColumn(header), `expected "${header}" to be a month column`);
  }
});

test('isCostRateMonthColumn: negative cases', () => {
  const negatives = [
    'Employee Name',
    'Project Name',
    'Cost Rate',
    'Function',
    'Project ID',
    'Task Name',
    'BU Name (Project)',
    'Country Name (Project)',
    'Effort Month',
    'Measures',
    '2026', // year alone, no month
    'Jan', // month alone, no year
  ];
  for (const header of negatives) {
    assert.ok(!isCostRateMonthColumn(header), `expected "${header}" NOT to be a month column`);
  }
});

// ─── classifyCostRateCell ──────────────────────────────────────────────────

test('classifyCostRateCell: only exactly-zero flags; blanks/negatives/text ignored', () => {
  const row = [0, '0', '0.0', '  0  ', ' 0.0 ', -0, '', null, undefined, '12.5', 125, -5, 'abc', 'n/a', 'TBD'];
  const grid: unknown[][] = [row];
  assert.equal(classifyCostRateCell(grid, 0, 0), 'zero', 'numeric 0 -> zero');
  assert.equal(classifyCostRateCell(grid, 0, 1), 'zero', 'string "0" -> zero');
  assert.equal(classifyCostRateCell(grid, 0, 2), 'zero', 'string "0.0" -> zero');
  assert.equal(classifyCostRateCell(grid, 0, 3), 'zero', 'whitespace-padded "0" -> zero');
  assert.equal(classifyCostRateCell(grid, 0, 4), 'zero', 'whitespace-padded "0.0" -> zero');
  assert.equal(classifyCostRateCell(grid, 0, 5), 'zero', 'numeric -0 -> zero (since -0 === 0)');
  assert.equal(classifyCostRateCell(grid, 0, 6), 'ignore', 'empty string -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 7), 'ignore', 'null -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 8), 'ignore', 'undefined -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 9), 'ignore', 'positive string -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 10), 'ignore', 'positive number -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 11), 'ignore', 'negative number -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 12), 'ignore', 'non-numeric text -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 13), 'ignore', '"n/a" -> ignore');
  assert.equal(classifyCostRateCell(grid, 0, 14), 'ignore', '"TBD" -> ignore');
});

// ─── detectCostRateColumns ─────────────────────────────────────────────────

test('detectCostRateColumns: single-row scan returns only month columns', () => {
  const rawRows = [
    [
      'Project ID',
      'Project Name',
      'Cost Rate',
      'Jan 31, 2026',
      'Feb 28, 2026',
      'Mar 31, 2026',
      'Function',
    ],
  ];
  const cols = detectCostRateColumns(rawRows);
  const labels = cols.map((c) => c.label);
  assert.deepEqual(labels, ['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026']);
  assert.equal(cols[0]?.colIndex, 3);
  assert.equal(cols[2]?.colIndex, 5);
});

test('detectCostRateColumns: two-row merge handles "Effort Month" banner + date row', () => {
  const rawRows = [
    ['', '', '', 'Effort Month', 'Effort Month', 'Effort Month'],
    ['Project ID', 'Project Name', 'Cost Rate', 'Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026'],
  ];
  const cols = detectCostRateColumns(rawRows);
  assert.equal(cols.length, 3, `expected 3 month columns, got ${cols.length}`);
  // Strategy A already wins here — row 1 has the date labels directly — so
  // labels should be the raw date strings from row 1, unmerged. This is the
  // intentional tie-break (prefer clean labels).
  assert.deepEqual(
    cols.map((c) => c.label),
    ['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026'],
  );
});

test('detectCostRateColumns: strategy B wins when only the merge matches', () => {
  // Row 0 has partial date text that wouldn't match alone; row 1 has month
  // names. Only the merge yields "rate" columns — but ICR detection doesn't
  // require "rate" in the header, so this tests that merged "<category>
  // <month year>" matches too.
  const rawRows = [
    ['', '', 'Effort 2026', 'Effort 2026'],
    ['Project ID', 'Project Name', 'Jan', 'Feb'],
  ];
  const cols = detectCostRateColumns(rawRows);
  // Row 0: "Effort 2026" has year but no month -> 0 matches.
  // Row 1: "Jan", "Feb" have month but no year -> 0 matches.
  // Merged: "Effort 2026 Jan", "Effort 2026 Feb" -> 2 matches.
  assert.equal(cols.length, 2, `expected 2 merged columns, got ${cols.length}`);
  assert.equal(cols[0]?.colIndex, 2);
});

// ─── Flagging behavior ────────────────────────────────────────────────────

test('flags row when exactly 1 month is 0; missingMonths=[that month]', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 31, 2026': 0 })]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1, 'exactly one issue');
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, ICR_COST_ZERO_RULE_CODE);
  assert.equal(issue.zeroMonthCount, 1);
  assert.deepEqual([...(issue.missingMonths ?? [])], ['Jan 31, 2026']);
  assert.equal(issue.effort, 1, 'effort = zeroMonthCount');
  assert.equal(issue.category, 'Internal Cost Rate');
  assert.equal(issue.severity, 'High');
  assert.equal(issue.thresholdLabel, '= 0');
  assert.match(issue.reason ?? '', /Jan 31, 2026/);
});

test('flags row when multiple months are 0; missingMonths lists all in left-to-right order', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'Jan 31, 2026': 0,
      'Feb 28, 2026': 0,
      'Mar 31, 2026': 0,
    }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.zeroMonthCount, 3);
  assert.deepEqual([...(issue.missingMonths ?? [])], [
    'Jan 31, 2026',
    'Feb 28, 2026',
    'Mar 31, 2026',
  ]);
  assert.match(issue.reason ?? '', /3 months/, 'reason text states count');
});

test('does NOT flag row when every month is blank', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({ 'Jan 31, 2026': '', 'Feb 28, 2026': '', 'Mar 31, 2026': '' }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined);
  assert.equal(result.issues.length, 0, 'blank cells must not flag');
});

test('does NOT flag row when every month is positive', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow()]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined);
  assert.equal(result.issues.length, 0, 'all-positive row must not flag');
});

test('mixed blank + zero + positive + negative: only zeros land in missingMonths', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'Jan 31, 2026': 0, // flagged
      'Feb 28, 2026': '', // ignored (blank)
      'Mar 31, 2026': -5, // ignored (negative)
    }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.zeroMonthCount, 1);
  assert.deepEqual([...(issue.missingMonths ?? [])], ['Jan 31, 2026']);
});

test('string "0" and "0.0" cells are treated as zero and flagged', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({ 'Jan 31, 2026': '0', 'Feb 28, 2026': '0.0' }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.zeroMonthCount, 2);
});

test('consolidated per-row: two rows with zero months produce exactly 2 issues', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({ 'Project ID': 'ICR-A', 'Jan 31, 2026': 0, 'Feb 28, 2026': 0 }),
    makeRow({ 'Project ID': 'ICR-B', 'Mar 31, 2026': 0 }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 2, 'one consolidated issue per row');
  const byProject = new Map(result.issues.map((i) => [i.projectNo, i]));
  assert.equal(byProject.get('ICR-A')?.zeroMonthCount, 2);
  assert.equal(byProject.get('ICR-B')?.zeroMonthCount, 1);
});

// ─── Reason text formatting ────────────────────────────────────────────────

test('reason text: singular form for exactly 1 zero month', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 31, 2026': 0 })]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined);
  assert.match(
    result.issues[0]!.reason ?? '',
    /^Internal cost rate is 0 for Jan 31, 2026\.$/,
    'singular reason',
  );
});

test('reason text: plural form for >1 zero months', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({ 'Jan 31, 2026': 0, 'Feb 28, 2026': 0 }),
  ]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined);
  assert.match(
    result.issues[0]!.reason ?? '',
    /^Internal cost rate is 0 for 2 months: Jan 31, 2026, Feb 28, 2026\.$/,
  );
});

// ─── Rule isolation ────────────────────────────────────────────────────────

test('RUL-ICR-COST-ZERO appears only under internal-cost-rate in RULE_CATALOG_BY_FUNCTION', () => {
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<
    [string, typeof INTERNAL_COST_RATE_RULE_CATALOG]
  >;
  for (const [functionId, rules] of entries) {
    if (functionId === 'internal-cost-rate') continue;
    for (const rule of rules) {
      assert.ok(
        rule.ruleCode !== ICR_COST_ZERO_RULE_CODE,
        `found ${ICR_COST_ZERO_RULE_CODE} under "${functionId}" — rule codes must be function-owned`,
      );
    }
  }
});

test('internal-cost-rate catalog is populated with RUL-ICR-COST-ZERO', () => {
  const catalog = getRuleCatalogForFunction('internal-cost-rate');
  assert.ok(catalog.length >= 1, 'catalog must not be empty');
  const codes = new Set(catalog.map((r) => r.ruleCode));
  assert.ok(codes.has(ICR_COST_ZERO_RULE_CODE));
});

test('no ruleCode is duplicated across function catalogs (including ICR)', () => {
  const seen = new Map<string, string>();
  for (const [functionId, rules] of Object.entries(RULE_CATALOG_BY_FUNCTION)) {
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

// ─── Non-regression for sibling catalogs ───────────────────────────────────

test('non-regression: function-rate catalog still holds exactly RUL-FR-RATE-ZERO', () => {
  const catalog = getRuleCatalogForFunction('function-rate');
  const codes = catalog.map((r) => r.ruleCode).sort();
  assert.deepEqual(codes, [FR_RATE_ZERO_RULE_CODE]);
});

test('non-regression: FUNCTION_REGISTRY entry for internal-cost-rate is unchanged', () => {
  const entry = FUNCTION_REGISTRY.find((f) => f.id === 'internal-cost-rate');
  assert.ok(entry, 'internal-cost-rate must be in FUNCTION_REGISTRY');
  assert.equal(entry!.label, 'Internal Cost Rate');
  assert.equal(entry!.displayOrder, 5);
});

// ─── Engine registration ───────────────────────────────────────────────────

test('internal-cost-rate routes to the dedicated engine', () => {
  const engine = getFunctionAuditEngine('internal-cost-rate');
  assert.equal(engine.functionId, 'internal-cost-rate');
});

// ─── End-to-end with issueKey ──────────────────────────────────────────────

test('end-to-end: ICR zero-cost row produces issue with IKY- issueKey', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 31, 2026': 0 })]);
  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.ok(issue.issueKey, 'issueKey must be present when issueScope is provided');
  assert.match(issue.issueKey!, /^IKY-/, 'issueKey must start with IKY-');
  assert.equal(issue.ruleCode, ICR_COST_ZERO_RULE_CODE);
  assert.equal(issue.category, 'Internal Cost Rate');
  assert.ok(issue.projectNo, 'projectNo must be populated');
  assert.equal(issue.severity, 'High');
  assert.equal(issue.thresholdLabel, '= 0');
  assert.match(
    issue.recommendedAction ?? '',
    /enter the internal cost rate/i,
    'recommendedAction mentions the action',
  );
});

// ─── Integration: real Sample_Internal Cost Rate.xlsx ──────────────────────

test('integration: real sample file — engine flags zero months without PM column', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.join(here, 'fixtures', 'sample-internal-cost-rate.xlsx');
  const buffer = readFileSync(fixturePath);
  const file = await parseWorkbook(
    new TestFile([buffer], 'Sample_Internal Cost Rate.xlsx') as File,
  );

  // Parser must classify at least one sheet as valid; otherwise the engine
  // has nothing to audit. If this fails we have a real parser/engine gap to
  // fix before merging — the synthetic fixtures above hid it.
  const validSheets = file.sheets.filter((s) => s.status === 'valid' && s.isSelected);
  assert.ok(validSheets.length >= 1, 'at least one sheet must parse as valid');

  const result = runFunctionAudit('internal-cost-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.ok(result.issues.length >= 1, 'expected at least one zero-cost issue from the real sample');
  const monthLabelRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i;
  for (const issue of result.issues) {
    assert.equal(issue.ruleCode, ICR_COST_ZERO_RULE_CODE);
    assert.equal(issue.category, 'Internal Cost Rate');
    assert.equal(issue.severity, 'High');
    assert.ok(
      Array.isArray(issue.missingMonths) && issue.missingMonths.length >= 1,
      'missingMonths must list the zero months',
    );
    for (const label of issue.missingMonths!) {
      assert.match(label, monthLabelRe, `missingMonth label "${label}" must be a raw month-year header`);
    }
    // Real sample has no PM column — engine should leave projectManager as
    // the 'Unassigned' sentinel, letting the API pre-pass fill it from the
    // mapping source.
    assert.equal(issue.projectManager, 'Unassigned', 'PM column absent → Unassigned sentinel');
  }
});
