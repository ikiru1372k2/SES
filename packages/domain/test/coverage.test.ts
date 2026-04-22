import test from 'node:test';
import assert from 'node:assert/strict';
import { effortAnomalies } from '../src/anomaly.js';
import { buildAuditReportHtml } from '../src/reporting.js';
import {
  auditIssueKey,
  buildIssuesCsv,
  compareResults,
  createIssueKey,
  runAudit,
} from '../src/auditEngine.js';
import type { AuditIssue, AuditResult, AuditVersion, WorkbookFile } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: 'i1',
    projectNo: 'P001',
    projectName: 'Test Project',
    sheetName: 'Sheet1',
    severity: 'High',
    projectManager: 'Smith, John',
    projectState: 'Authorised',
    effort: 1000,
    auditStatus: 'RUL-EFFORT-OVERPLAN-HIGH',
    notes: 'Effort is 1000h',
    rowIndex: 1,
    ...overrides,
  };
}

function makeResult(issues: AuditIssue[], fileId = 'f1'): AuditResult {
  return {
    fileId,
    runAt: '2026-01-01T00:00:00.000Z',
    scannedRows: 10,
    flaggedRows: issues.length,
    issues,
    sheets: [{ sheetName: 'Sheet1', rowCount: 10, flaggedCount: issues.length }],
  };
}

function makeVersion(issues: AuditIssue[]): AuditVersion {
  return {
    id: 'v1',
    fileId: 'f1',
    processId: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user1',
    result: makeResult(issues),
  };
}

function makeWorkbook(rows: unknown[][], selected = true): WorkbookFile {
  return {
    id: 'wf1',
    name: 'test.xlsx',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    lastAuditedAt: null,
    isAudited: false,
    sheets: [{
      name: 'Effort Data',
      status: 'valid',
      rowCount: rows.length - 1,
      isSelected: selected,
      headerRowIndex: 0,
    }],
    rawData: { 'Effort Data': rows },
  };
}

// ─── anomaly.ts ───────────────────────────────────────────────────────────────

test('effortAnomalies returns empty array when fewer than two versions are provided', () => {
  assert.deepEqual(effortAnomalies([]), []);
  assert.deepEqual(effortAnomalies([makeVersion([makeIssue()])]), []);
});

test('effortAnomalies detects effort increase above default threshold', () => {
  const base = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 500 });
  const updated = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 750 });
  const anomalies = effortAnomalies([makeVersion([updated]), makeVersion([base])]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.delta, 250);
  assert.equal(anomalies[0]!.previousEffort, 500);
});

test('effortAnomalies respects custom minimumDelta threshold', () => {
  const base = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 500 });
  const updated = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 600 });
  assert.equal(effortAnomalies([makeVersion([updated]), makeVersion([base])], 200).length, 0);
  assert.equal(effortAnomalies([makeVersion([updated]), makeVersion([base])], 50).length, 1);
});

test('effortAnomalies ignores issues with no matching previous entry', () => {
  const base = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 500 });
  const newIssue = makeIssue({ projectNo: 'P999', sheetName: 'Sheet1', rowIndex: 5, effort: 900 });
  const anomalies = effortAnomalies([makeVersion([newIssue]), makeVersion([base])]);
  assert.equal(anomalies.length, 0);
});

test('effortAnomalies detects effort decrease (negative delta)', () => {
  const base = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 900 });
  const updated = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 500 });
  const anomalies = effortAnomalies([makeVersion([updated]), makeVersion([base])]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.delta, -400);
});

// ─── reporting.ts ─────────────────────────────────────────────────────────────

test('buildAuditReportHtml escapes HTML special characters in process name and issue fields', () => {
  const issue = makeIssue({
    projectNo: '<b>XSS</b>',
    projectName: '"quoted"',
    projectManager: '& ampersand',
    notes: '<script>alert(1)</script>',
  });
  const html = buildAuditReportHtml('<Process & Name>', makeResult([issue]));
  assert.ok(html.includes('&lt;Process &amp; Name&gt;'));
  assert.ok(html.includes('&lt;b&gt;XSS&lt;/b&gt;'));
  assert.ok(html.includes('&amp; ampersand'));
  assert.ok(!html.includes('<script>'));
});

test('buildAuditReportHtml counts severity levels correctly', () => {
  const issues = [
    makeIssue({ severity: 'High' }),
    makeIssue({ severity: 'High', id: 'i2' }),
    makeIssue({ severity: 'Medium', id: 'i3' }),
    makeIssue({ severity: 'Low', id: 'i4' }),
  ];
  const html = buildAuditReportHtml('Test', makeResult(issues));
  assert.ok(html.includes('<strong>2</strong>'));  // High count
  assert.ok(html.includes('<strong>1</strong>'));  // Medium + Low
});

test('buildAuditReportHtml renders correction summary when corrections are provided', () => {
  const issue = makeIssue({ issueKey: 'IKY-ABC001' });
  const corrections = {
    'P001|Sheet1|1': {
      id: 'c1',
      issueKey: 'IKY-ABC001',
      processId: 'p1',
      effort: 400,
      note: 'Reduced to 400h after review',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const html = buildAuditReportHtml('Test', makeResult([issue]), corrections);
  assert.ok(html.includes('Correction summary'));
  assert.ok(html.includes('Smith, John'));
  assert.ok(html.includes('600'));  // hours recovered: 1000 - 400
});

test('buildAuditReportHtml with no issues produces valid HTML skeleton', () => {
  const html = buildAuditReportHtml('Empty Process', makeResult([]));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Empty Process'));
  assert.ok(html.includes('<strong>0</strong>'));
});

// ─── auditEngine.ts — untested branches ───────────────────────────────────────

test('createIssueKey produces a stable deterministic key for same inputs', () => {
  const issue = { projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, ruleCode: 'RUL-TEST', ruleId: 'RUL-TEST' };
  const k1 = createIssueKey('scope-A', issue);
  const k2 = createIssueKey('scope-A', issue);
  assert.equal(k1, k2);
  assert.equal(k1, 'IKY-467E6C');
  assert.ok(k1.startsWith('IKY-'));
});

test('createIssueKey produces different keys for different scopes', () => {
  const issue = { projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, ruleCode: 'RUL-TEST', ruleId: 'RUL-TEST' };
  assert.notEqual(createIssueKey('scope-A', issue), createIssueKey('scope-B', issue));
});

test('createIssueKey falls back to ROW-N when projectNo is empty', () => {
  const issue = { projectNo: '', sheetName: 'Sheet1', rowIndex: 5, ruleCode: 'RUL-TEST', ruleId: 'RUL-TEST' };
  const key = createIssueKey('scope', issue);
  assert.ok(key.startsWith('IKY-'));
  // Different row produces different key
  const issue2 = { ...issue, rowIndex: 6 };
  assert.notEqual(key, createIssueKey('scope', issue2));
});

test('compareResults classifies new, resolved, and changed issues', () => {
  const shared = makeIssue({ id: 'shared', projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1 });
  const oldOnly = makeIssue({ id: 'old', projectNo: 'P002', sheetName: 'Sheet1', rowIndex: 2 });
  const newOnly = makeIssue({ id: 'new', projectNo: 'P003', sheetName: 'Sheet1', rowIndex: 3 });
  const changedSeverity = makeIssue({ id: 'changed', projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, severity: 'Medium' });

  const from = makeResult([shared, oldOnly]);
  const to = makeResult([changedSeverity, newOnly]);
  const result = compareResults(from, to);

  assert.equal(result.newIssues.length, 1);
  assert.equal(result.newIssues[0]!.projectNo, 'P003');
  assert.equal(result.resolvedIssues.length, 1);
  assert.equal(result.resolvedIssues[0]!.projectNo, 'P002');
  assert.equal(result.changedIssues.length, 1);
  assert.equal(result.changedIssues[0]!.severity, 'Medium');
});

test('compareResults tracks effort and state changes separately', () => {
  const base = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 500, projectState: 'Authorised' });
  const updated = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 1, effort: 800, projectState: 'On Hold' });

  const result = compareResults(makeResult([base]), makeResult([updated]));
  assert.equal(result.effortChanges.length, 1);
  assert.equal(result.stateChanges.length, 1);
  assert.equal(result.managerChanges.length, 0);
});

test('buildIssuesCsv produces RFC-4180 CSV with header row and escapes double-quotes', () => {
  const issue = makeIssue({ projectName: 'Project "Alpha"', reason: 'Effort exceeds threshold', recommendedAction: 'Review' });
  const csv = buildIssuesCsv([issue]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '"Severity","Project No","Project Name","Manager","Sheet","State","Effort","Rule","Category","Reason","Recommended Action"');
  assert.ok(lines[1]!.includes('"Project ""Alpha"""'));  // double-quote escaping
  assert.equal(lines.length, 2);
});

test('buildIssuesCsv returns header-only for empty issues array', () => {
  const csv = buildIssuesCsv([]);
  assert.equal(csv.split('\n').length, 1);
  assert.ok(csv.startsWith('"Severity"'));
});

test('runAudit flags zero-effort rows when zeroEffortEnabled is true', () => {
  const file = makeWorkbook([
    ['Project No.', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
    ['P001', 'Test Project', 'Authorised', 'Smith, J', 0],
  ]);
  const result = runAudit(file, {
    highEffortThreshold: 800,
    mediumEffortMin: 600, mediumEffortMax: 800,
    lowEffortMin: 0, lowEffortMax: 100,
    lowEffortEnabled: false,
    zeroEffortEnabled: true,
    missingEffortEnabled: false,
    missingManagerEnabled: false,
    inPlanningEffortEnabled: false,
    onHoldEffortEnabled: false,
    onHoldEffortThreshold: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, 'RUL-EFFORT-ZERO');
});

test('runAudit flags missing manager when missingManagerEnabled is true', () => {
  const file = makeWorkbook([
    ['Project No.', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
    ['P001', 'Test Project', 'Authorised', '', 200],
  ]);
  const result = runAudit(file, {
    highEffortThreshold: 800,
    mediumEffortMin: 600, mediumEffortMax: 800,
    lowEffortMin: 0, lowEffortMax: 100,
    lowEffortEnabled: false,
    zeroEffortEnabled: false,
    missingEffortEnabled: false,
    missingManagerEnabled: true,
    inPlanningEffortEnabled: false,
    onHoldEffortEnabled: false,
    onHoldEffortThreshold: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.ruleCode, 'RUL-MGR-MISSING');
});

test('runAudit skips unselected and invalid sheets', () => {
  const file: WorkbookFile = {
    id: 'wf1',
    name: 'test.xlsx',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    lastAuditedAt: null,
    isAudited: false,
    sheets: [
      { name: 'Valid', status: 'valid', rowCount: 1, isSelected: false, headerRowIndex: 0 },
      { name: 'Invalid', status: 'invalid', rowCount: 1, isSelected: true, headerRowIndex: 0 },
    ],
    rawData: {
      Valid: [['Effort (H)'], [900]],
      Invalid: [['Effort (H)'], [900]],
    },
  };
  const result = runAudit(file);
  assert.equal(result.issues.length, 0);
  assert.equal(result.scannedRows, 0);
});

test('runAudit attaches issueScope keys when issueScope option is provided', () => {
  const file = makeWorkbook([
    ['Project No.', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
    ['P001', 'Test Project', 'Authorised', 'Smith, J', 1000],
  ]);
  const result = runAudit(file, undefined, { issueScope: 'PRC-2026-0001' });
  assert.equal(result.issues.length, 1);
  assert.ok(result.issues[0]!.issueKey?.startsWith('IKY-'));
});

test('auditIssueKey produces pipe-separated key from projectNo, sheetName, rowIndex', () => {
  const issue = makeIssue({ projectNo: 'P001', sheetName: 'Sheet1', rowIndex: 3 });
  assert.equal(auditIssueKey(issue), 'P001|Sheet1|3');
});
