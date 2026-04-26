import test from 'node:test';
import assert from 'node:assert/strict';
import { RULE_CATALOG_BY_FUNCTION } from '../../src/auditRules.js';
import { runAiPilotRules } from '../../src/ai-pilot/executor.js';
import { mergeAuditResults, mergeSheetSummaries } from '../../src/ai-pilot/merger.js';
import type { WorkbookFile, AuditResult } from '../../src/types.js';

const blankFile: WorkbookFile = {
  id: 'f1',
  name: 'blank.xlsx',
  uploadedAt: new Date().toISOString(),
  lastAuditedAt: null,
  isAudited: false,
  sheets: [],
  rawData: {},
};

test('AI rule codes never appear in any RULE_CATALOG_BY_FUNCTION', () => {
  for (const [functionId, rules] of Object.entries(RULE_CATALOG_BY_FUNCTION)) {
    for (const rule of rules) {
      assert.ok(
        !rule.ruleCode.startsWith('ai_'),
        `engine catalog for ${functionId} contains AI-namespaced rule ${rule.ruleCode}`,
      );
    }
  }
});

test('runAiPilotRules with empty rules returns no issues', () => {
  const result = runAiPilotRules(blankFile, { functionId: 'master-data', rules: [] });
  assert.equal(result.issues.length, 0);
  assert.equal(result.flaggedRows, 0);
});

test('runAiPilotRules executor module never imports a function-audit engine module', async () => {
  const exec = await import('../../src/ai-pilot/executor.js');
  const merger = await import('../../src/ai-pilot/merger.js');
  const evaluator = await import('../../src/ai-pilot/evaluator.js');
  const operators = await import('../../src/ai-pilot/operators.js');
  const resolver = await import('../../src/ai-pilot/columnResolver.js');
  for (const mod of [exec, merger, evaluator, operators, resolver]) {
    const keys = Object.keys(mod);
    for (const key of keys) {
      assert.ok(
        !/MasterData|OverPlanning|MissingPlan|FunctionRate|InternalCostRate|FUNCTION_AUDIT_ENGINES/.test(key),
        `ai-pilot module re-exports engine symbol ${key}`,
      );
    }
  }
});

test('mergeAuditResults preserves all issues from both sides (no de-dupe)', () => {
  const engine: AuditResult = {
    fileId: 'f1',
    runAt: 'now',
    scannedRows: 5,
    flaggedRows: 1,
    issues: [
      {
        id: 'e1',
        projectNo: 'P1',
        projectName: 'Alpha',
        sheetName: 'S1',
        severity: 'High',
        projectManager: '',
        projectState: '',
        effort: 0,
        auditStatus: 'open',
        notes: '',
        rowIndex: 1,
        ruleCode: 'RUL-MD-FOO',
      },
    ],
    sheets: [{ sheetName: 'S1', rowCount: 5, flaggedCount: 1 }],
  };
  const ai: AuditResult = {
    fileId: 'f1',
    runAt: 'now',
    scannedRows: 0,
    flaggedRows: 1,
    issues: [
      {
        id: 'a1',
        projectNo: 'P1',
        projectName: 'Alpha',
        sheetName: 'S1',
        severity: 'Medium',
        projectManager: '',
        projectState: '',
        effort: 0,
        auditStatus: 'open',
        notes: '',
        rowIndex: 1,
        ruleCode: 'ai_test',
      },
    ],
    sheets: [{ sheetName: 'S1', rowCount: 0, flaggedCount: 1 }],
  };
  const merged = mergeAuditResults(engine, ai);
  assert.equal(merged.issues.length, 2);
  assert.equal(merged.flaggedRows, 2);
  assert.equal(merged.scannedRows, 5);
});

test('mergeSheetSummaries sums flaggedRows but never doubles scannedRows', () => {
  const engine = [{ sheetName: 'A', rowCount: 100, flaggedCount: 3 }];
  const ai = [
    { sheetName: 'A', rowCount: 0, flaggedCount: 2 },
    { sheetName: 'B', rowCount: 0, flaggedCount: 5 },
  ];
  const merged = mergeSheetSummaries(engine, ai);
  const sheetA = merged.find((s) => s.sheetName === 'A')!;
  const sheetB = merged.find((s) => s.sheetName === 'B')!;
  assert.equal(sheetA.rowCount, 100);
  assert.equal(sheetA.flaggedCount, 5);
  assert.equal(sheetB.rowCount, 0);
  assert.equal(sheetB.flaggedCount, 5);
});
