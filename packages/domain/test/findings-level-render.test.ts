import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFindingsByEngineMarkdown,
  buildFindingsByEngineTextTable,
  buildFindingsByEngineHtmlTable,
} from '../src/audit/findingsByEngine';
import type { EngineFindingLine } from '../src/audit/findingsByEngine';

const base = {
  engineKey: 'master-data',
  engineLabel: 'Master Data',
  notes: '',
};

test('Escalation column/level appears in all renderers when levels are set', () => {
  const lines: EngineFindingLine[] = [
    { ...base, projectNo: 'P1', projectName: 'Acme', severity: 'High', ruleName: 'Missing owner', occurrenceLevel: 2 },
    { ...base, projectNo: 'P2', projectName: 'Beta', severity: 'Low', ruleName: 'Missing rate', occurrenceLevel: 1 },
  ];
  const md = buildFindingsByEngineMarkdown(lines);
  const txt = buildFindingsByEngineTextTable(lines);
  const html = buildFindingsByEngineHtmlTable(lines);

  assert.ok(md.includes('L2'), 'markdown shows L2');
  assert.ok(md.includes('L1'), 'markdown shows L1');
  for (const out of [txt, html]) {
    assert.ok(out.includes('Escalation'), 'header present');
    assert.ok(out.includes('L2') && out.includes('L1'), 'levels present');
  }
});

test('no Escalation column when no line carries a level (backward compatible)', () => {
  const lines: EngineFindingLine[] = [
    { ...base, projectNo: 'P1', projectName: 'Acme', severity: 'High', ruleName: 'Missing owner' },
  ];
  const txt = buildFindingsByEngineTextTable(lines);
  const html = buildFindingsByEngineHtmlTable(lines);
  const md = buildFindingsByEngineMarkdown(lines);
  assert.ok(!txt.includes('Escalation'), 'text has no Escalation column');
  assert.ok(!html.includes('Escalation'), 'html has no Escalation column');
  assert.ok(!/\bL1\b/.test(md), 'markdown has no level tag');
});
