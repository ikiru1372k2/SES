import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook/workbook.js';
import { RULE_CATALOG_BY_FUNCTION, getRuleCatalogForFunction } from '../src/audit/auditRules.js';
import {
  FR_RATE_ZERO_RULE_CODE,
  FUNCTION_RATE_RULE_CATALOG,
  classifyRateCell,
  detectRateColumns,
  getFunctionAuditEngine,
  isRateColumn,
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

// Headers to pass the workbook parser's identity-score gate (needs projectNo,
// projectName, manager, state plus an additional signal) then carry monthly
// External Rate columns the engine will actually evaluate.
const BASE_HEADERS = [
  'Project No.',
  'Project',
  'Project State',
  'Project Manager',
  'Project Manager Email',
  'External Rate Apr 2026',
  'External Rate May 2026',
  'External Rate Jun 2026',
];

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    'Project No.': 'FR-001',
    Project: 'Function Rate Test Project',
    'Project State': 'Opened',
    'Project Manager': 'Wagner, Anna',
    'Project Manager Email': 'anna.wagner@example.com',
    'External Rate Apr 2026': 125,
    'External Rate May 2026': 125,
    'External Rate Jun 2026': 125,
  };
  const merged = { ...defaults, ...overrides };
  return BASE_HEADERS.map((h) => merged[h] ?? '');
}

async function buildWorkbook(
  headers: string[],
  dataRows: unknown[][],
  fileName = 'function-rate.xlsx',
): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  // Pad to ≥5 data rows so the parser classifies the sheet as valid.
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) => {
    const base = headers.map(() => '' as unknown);
    const projectNoIndex = headers.indexOf('Project No.');
    if (projectNoIndex >= 0) base[projectNoIndex] = `FILL-${i}`;
    const stateIndex = headers.indexOf('Project State');
    if (stateIndex >= 0) base[stateIndex] = 'Opened';
    const mgrIndex = headers.indexOf('Project Manager');
    if (mgrIndex >= 0) base[mgrIndex] = 'Filler Manager';
    // Filler rows carry nonzero rates so only the explicit test rows can flag.
    for (const h of [
      'External Rate Apr 2026',
      'External Rate May 2026',
      'External Rate Jun 2026',
    ]) {
      const idx = headers.indexOf(h);
      if (idx >= 0) base[idx] = 100;
    }
    return base;
  });
  workbook.addWorksheet('Rates').addRows([headers, ...dataRows, ...filler]);
  const buffer = await workbook.xlsx.writeBuffer();
  return parseWorkbook(new TestFile([buffer], fileName) as File);
}

// ─── isRateColumn unit tests ───────────────────────────────────────────────

test('isRateColumn: positive cases', () => {
  const positives = [
    'External Rate Apr 30 2026',
    'Ext Rate Apr',
    'Rate Jan 2026',
    'Apr 2026 Rate',
    'External Rate 03 2026',
    'Rate 2026',
  ];
  for (const header of positives) {
    assert.ok(isRateColumn(header), `expected "${header}" to be a rate column`);
  }
});

test('isRateColumn: negative cases', () => {
  const negatives = ['Employee Name', 'Project Name', 'Billability', 'INVMETH', 'Rate', 'Estimate'];
  for (const header of negatives) {
    assert.ok(!isRateColumn(header), `expected "${header}" NOT to be a rate column`);
  }
});

// ─── classifyRateCell ──────────────────────────────────────────────────────

test('classifyRateCell: only exactly-zero is "zero"; everything else is "ignore"', () => {
  // rawRows single-row grid lets us address cells directly.
  const row = [0, '0', '0.0', '  0  ', '', null, '12.5', 125, -5, 'abc', undefined];
  const grid: unknown[][] = [row];
  assert.equal(classifyRateCell(grid, 0, 0), 'zero', 'numeric 0 -> zero');
  assert.equal(classifyRateCell(grid, 0, 1), 'zero', 'string "0" -> zero');
  assert.equal(classifyRateCell(grid, 0, 2), 'zero', 'string "0.0" -> zero');
  assert.equal(classifyRateCell(grid, 0, 3), 'zero', 'whitespace-padded "0" -> zero');
  assert.equal(classifyRateCell(grid, 0, 4), 'ignore', 'empty string -> ignore');
  assert.equal(classifyRateCell(grid, 0, 5), 'ignore', 'null -> ignore');
  assert.equal(classifyRateCell(grid, 0, 6), 'ignore', 'positive string "12.5" -> ignore');
  assert.equal(classifyRateCell(grid, 0, 7), 'ignore', 'positive number 125 -> ignore');
  assert.equal(classifyRateCell(grid, 0, 8), 'ignore', 'negative number -5 -> ignore');
  assert.equal(classifyRateCell(grid, 0, 9), 'ignore', 'non-numeric text "abc" -> ignore');
  assert.equal(classifyRateCell(grid, 0, 10), 'ignore', 'undefined -> ignore');
});

// ─── detectRateColumns ─────────────────────────────────────────────────────

test('detectRateColumns: single-row scan returns only rate columns', () => {
  const rawRows = [
    [
      'Project No.',
      'Project',
      'Project Manager',
      'External Rate Apr 2026',
      'External Rate May 2026',
      'Billability',
    ],
  ];
  const cols = detectRateColumns(rawRows);
  const labels = cols.map((c) => c.label);
  assert.ok(labels.includes('External Rate Apr 2026'), 'expected Apr');
  assert.ok(labels.includes('External Rate May 2026'), 'expected May');
  assert.ok(!labels.includes('Project No.'), 'expected Project No. excluded');
  assert.ok(!labels.includes('Billability'), 'expected Billability excluded');
  assert.equal(cols[0]?.colIndex, 3, 'Apr rate should be at colIndex 3');
  assert.equal(cols[1]?.colIndex, 4, 'May rate should be at colIndex 4');
});

test('detectRateColumns: two-row merge handles "External Rate" + month row', () => {
  const rawRows = [
    ['Project ID', 'Project Name', 'External Rate', 'External Rate', 'External Rate'],
    ['', '', 'Apr 30 2026', 'May 31 2026', 'Jun 30 2026'],
  ];
  const cols = detectRateColumns(rawRows);
  assert.ok(cols.length >= 3, `expected at least 3 merged columns, got ${cols.length}`);
  assert.equal(cols[0]?.colIndex, 2, 'first merged rate column at colIndex 2');
  assert.match(cols[0]?.label ?? '', /External Rate.*Apr/i, 'merged label contains both halves');
});

// ─── Flagging behavior ────────────────────────────────────────────────────

test('flags row when exactly 1 month is 0; missingMonths=[that month]', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'External Rate Apr 2026': 0 })]);
  const result = runFunctionAudit('function-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1, 'exactly one issue');
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, FR_RATE_ZERO_RULE_CODE);
  assert.equal(issue.zeroMonthCount, 1);
  assert.deepEqual([...(issue.missingMonths ?? [])], ['External Rate Apr 2026']);
  assert.equal(issue.effort, 1, 'effort = zeroMonthCount');
  assert.equal(issue.category, 'Function Rate');
  assert.equal(issue.severity, 'High');
  assert.match(issue.reason ?? '', /External Rate Apr 2026/);
});

test('flags row when multiple months are 0; missingMonths lists them all', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'External Rate Apr 2026': 0,
      'External Rate May 2026': 0,
      'External Rate Jun 2026': 0,
    }),
  ]);
  const result = runFunctionAudit('function-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.zeroMonthCount, 3);
  assert.deepEqual([...(issue.missingMonths ?? [])], [
    'External Rate Apr 2026',
    'External Rate May 2026',
    'External Rate Jun 2026',
  ]);
  assert.match(issue.reason ?? '', /3 months/, 'reason text states count');
});

test('does NOT flag row when every month is blank', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'External Rate Apr 2026': '',
      'External Rate May 2026': '',
      'External Rate Jun 2026': '',
    }),
  ]);
  const result = runFunctionAudit('function-rate', file, undefined);
  // Only the explicit blank row, plus fillers (which have nonzero rates).
  assert.equal(result.issues.length, 0, 'blank cells must not flag');
});

test('does NOT flag row when every month is positive', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow()]);
  const result = runFunctionAudit('function-rate', file, undefined);
  assert.equal(result.issues.length, 0, 'all-positive row must not flag');
});

test('mixed blank + zero + positive + negative: only zeros land in missingMonths', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'External Rate Apr 2026': 0, // flagged
      'External Rate May 2026': '', // ignored (blank)
      'External Rate Jun 2026': -5, // ignored (negative)
    }),
  ]);
  const result = runFunctionAudit('function-rate', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.zeroMonthCount, 1);
  assert.deepEqual([...(issue.missingMonths ?? [])], ['External Rate Apr 2026']);
});

test('string "0" and "0.0" cells are treated as zero and flagged', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({
      'External Rate Apr 2026': '0',
      'External Rate May 2026': '0.0',
    }),
  ]);
  const result = runFunctionAudit('function-rate', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.zeroMonthCount, 2);
});

// ─── Reason text formatting ────────────────────────────────────────────────

test('reason text: singular form for exactly 1 zero month', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'External Rate Apr 2026': 0 })]);
  const result = runFunctionAudit('function-rate', file, undefined);
  assert.match(
    result.issues[0]!.reason ?? '',
    /^External rate is 0 for External Rate Apr 2026\.$/,
    'singular reason',
  );
});

// ─── Rule isolation ────────────────────────────────────────────────────────

test('RUL-FR-RATE-ZERO appears only under function-rate in RULE_CATALOG_BY_FUNCTION', () => {
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<
    [string, typeof FUNCTION_RATE_RULE_CATALOG]
  >;
  for (const [functionId, rules] of entries) {
    if (functionId === 'function-rate') continue;
    for (const rule of rules) {
      assert.ok(
        rule.ruleCode !== FR_RATE_ZERO_RULE_CODE,
        `found ${FR_RATE_ZERO_RULE_CODE} under "${functionId}" — rule codes must be function-owned`,
      );
    }
  }
});

test('function-rate catalog is populated with RUL-FR-RATE-ZERO', () => {
  const catalog = getRuleCatalogForFunction('function-rate');
  assert.ok(catalog.length >= 1, 'function-rate catalog must not be empty');
  const codes = new Set(catalog.map((r) => r.ruleCode));
  assert.ok(codes.has(FR_RATE_ZERO_RULE_CODE), 'RUL-FR-RATE-ZERO must be in catalog');
});

test('no ruleCode is duplicated across function catalogs', () => {
  const seen = new Map<string, string>();
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<
    [string, typeof FUNCTION_RATE_RULE_CATALOG]
  >;
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

// ─── End-to-end with issueKey ──────────────────────────────────────────────

test('end-to-end: function-rate zero-rate row produces issue with IKY- issueKey', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'External Rate Apr 2026': 0 })]);
  const result = runFunctionAudit('function-rate', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.ok(issue.issueKey, 'issueKey must be present when issueScope is provided');
  assert.match(issue.issueKey!, /^IKY-/, 'issueKey must start with IKY-');
  assert.equal(issue.ruleCode, FR_RATE_ZERO_RULE_CODE);
  assert.equal(issue.category, 'Function Rate');
  assert.ok(issue.projectNo, 'projectNo must be populated');
  assert.ok(issue.projectManager, 'projectManager must be populated');
  assert.equal(issue.severity, 'High');
  assert.equal(issue.thresholdLabel, '= 0');
  assert.ok(issue.recommendedAction, 'recommendedAction must be populated');
});

// ─── Engine registration ───────────────────────────────────────────────────

test('function-rate routes to the dedicated engine', () => {
  const engine = getFunctionAuditEngine('function-rate');
  assert.equal(engine.functionId, 'function-rate');
});
