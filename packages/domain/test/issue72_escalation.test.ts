import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition } from '../src/escalation/escalationStages';
import {
  buildFindingsByEngineMarkdown,
  buildFindingsByEngineTextTable,
  buildFindingsByEngineHtmlTable,
} from '../src/audit/findingsByEngine';
import type { EngineFindingLine } from '../src/audit/findingsByEngine';
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

test('preview groups findings by project and never names the source engine', () => {
  const lines: EngineFindingLine[] = [
    { engineKey: 'master-data', engineLabel: 'Master Data', projectNo: 'P1', projectName: 'Acme', severity: 'High', ruleName: 'Missing industry', notes: '', detail: { ruleCode: '', ruleName: 'Missing industry', ruleCategory: '', severity: 'High', reason: 'Industry is blank', thresholdLabel: null, recommendedAction: null, sheetName: null, projectManager: null, projectState: null, effort: null, affectedMonths: null, zeroMonthCount: null, missingFieldLabel: 'Project Industry', projectLink: null } },
    { engineKey: 'over-planning', engineLabel: 'Over Planning', projectNo: 'P1', projectName: 'Acme', severity: 'Medium', ruleName: 'Over threshold', notes: '' },
    { engineKey: 'internal-cost-rate', engineLabel: 'Internal Cost Rate', projectNo: 'P2', projectName: 'Beta', severity: 'Low', ruleName: 'Missing rate', notes: '' },
  ];
  const md = buildFindingsByEngineMarkdown(lines);
  const txt = buildFindingsByEngineTextTable(lines);
  const html = buildFindingsByEngineHtmlTable(lines);

  // One section per unique project, ordered A–Z.
  assert.ok(md.includes('### P1 — Acme (2 findings)'));
  assert.ok(md.includes('### P2 — Beta (1 finding)'));
  assert.ok(md.indexOf('### P1 — Acme') < md.indexOf('### P2 — Beta'));
  // Both of P1's findings are listed under the single P1 section.
  const p1Block = md.slice(md.indexOf('### P1 — Acme'), md.indexOf('### P2 — Beta'));
  assert.ok(p1Block.includes('Project Industry'));
  assert.ok(p1Block.includes('Over threshold'));
  assert.ok(txt.includes('=== P1 — Acme (2 findings) ==='));

  // Internal engine names/labels must never leak into the recipient-facing output.
  for (const out of [md, txt, html]) {
    for (const banned of ['Master Data', 'Over Planning', 'Internal Cost Rate', 'master-data', 'over-planning', 'internal-cost-rate']) {
      assert.ok(!out.includes(banned), `engine name "${banned}" leaked into preview`);
    }
  }
});

test('findings without a project fall into the Unassigned bucket, sorted last', () => {
  const lines: EngineFindingLine[] = [
    { engineKey: 'master-data', engineLabel: 'Master Data', projectNo: '', projectName: '', severity: 'High', ruleName: 'Orphan', notes: '' },
    { engineKey: 'master-data', engineLabel: 'Master Data', projectNo: 'P1', projectName: 'Acme', severity: 'Low', ruleName: 'Missing owner', notes: '' },
  ];
  const md = buildFindingsByEngineMarkdown(lines);
  assert.ok(md.includes('### Unassigned (1 finding)'));
  assert.ok(md.indexOf('### P1 — Acme') < md.indexOf('### Unassigned'));
});

test('legal transitions', () => {
  assert.ok(canTransition('NEW', 'DRAFTED'));
  assert.ok(canTransition('NEW', 'SENT'));
  assert.ok(canTransition('SENT', 'AWAITING_RESPONSE'));
  assert.throws(() => assertTransition('SENT', 'NEW'));
});
