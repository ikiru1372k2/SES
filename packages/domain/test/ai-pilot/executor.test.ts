import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiPilotRules } from '../../src/ai-pilot/executor.js';
import type { AiRuleSpec } from '../../src/ai-pilot/types.js';
import type { WorkbookFile } from '../../src/types.js';

const fileWithRows = (): WorkbookFile => ({
  id: 'f1',
  name: 'sample.xlsx',
  uploadedAt: new Date().toISOString(),
  lastAuditedAt: null,
  isAudited: false,
  sheets: [
    {
      name: 'Sheet1',
      status: 'valid',
      rowCount: 3,
      isSelected: true,
      headerRowIndex: 0,
      normalizedHeaders: ['projectNo', 'projectName', 'State', 'Effort'],
      originalHeaders: ['Project No', 'Project Name', 'State', 'Effort'],
    },
  ],
  rawData: {
    Sheet1: [
      ['Project No', 'Project Name', 'State', 'Effort'],
      ['P001', 'Alpha', 'Active', 100],
      ['P002', 'Beta', '', 250],
      ['P003', 'Gamma', 'Unknown', 50],
    ],
  },
});

const blankStateRule: AiRuleSpec = {
  ruleCode: 'ai_blank_state',
  ruleVersion: 1,
  functionId: 'master-data',
  name: 'State must not be blank',
  category: 'Data Quality',
  severity: 'High',
  flagMessage: 'State is blank for {projectNo}',
  logic: { op: 'isBlank', column: 'State' },
};

const highEffortRule: AiRuleSpec = {
  ruleCode: 'ai_high_effort',
  ruleVersion: 1,
  functionId: 'master-data',
  name: 'Effort over 200',
  category: 'Effort Threshold',
  severity: 'Medium',
  flagMessage: 'Effort exceeds 200 for {projectNo}',
  logic: { op: '>', column: 'Effort', value: 200 },
};

test('runAiPilotRules flags rows matching a rule with proper AuditIssue shape', () => {
  const result = runAiPilotRules(fileWithRows(), {
    functionId: 'master-data',
    rules: [blankStateRule],
    issueScope: 'PRC-1',
    runCode: 'RUN-1',
  });
  assert.equal(result.scannedRows, 3);
  assert.equal(result.flaggedRows, 1);
  assert.equal(result.issues.length, 1);

  const issue = result.issues[0]!;
  assert.equal(issue.ruleCode, 'ai_blank_state');
  assert.equal(issue.severity, 'High');
  assert.equal(issue.category, 'Data Quality');
  assert.equal(issue.projectNo, 'P002');
  assert.equal(issue.reason, 'State is blank for P002');
  assert.ok(issue.issueKey?.startsWith('IKY-'));
  assert.equal(issue.auditRunCode, 'RUN-1');
});

test('runAiPilotRules: multiple rules can flag same row independently', () => {
  const file = fileWithRows();
  // Add a row that's both blank-state AND high-effort
  file.rawData.Sheet1!.push(['P004', 'Delta', '', 300]);
  file.sheets[0]!.rowCount = 4;

  const result = runAiPilotRules(file, {
    functionId: 'master-data',
    rules: [blankStateRule, highEffortRule],
  });

  // P002 (blank state, effort 250) → 2 issues
  // P004 (blank state, effort 300) → 2 issues
  assert.equal(result.issues.length, 4);
  assert.equal(result.flaggedRows, 2);
});

test('runAiPilotRules with unknown column collects it but does not crash', () => {
  const result = runAiPilotRules(fileWithRows(), {
    functionId: 'master-data',
    rules: [
      {
        ...blankStateRule,
        logic: { op: 'isBlank', column: 'NonexistentColumn' },
      },
    ],
  });
  assert.equal(result.issues.length, 0);
  assert.ok(result.unknownColumns.includes('NonexistentColumn'));
});

test('runAiPilotRules processes multiple sheets', () => {
  const file = fileWithRows();
  file.sheets.push({
    name: 'Sheet2',
    status: 'valid',
    rowCount: 1,
    isSelected: true,
    headerRowIndex: 0,
    normalizedHeaders: ['projectNo', 'State'],
    originalHeaders: ['Project No', 'State'],
  });
  file.rawData.Sheet2 = [
    ['Project No', 'State'],
    ['P101', ''],
  ];

  const result = runAiPilotRules(file, {
    functionId: 'master-data',
    rules: [blankStateRule],
  });

  assert.equal(result.flaggedRows, 2); // P002 + P101
  assert.equal(result.sheets.length, 2);
});

test('runAiPilotRules skips invalid/deselected sheets', () => {
  const file = fileWithRows();
  file.sheets[0]!.isSelected = false;
  const result = runAiPilotRules(file, {
    functionId: 'master-data',
    rules: [blankStateRule],
  });
  assert.equal(result.scannedRows, 0);
  assert.equal(result.issues.length, 0);
});
