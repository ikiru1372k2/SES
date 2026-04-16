import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { createDefaultAuditPolicy, policySummary } from '../src/lib/auditPolicy.js';
import { compareResults, runAudit } from '../src/lib/auditEngine.js';
import { parseWorkbook } from '../src/lib/excelParser.js';
import type { WorkbookFile } from '../src/lib/types.js';

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
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Effort Data');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Summary');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

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

test('QGC audit focuses on overplanning and missing planning', async () => {
  const file = await loadSample();
  file.rawData['Effort Data'].push(['100', 'Digital Transformation', 'Synthetic Customer', '99999999', 'Synthetic Missing Effort', 'Authorised', 'Manager, Test', 'test.manager@company.com', '']);
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
