import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook/workbook.js';
import { RULE_CATALOG_BY_FUNCTION, getRuleCatalogForFunction } from '../src/audit/auditRules.js';
import {
  DEFAULT_PD_THRESHOLD,
  detectPdColumns,
  getFunctionAuditEngine,
  isPdColumn,
  OP_MONTH_PD_HIGH_RULE_CODE,
  OVER_PLANNING_ENGINE_RULE_CATALOG,
  runFunctionAudit,
} from '../src/functions-audit/index.js';
import { normalizeAuditPolicy } from '../src/audit/auditPolicy.js';
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

// Headers for a valid over-planning workbook. The workbook parser needs at
// least projectNo + projectManager + projectState + one more to score ≥5.
// We add PD columns for the engine to detect.
const BASE_HEADERS = [
  'Project No.',
  'Project',
  'Project State',
  'Project Manager',
  'Project Manager Email',
  'Jan 2025 PD',
  'Feb 2025 PD',
  'Mar 2025 PD',
];

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    'Project No.': '90032101',
    Project: 'Digital Core SAP S4',
    'Project State': 'Opened',
    'Project Manager': 'Wagner, Anna',
    'Project Manager Email': 'anna.wagner@example.com',
    'Jan 2025 PD': 0,
    'Feb 2025 PD': 0,
    'Mar 2025 PD': 0,
  };
  const merged = { ...defaults, ...overrides };
  return BASE_HEADERS.map((h) => merged[h] ?? '');
}

async function buildWorkbook(
  headers: string[],
  dataRows: unknown[][],
  fileName = 'overplanning.xlsx',
): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) => {
    const base = headers.map(() => '');
    const projectNoIndex = headers.indexOf('Project No.');
    if (projectNoIndex >= 0) base[projectNoIndex] = `FILL-${i}`;
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

// ─── isPdColumn unit tests ─────────────────────────────────────────────────

test('isPdColumn: positive cases', () => {
  const positives = ['Jan PD', 'Feb 2024 PD', 'PD Jan', 'EFFORT PD March', '2024-01 PD', '03 PD'];
  for (const header of positives) {
    assert.ok(isPdColumn(header), `expected "${header}" to be a PD column`);
  }
});

test('isPdColumn: negative cases', () => {
  const negatives = ['Effort (H)', 'Project Manager', 'PD', 'Product Development', 'SPD'];
  for (const header of negatives) {
    assert.ok(!isPdColumn(header), `expected "${header}" NOT to be a PD column`);
  }
});

// ─── detectPdColumns ────────────────────────────────────────────────────────

test('detectPdColumns: returns only PD columns from a mixed header row', () => {
  // Single header row — no data row to accidentally merge with.
  const rawRows = [
    ['Project No.', 'Project', 'Project Manager', 'Jan 2025 PD', 'Feb 2025 PD', 'Effort (H)'],
  ];
  const cols = detectPdColumns(rawRows);
  const labels = cols.map((c) => c.label);
  assert.ok(labels.includes('Jan 2025 PD'), 'expected Jan 2025 PD');
  assert.ok(labels.includes('Feb 2025 PD'), 'expected Feb 2025 PD');
  assert.ok(!labels.includes('Project No.'), 'expected Project No. excluded');
  assert.ok(!labels.includes('Effort (H)'), 'expected Effort (H) excluded');
  assert.equal(cols[0]?.colIndex, 3, 'Jan 2025 PD should be at colIndex 3');
  assert.equal(cols[1]?.colIndex, 4, 'Feb 2025 PD should be at colIndex 4');
});

test('detectPdColumns: two-row merge detects "Effort (PD)" + "Mar 31 2026"', () => {
  const rawRows = [
    ['Project No.', 'Project', 'Effort (PD)'],
    ['', '', 'Mar 31 2026'],
  ];
  const cols = detectPdColumns(rawRows);
  assert.ok(cols.length >= 1, `expected at least one PD column detected via two-row merge, got ${cols.length}`);
  assert.equal(cols[0]?.colIndex, 2, 'merged PD column should be at colIndex 2');
  assert.match(cols[0]?.label ?? '', /Effort \(PD\).*Mar/i, 'merged label should contain both parts');
});

// ─── Threshold comparison (strictly greater, not ≥) ──────────────────────

test('flags row when worst PD 31 > threshold 30', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': 31 })]);
  const result = runFunctionAudit('over-planning', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.flaggedRows, 1);
  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, OP_MONTH_PD_HIGH_RULE_CODE);
  assert.equal(issue.effort, 31);
  assert.equal(issue.category, 'Overplanning');
  assert.equal(issue.severity, 'High');
});

test('does NOT flag row when worst PD = threshold (30 == 30)', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': 30 })]);
  const result = runFunctionAudit('over-planning', file, undefined);
  assert.equal(result.issues.length, 0);
  assert.equal(result.flaggedRows, 0);
});

test('does NOT flag row when worst PD 15 < threshold 30', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': 15 })]);
  const result = runFunctionAudit('over-planning', file, undefined);
  assert.equal(result.issues.length, 0);
});

// ─── Blank PD cell ──────────────────────────────────────────────────────────

test('does NOT flag row when all PD cells are blank', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': '', 'Feb 2025 PD': '', 'Mar 2025 PD': '' })]);
  const result = runFunctionAudit('over-planning', file, undefined);
  assert.equal(result.issues.length, 0, 'blank PD cells must not produce a finding');
});

// ─── String coercion ────────────────────────────────────────────────────────

test('coerces string PD "35" and flags it', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': '35' })]);
  const result = runFunctionAudit('over-planning', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.effort, 35);
});

// ─── Custom threshold ────────────────────────────────────────────────────────

test('custom pdThreshold=10: PD=15 is flagged', async () => {
  const policy = normalizeAuditPolicy({ pdThreshold: 10 });
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': 15 })]);
  const result = runFunctionAudit('over-planning', file, policy, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.effort, 15);
  assert.match(result.issues[0]!.reason ?? '', /threshold of 10/);
});

// ─── Multiple PD columns: worst wins ─────────────────────────────────────────

test('worst column name appears in the reason string', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [
    makeRow({ 'Jan 2025 PD': 20, 'Feb 2025 PD': 45, 'Mar 2025 PD': 10 }),
  ]);
  const result = runFunctionAudit('over-planning', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.effort, 45);
  assert.match(result.issues[0]!.reason ?? '', /Feb 2025 PD/);
});

// ─── Rule isolation ─────────────────────────────────────────────────────────

test('RUL-OP-MONTH-PD-HIGH appears only under over-planning in RULE_CATALOG_BY_FUNCTION', () => {
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[string, typeof OVER_PLANNING_ENGINE_RULE_CATALOG]>;
  for (const [functionId, rules] of entries) {
    if (functionId === 'over-planning') continue;
    for (const rule of rules) {
      assert.ok(
        rule.ruleCode !== OP_MONTH_PD_HIGH_RULE_CODE,
        `found ${OP_MONTH_PD_HIGH_RULE_CODE} under "${functionId}" — rule codes must be function-owned`,
      );
    }
  }
});

test('no ruleCode appears in more than one function catalog', () => {
  const seen = new Map<string, string>();
  const entries = Object.entries(RULE_CATALOG_BY_FUNCTION) as Array<[string, typeof OVER_PLANNING_ENGINE_RULE_CATALOG]>;
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

// ─── End-to-end with issueKey ─────────────────────────────────────────────────

test('end-to-end: over-planning PD=31 produces issue with IKY- issueKey', async () => {
  const file = await buildWorkbook(BASE_HEADERS, [makeRow({ 'Jan 2025 PD': 31 })]);
  const result = runFunctionAudit('over-planning', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.ok(issue.issueKey, 'issueKey must be present when issueScope is provided');
  assert.match(issue.issueKey!, /^IKY-/, 'issueKey must start with IKY-');
  assert.equal(issue.ruleCode, OP_MONTH_PD_HIGH_RULE_CODE);
  assert.equal(issue.effort, 31);
  assert.equal(issue.category, 'Overplanning');
  assert.ok(issue.projectNo, 'projectNo must be populated');
  assert.ok(issue.projectManager, 'projectManager must be populated');
  assert.equal(issue.severity, 'High');
  assert.ok(issue.thresholdLabel?.startsWith('>'), 'thresholdLabel must start with >');
  assert.ok(issue.recommendedAction, 'recommendedAction must be populated');
});

// ─── Engine registration ─────────────────────────────────────────────────────

test('over-planning routes to the dedicated engine', () => {
  const engine = getFunctionAuditEngine('over-planning');
  assert.equal(engine.functionId, 'over-planning');
});

test('DEFAULT_PD_THRESHOLD is 30', () => {
  assert.equal(DEFAULT_PD_THRESHOLD, 30);
});

test('over-planning catalog contains RUL-OP-MONTH-PD-HIGH and the 7 legacy rules', () => {
  const catalog = getRuleCatalogForFunction('over-planning');
  assert.ok(catalog.length >= 8, `expected at least 8 rules, got ${catalog.length}`);
  const codes = new Set(catalog.map((r) => r.ruleCode));
  assert.ok(codes.has(OP_MONTH_PD_HIGH_RULE_CODE), 'RUL-OP-MONTH-PD-HIGH must be in catalog');
  for (const legacyCode of [
    'RUL-EFFORT-OVERPLAN-HIGH',
    'RUL-EFFORT-OVERPLAN-LOW',
    'RUL-EFFORT-MISSING',
    'RUL-EFFORT-ZERO',
    'RUL-MGR-MISSING',
    'RUL-STATE-ONHOLD-EFFORT',
    'RUL-STATE-INPLAN-EFFORT',
  ]) {
    assert.ok(codes.has(legacyCode), `legacy rule ${legacyCode} must be retained for FK integrity`);
  }
});
