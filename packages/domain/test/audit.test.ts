import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createDefaultAuditPolicy, isPolicyChanged, policySummary } from '../src/auditPolicy.js';
import { compareResults, runAudit } from '../src/auditEngine.js';
import { MAX_WORKBOOK_FILE_SIZE_BYTES, parseWorkbook } from '../src/workbook.js';
import type { AuditIssue, AuditResult, WorkbookFile } from '../src/types.js';

class TestFile extends Blob {
  name: string;
  lastModified: number;

  constructor(parts: BlobPart[], name: string) {
    super(parts);
    this.name = name;
    this.lastModified = Date.now();
  }
}

async function loadSample(): Promise<WorkbookFile> {
  const rows = [
    ['QGC effort planning review'],
    ['Country', 'Business Unit (Project)', 'Customer Name', 'Project No.', 'Project', 'Project State', 'Project Manager', 'Email', 'Effort (H)'],
    ['100', 'Digital Transformation', 'Siemens AG', '90032101', 'Digital Core SAP S4', 'Authorised', 'Muller, Hans', 'h.muller@company.com', 920],
    ['100', 'Digital Transformation', 'Siemens AG', '90032102', 'Portal Integration', 'In Planning', 'Wagner, Anna', 'a.wagner@company.com', 0],
    ['100', 'Infrastructure', 'Bosch GmbH', '90032103', 'Network Upgrade', 'Authorised', 'Wilson, Mark', 'm.wilson@company.com', 150],
    ['100', 'Infrastructure', 'Bosch GmbH', '90032104', 'Data Center Migration', 'On Hold', 'Fischer, Tom', 't.fischer@company.com', 250],
    ['101', 'Cloud Services', 'Total Energies', '90032201', 'Cloud Migration', 'Authorised', 'Chen, Li', 'l.chen@company.com', 820],
  ];
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Effort Data').addRows(rows);
  workbook.addWorksheet('Summary').addRows(rows);
  const buffer = await workbook.xlsx.writeBuffer();

  return parseWorkbook(new TestFile([buffer], 'generated_effort_sample.xlsx') as File);
}

test('browser parser detects valid effort sheet and duplicate summary sheet', async () => {
  const file = await loadSample();
  const effort = file.sheets.find((sheet) => sheet.name === 'Effort Data');
  const summary = file.sheets.find((sheet) => sheet.name === 'Summary');

  assert.equal(effort?.status, 'valid');
  assert.equal(effort?.isSelected, true);
  assert.equal(effort?.headerRowIndex, 1);
  assert.equal(summary?.status, 'duplicate');
});

test('parser rejects legacy xls files and oversized uploads before parsing', async () => {
  await assert.rejects(
    () => parseWorkbook(new TestFile(['not-a-workbook'], 'legacy.xls') as File),
    /Legacy \.xls files are not supported/,
  );

  await assert.rejects(
    () => parseWorkbook(new TestFile([new Uint8Array(MAX_WORKBOOK_FILE_SIZE_BYTES + 1)], 'huge.xlsx') as File),
    /too large/,
  );
});

test('duplicate canonical headers do not overwrite the first mapped project number', async () => {
  const file: WorkbookFile = {
    id: 'file-1',
    name: 'headers.xlsx',
    uploadedAt: new Date().toISOString(),
    lastAuditedAt: null,
    isAudited: false,
    sheets: [{
      name: 'Effort Data',
      status: 'valid',
      rowCount: 1,
      isSelected: true,
      headerRowIndex: 0,
      originalHeaders: ['Project No.', 'Project Number', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
      normalizedHeaders: ['projectNo', 'projectNo', 'projectName', 'projectState', 'projectManager', 'effort'],
    }],
    rawData: {
      'Effort Data': [
        ['Project No.', 'Project Number', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
        ['FIRST', 'SECOND', 'Collision Test', 'Authorised', 'Manager, Test', 950],
      ],
    },
  };

  const result = runAudit(file, createDefaultAuditPolicy());

  assert.equal(result.issues[0]?.projectNo, 'FIRST');
});

test('QGC audit focuses on overplanning and missing planning', async () => {
  const file = await loadSample();
  file.rawData['Effort Data']!.push(['100', 'Digital Transformation', 'Synthetic Customer', '99999999', 'Synthetic Missing Effort', 'Authorised', 'Manager, Test', 'test.manager@company.com', '']);
  const defaultPolicy = createDefaultAuditPolicy();
  const result = runAudit(file, { ...defaultPolicy, highEffortThreshold: 800 });
  const issueKeys = result.issues.map((issue) => `${issue.ruleName}|${issue.category}`);

  assert.equal(result.scannedRows, 6);
  assert.ok(issueKeys.includes('Overplanned effort|Overplanning'), issueKeys.join(', '));
  assert.ok(issueKeys.includes('Missing effort|Missing Planning'), issueKeys.join(', '));
  assert.ok(issueKeys.includes('Zero effort|Missing Planning'), issueKeys.join(', '));
  assert.equal(policySummary(defaultPolicy), 'QGC Policy: Overplanning >900h, missing effort, zero effort enabled');
});

test('comparison keeps cross-process deltas available for saved versions', async () => {
  const file = await loadSample();
  const from = runAudit(file, createDefaultAuditPolicy());
  const changed = {
    ...from,
    issues: from.issues.map((issue, index) => index === 0 ? { ...issue, effort: issue.effort + 10, projectState: 'On Hold' } : issue),
  };

  const comparison = compareResults(from, changed);

  assert.ok(comparison.unchangedIssues.length > 0);
  assert.ok(comparison.effortChanges.length > 0);
  assert.ok(comparison.stateChanges.length > 0);
});

test('comparison distinguishes duplicate project numbers on different rows', () => {
  const issue = (rowIndex: number): AuditIssue => ({
    id: `issue-${rowIndex}`,
    projectNo: 'DUP-1',
    projectName: `Duplicate ${rowIndex}`,
    sheetName: 'Effort Data',
    severity: 'High',
    projectManager: 'Manager, Test',
    projectState: 'Authorised',
    effort: 950,
    auditStatus: 'HIGH EFFORT',
    notes: 'High effort',
    rowIndex,
  });
  const from: AuditResult = { fileId: 'file', runAt: '2026-04-16T00:00:00.000Z', scannedRows: 2, flaggedRows: 2, issues: [issue(1), issue(2)], sheets: [] };
  const to: AuditResult = { ...from, issues: [issue(2)] };

  const comparison = compareResults(from, to);

  assert.equal(comparison.resolvedIssues.length, 1);
  assert.equal(comparison.resolvedIssues[0]?.rowIndex, 1);
  assert.equal(comparison.unchangedIssues.length, 1);
});

test('on-hold effort rule can be disabled by policy', async () => {
  const file = await loadSample();
  const result = runAudit(file, { ...createDefaultAuditPolicy(), onHoldEffortEnabled: false, highEffortThreshold: 900 });

  assert.ok(!result.issues.some((issue) => issue.ruleCode === 'RUL-STATE-ONHOLD-EFFORT'));
});

test('policy change detection ignores timestamp-only saves', () => {
  const snapshot = createDefaultAuditPolicy('2026-04-16T00:00:00.000Z');
  const timestampOnly = { ...snapshot, updatedAt: '2026-04-16T01:00:00.000Z' };
  const changedValue = { ...timestampOnly, highEffortThreshold: snapshot.highEffortThreshold + 1 };

  assert.equal(isPolicyChanged(timestampOnly, snapshot), false);
  assert.equal(isPolicyChanged(changedValue, snapshot), true);
});
