import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/workbook.js';
import { RULE_CATALOG_BY_FUNCTION, getRuleCatalogForFunction } from '../src/auditRules.js';
import {
  getFunctionAuditEngine,
  isBadValue,
  isNotAssignedToken,
  isOthersToken,
  MD_COLUMNS,
  MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
  MD_REQUIRED_COLUMNS,
  MD_REVIEW_OTHERS_RULE_CODE,
  missingFieldRuleCode,
  runFunctionAudit,
} from '../src/functions-audit/index.js';
import type { WorkbookFile } from '../src/types.js';

class TestFile extends Blob {
  name: string;
  lastModified: number;

  constructor(parts: BlobPart[], name: string) {
    super(parts);
    this.name = name;
    this.lastModified = Date.now();
  }
}

// The header list mirrors the real master-data export. Each data row is
// crafted so we can point at specific invalid columns deterministically.
const HEADERS = [
  'Country Number',
  'Country Code (Project)',
  'Country Name',
  'BU Name',
  'Customer ID',
  'Customer name',
  'End Customer Name',
  'Country Customer',
  'Project No.',
  'Project',
  'BCS Project Type',
  'Activity type',
  'Type',
  'PSU Relevant',
  'Contractor Type',
  'Project State',
  'Project Manager',
  'Project Country Manager',
  'Project BU Head',
  'Project Management Office',
  'Account Manager',
  'Cost Center (Project)',
  'Project Created',
  'Project Start',
  'Project End',
  'GoLive Status',
  'Scheduled GoLive Date',
  'Project Booking Closure',
  'Project Industry',
  'End Customer Industry',
  'Use Case',
  'Project Product',
  'Reference Project',
  'Advocate Reference (call)',
  'Measures',
];

function rowOverrides(overrides: Partial<Record<string, string>> = {}): string[] {
  // Sensible defaults — a fully-valid master-data row that fills every one
  // of the 27 audited columns. Override individual cells in the per-test
  // call to assert specific rule firings.
  const defaults: Record<string, string> = {
    'Country Number': '100',
    'Country Code (Project)': 'CH',
    'Country Name': 'Switzerland',
    'BU Name': 'ANALYTICS',
    'Customer ID': '324',
    'Customer name': 'Siemens AG',
    'End Customer Name': 'Siemens AG',
    'Country Customer': 'Switzerland',
    'Project No.': '90032101',
    Project: 'Digital Core SAP S4',
    'BCS Project Type': 'External',
    'Activity type': 'Implementation Project',
    Type: 'T&M',
    'PSU Relevant': 'Yes',
    'Contractor Type': 'Sub-Contractor',
    'Project State': 'Opened',
    'Project Manager': 'Wagner, Anna',
    'Project Country Manager': 'Müller, Hans',
    'Project BU Head': 'Matthaei, Patric',
    'Project Management Office': 'Radic, Marko',
    'Account Manager': 'Helmuth, Heinz',
    'Cost Center (Project)': '1009231010',
    'Project Created': 'Dec 17, 2024',
    'Project Start': 'Jan 1, 2025',
    'Project End': 'Dec 31, 2026',
    'GoLive Status': 'Planned',
    'Scheduled GoLive Date': 'Jun 30, 2026',
    'Project Booking Closure': 'Mar 31, 2026',
    'Project Industry': 'Insurance',
    'End Customer Industry': 'Insurance',
    'Use Case': 'Reporting',
    'Project Product': 'SAP PaPM OnPrem',
    'Reference Project': 'Yes and confirmed',
    'Advocate Reference (call)': 'Yes',
    Measures: 'Reference call',
  };
  const merged = { ...defaults, ...overrides };
  return HEADERS.map((h) => merged[h] ?? '');
}

// The workbook parser only marks a sheet as valid when it has at least 5
// rows. We always pad with clean filler rows so the engine actually runs,
// and the test asserts on issues produced for the first data row.
async function buildWorkbook(dataRows: string[][], fileName = 'master-data.xlsx'): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  const filler = Array.from({ length: Math.max(0, 5 - dataRows.length) }, (_, i) =>
    rowOverrides({ 'Project No.': `9999${i}`, 'Customer name': `Filler ${i}` }),
  );
  workbook.addWorksheet('Master Data').addRows([HEADERS, ...dataRows, ...filler]);
  const buffer = await workbook.xlsx.writeBuffer();
  return parseWorkbook(new TestFile([buffer], fileName) as File);
}

test('isBadValue detects blanks, nulls, and placeholder tokens', () => {
  for (const bad of ['', '   ', null, undefined, 'null', 'N/A', 'NA', '-', 'not assigned', 'undefined', 'none', 'TBD', 'not available yet']) {
    assert.equal(isBadValue(bad), true, `expected "${String(bad)}" to be flagged`);
  }
  for (const good of ['Siemens AG', '90032101', 'Wagner, Anna', 'Switzerland']) {
    assert.equal(isBadValue(good), false, `expected "${good}" to be valid`);
  }
});

test('isOthersToken matches only Other/Others (case-insensitive)', () => {
  assert.equal(isOthersToken('Other'), true);
  assert.equal(isOthersToken('OTHERS'), true);
  assert.equal(isOthersToken('others'), true);
  assert.equal(isOthersToken('Other products'), false);
  assert.equal(isOthersToken('SAP PaPM'), false);
});

test('isNotAssignedToken matches only "Not assigned" (case-insensitive)', () => {
  assert.equal(isNotAssignedToken('Not assigned'), true);
  assert.equal(isNotAssignedToken('NOT ASSIGNED'), true);
  assert.equal(isNotAssignedToken('not assigned'), true);
  assert.equal(isNotAssignedToken('not-assigned'), false);
  assert.equal(isNotAssignedToken('not assigned yet'), false);
  assert.equal(isNotAssignedToken('SAP PaPM'), false);
});

test('master-data engine flags every required column when blank or placeholder', async () => {
  const blanks: Partial<Record<string, string>> = {};
  for (const column of MD_REQUIRED_COLUMNS) {
    // First alias is the canonical export header used in HEADERS above.
    blanks[column.aliases[0]!] = '';
  }
  // Cycle a placeholder mix so the test exercises both "blank" and "string
  // placeholder" branches of isBadValue.
  const placeholderRotation = ['', 'null', 'N/A', 'not assigned', '   ', 'undefined', 'none', 'TBD', 'not available yet'];
  MD_REQUIRED_COLUMNS.forEach((column, index) => {
    if (column.id === MD_COLUMNS.projectProduct.id) return; // covered separately below
    blanks[column.aliases[0]!] = placeholderRotation[index % placeholderRotation.length]!;
  });
  // Force Project Product to blank so it fires the MISSING rule (and only
  // that one — see the dedicated test below for the three-rule logic).
  blanks[MD_COLUMNS.projectProduct.aliases[0]!] = '';

  const file = await buildWorkbook([rowOverrides(blanks)]);
  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.ok(result.scannedRows >= 1);
  assert.equal(result.flaggedRows, 1);
  const codes = new Set(result.issues.map((issue) => issue.ruleCode));
  for (const column of MD_REQUIRED_COLUMNS) {
    assert.ok(codes.has(missingFieldRuleCode(column.id)), `missing rule for column ${column.id}`);
  }
  // 27 missing rules, no NOT-ASSIGNED, no REVIEW-OTHERS (Project Product
  // is blank, not the "Not assigned" / "Other" token).
  assert.equal(result.issues.length, MD_REQUIRED_COLUMNS.length);
  assert.ok(result.issues.every((issue) => issue.category === 'Data Quality'));
  assert.ok(result.issues.every((issue) => issue.issueKey && issue.issueKey.startsWith('IKY-')));
});

test('master-data engine flags Project Product = "Others" as Needs Review (not missing)', async () => {
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'Others' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, MD_REVIEW_OTHERS_RULE_CODE);
  assert.equal(issue.category, 'Needs Review');
  assert.equal(issue.severity, 'Medium');
  assert.match(issue.reason ?? '', /Other/i);
});

test('master-data engine flags Project Product = "Other, SAP Emarsys" as Needs Review', async () => {
  // Real-world value from the sample workbook — the auditor needs to look
  // up which actual product was deployed and replace the "Other" token.
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'Other, SAP Emarsys' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, MD_REVIEW_OTHERS_RULE_CODE);
  assert.equal(issue.category, 'Needs Review');
  assert.match(issue.reason ?? '', /Other/i);
});

test('master-data engine flags Project Product = "Not assigned" as NOT-ASSIGNED (not MISSING)', async () => {
  // Behaviour change vs. the pre-extension engine: pure "Not assigned"
  // used to be caught by isBadValue and reported as the generic MISSING
  // rule. Now it gets its own rule so the auditor can route it
  // separately in notifications.
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'Not assigned' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE);
  assert.equal(issue.category, 'Needs Review');
  assert.equal(issue.severity, 'Medium');
});

test('master-data engine flags Project Product = "Not assigned, Application Development Services" as NOT-ASSIGNED', async () => {
  // Real-world value from the sample workbook — partial assignment with
  // one product known and another deferred. NOT-ASSIGNED still fires.
  const file = await buildWorkbook([
    rowOverrides({ 'Project Product': 'Not assigned, Application Development Services for SAP BTP (Business Technology Platform)' }),
  ]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE);
});

test('master-data engine fires both NOT-ASSIGNED and REVIEW-OTHERS when both tokens present', async () => {
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'Not assigned, Other, SAP X' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  const codes = new Set(result.issues.map((issue) => issue.ruleCode));
  assert.ok(codes.has(MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE));
  assert.ok(codes.has(MD_REVIEW_OTHERS_RULE_CODE));
  assert.equal(result.issues.length, 2);
  // The row counts as flagged once even though two rules fired.
  assert.equal(result.flaggedRows, 1);
});

test('master-data engine does not false-positive REVIEW-OTHERS on substrings like "Other industries"', async () => {
  // "Other industries" is a single comma-token, NOT equal to "other" — so
  // the comma-split + token-equality check correctly skips it. (The
  // workbook header is Project Industry, not Project Product, but using
  // Project Product here is the cleanest way to test the detector logic.)
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'Other industries' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  // No findings — "Other industries" is a real product name, not a review
  // marker.
  assert.equal(result.issues.length, 0);
});

test('master-data engine does not double-count a product that is both blank and Other-eligible', async () => {
  // Blank takes precedence over the comma-split check — the row gets
  // exactly one MISSING finding for Project Product, no review rules.
  const file = await buildWorkbook([rowOverrides({ 'Project Product': '' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, missingFieldRuleCode(MD_COLUMNS.projectProduct.id));
});

test('master-data engine falls back to MISSING for Project Product placeholders that are not "Not assigned" / "Other"', async () => {
  // "TBD" is a generic placeholder caught by isBadValue but not by either
  // of the two review tokens — engine emits MISSING (not NOT-ASSIGNED).
  const file = await buildWorkbook([rowOverrides({ 'Project Product': 'TBD' })]);

  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, missingFieldRuleCode(MD_COLUMNS.projectProduct.id));
});

test('master-data engine passes a fully-clean row with no findings', async () => {
  const file = await buildWorkbook([rowOverrides()]);
  const result = runFunctionAudit('master-data', file, undefined, { issueScope: 'PRC-TEST' });
  assert.equal(result.flaggedRows, 0);
  assert.equal(result.issues.length, 0);
});

test('dispatcher routes to master-data engine for master-data files', () => {
  const engine = getFunctionAuditEngine('master-data');
  assert.equal(engine.functionId, 'master-data');
});

test('dispatcher falls back to legacy engine for non-master-data functions', async () => {
  const file = await buildWorkbook([rowOverrides({ 'Customer name': '' })]);
  // Over-planning engine looks at effort, not Customer name — the row is
  // clean from its perspective, so there should be no Data Quality findings.
  const result = runFunctionAudit('over-planning', file, undefined, { issueScope: 'PRC-TEST' });
  assert.ok(result.issues.every((issue) => issue.category !== 'Data Quality'));
});

test('rule catalogs are strictly separated per function', () => {
  // No ruleCode may appear in more than one function's catalog. This is the
  // structural guarantee: Master Data rules cannot leak into Over Planning,
  // etc. If this test ever fails, a rule was registered under two functions.
  const seen = new Map<string, string>();
  for (const [functionId, rules] of Object.entries(RULE_CATALOG_BY_FUNCTION)) {
    for (const rule of rules) {
      const prior = seen.get(rule.ruleCode);
      assert.equal(prior, undefined, `ruleCode ${rule.ruleCode} claimed by both ${prior} and ${functionId}`);
      seen.set(rule.ruleCode, functionId);
    }
  }
});

test('master-data catalog contains a missing rule for every required column plus the two Project Product review rules', () => {
  const masterData = getRuleCatalogForFunction('master-data');
  // 27 missing rules (one per required column) + NOT-ASSIGNED + REVIEW-OTHERS = 29
  assert.equal(masterData.length, MD_REQUIRED_COLUMNS.length + 2);
  const codes = new Set(masterData.map((rule) => rule.ruleCode));
  for (const column of MD_REQUIRED_COLUMNS) {
    assert.ok(codes.has(missingFieldRuleCode(column.id)), `master-data must own ${column.id}`);
  }
  assert.ok(codes.has(MD_REVIEW_OTHERS_RULE_CODE));
  assert.ok(codes.has(MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE));
});

test('unbuilt functions have empty catalogs, not inherited rules', () => {
  // missing-plan and function-rate now have dedicated engines and catalogs
  // (RUL-MP-EFFORT-ZERO, RUL-FR-RATE-ZERO respectively). Only internal-cost-rate
  // remains an unbuilt placeholder.
  for (const fn of ['internal-cost-rate'] as const) {
    assert.equal(getRuleCatalogForFunction(fn).length, 0, `${fn} should not inherit any rules`);
  }
});