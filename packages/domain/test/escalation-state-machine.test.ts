import test from 'node:test';
import assert from 'node:assert/strict';
import { allStagePairs, canTransition, transition, type EscalationStage } from '../src/escalation/escalationStages.js';

test('canTransition matches exhaustive matrix expectations', () => {
  for (const [from, to] of allStagePairs()) {
    const ok = canTransition(from, to);
    if (from === to) assert.equal(ok, false, `${from} -> ${to}`);
    if (from === 'RESOLVED') assert.equal(ok, false, `${from} -> ${to}`);
  }
  assert.equal(canTransition('NEW', 'DRAFTED'), true);
  assert.equal(canTransition('NEW', 'SENT'), true);
  assert.equal(canTransition('RESOLVED', 'NEW'), false);
  assert.equal(canTransition('AWAITING_RESPONSE', 'ESCALATED_L1'), true);
});

test('transition produces payload and next slice', () => {
  const actor = { id: 'u1', email: 'a@b.com', displayName: 'A' };
  const r = transition(
    { stage: 'NEW' as EscalationStage, escalationLevel: 0, resolved: false },
    'SENT',
    actor,
    'draft ready',
    'composer.save',
  );
  assert.equal(r.next.stage, 'SENT');
  assert.equal(r.next.resolved, false);
  assert.equal(r.eventPayload.previousStage, 'NEW');
  assert.equal(r.eventPayload.nextStage, 'SENT');
  assert.equal(r.eventPayload.actor.id, 'u1');
  assert.equal(r.eventPayload.sourceAction, 'composer.save');
});

test('transition to RESOLVED clears escalation level', () => {
  const r = transition(
    { stage: 'AWAITING_RESPONSE' as EscalationStage, escalationLevel: 2, resolved: false },
    'RESOLVED',
    { id: 'u', email: 'u@u.com', displayName: 'U' },
    'done',
    'manual',
  );
  assert.equal(r.next.stage, 'RESOLVED');
  assert.equal(r.next.resolved, true);
  assert.equal(r.next.escalationLevel, 0);
});
