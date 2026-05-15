import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition } from '../src/escalation/escalationStages';
import { buildFindingsByEngineMarkdown } from '../src/audit/findingsByEngine';
import { substitute } from '../src/notifications/templateSubstitute';

test('substitute replaces known tokens', () => {
  const out = substitute('Hi {managerFirstName}, {processName}', {
    managerFirstName: 'Alex',
    processName: 'PRC-1',
  });
  assert.equal(out, 'Hi Alex, PRC-1');
});

test('substitute clears unknown token names', () => {
  const out = substitute('x {unknown} y', { a: 1 });
  assert.equal(out, 'x  y');
});

test('buildFindingsByEngineMarkdown groups engines', () => {
  const md = buildFindingsByEngineMarkdown([
    {
      engineKey: 'e1',
      engineLabel: 'Engine One',
      projectNo: 'P1',
      projectName: 'N1',
      severity: 'High',
      ruleName: 'R1',
      notes: '',
    },
    {
      engineKey: 'e2',
      engineLabel: 'Engine Two',
      projectNo: 'P2',
      projectName: '',
      severity: 'Low',
      ruleName: 'R2',
      notes: 'x',
    },
  ]);
  assert.ok(md.includes('Engine One'));
  assert.ok(md.includes('Engine Two'));
});

test('legal transitions', () => {
  assert.ok(canTransition('NEW', 'DRAFTED'));
  assert.ok(canTransition('NEW', 'SENT'));
  assert.ok(canTransition('SENT', 'AWAITING_RESPONSE'));
  assert.throws(() => assertTransition('SENT', 'NEW'));
});
