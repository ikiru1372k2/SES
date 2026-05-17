import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EscalationLevelResolver,
  computeOccurrenceLevels,
  escalationLevelLabel,
  occurrencePairKey,
  type OccurrenceRecord,
} from '../src/escalation/escalationLevels';

// Stand-ins for stable identities. In production these come from
// managerKey() and createIssueKey(); the level math only needs them to be
// stable strings.
const A = 'mgr-a';
const B = 'mgr-b';
const X = 'IKY-XXX'; // issue X
const Y = 'IKY-YYY'; // issue Y

const W1 = 'hash-week1';
const W2 = 'hash-week2';
const W3 = 'hash-week3';

test('first upload ever → everyone is L1', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W1, managerKey: B, issueKey: Y },
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 1);
  assert.equal(r.levelFor(B, Y), 1);
  assert.equal(r.labelFor(A, X), 'L1');
});

test('same manager + same issue on a later upload → L2 (repeat occurrence)', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X }, // week 1
    { findingsHash: W2, managerKey: A, issueKey: X }, // week 2
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 2);
  assert.equal(r.labelFor(A, X), 'L2');
});

test('new manager in a later week starts at L1 even while others are at L2', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X }, // week 1: A only
    { findingsHash: W2, managerKey: A, issueKey: X }, // week 2: A repeats
    { findingsHash: W2, managerKey: B, issueKey: Y }, // week 2: B is new
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 2, 'A repeats → L2');
  assert.equal(r.levelFor(B, Y), 1, 'B is new → L1');
});

test('same manager, different issue → L1 for the new issue', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: A, issueKey: X }, // X repeats
    { findingsHash: W2, managerKey: A, issueKey: Y }, // Y is new for A
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 2);
  assert.equal(r.levelFor(A, Y), 1);
});

test('same issue, different manager → L1 for the new manager', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: B, issueKey: X }, // same issue X, new mgr B
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 2);
  assert.equal(r.levelFor(B, X), 1);
});

test('two managers, same issue both weeks → both L1 then both L2', () => {
  const week1: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W1, managerKey: B, issueKey: X },
  ];
  const afterW1 = new EscalationLevelResolver(week1);
  assert.equal(afterW1.levelFor(A, X), 1);
  assert.equal(afterW1.levelFor(B, X), 1);

  const week2 = [
    ...week1,
    { findingsHash: W2, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: B, issueKey: X },
  ];
  const afterW2 = new EscalationLevelResolver(week2);
  assert.equal(afterW2.levelFor(A, X), 2);
  assert.equal(afterW2.levelFor(B, X), 2);
});

test('re-upload of an identical sheet does not double-increment (idempotent)', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: A, issueKey: X },
    // Same content uploaded/re-run again — same findingsHash as W2.
    { findingsHash: W2, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: A, issueKey: X },
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 2, 'still L2 — identical re-upload is one occurrence');
});

test('duplicate rows within one run count once', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W1, managerKey: A, issueKey: X }, // duplicate row, same run
  ];
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor(A, X), 1);
});

test('three distinct weekly uploads → L3', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: A, issueKey: X },
    { findingsHash: W2, managerKey: A, issueKey: X },
    { findingsHash: W3, managerKey: A, issueKey: X },
  ];
  assert.equal(new EscalationLevelResolver(records).levelFor(A, X), 3);
});

test('missing manager or issue id → safe L1 fallback, record skipped', () => {
  const records: OccurrenceRecord[] = [
    { findingsHash: W1, managerKey: '', issueKey: X },
    { findingsHash: W1, managerKey: A, issueKey: '' },
  ];
  const levels = computeOccurrenceLevels(records);
  assert.equal(levels.size, 0, 'records with no identity are dropped');
  const r = new EscalationLevelResolver(records);
  assert.equal(r.levelFor('', X), 1, 'unknown manager → L1');
  assert.equal(r.levelFor(A, null), 1, 'missing issue → L1');
  assert.equal(r.levelFor(A, X), 1, 'unknown pair → L1');
});

test('pair never seen → L1', () => {
  const r = new EscalationLevelResolver([{ findingsHash: W1, managerKey: A, issueKey: X }]);
  assert.equal(r.levelFor(B, Y), 1);
});

test('escalationLevelLabel floors at L1 and handles junk', () => {
  assert.equal(escalationLevelLabel(1), 'L1');
  assert.equal(escalationLevelLabel(4), 'L4');
  assert.equal(escalationLevelLabel(0), 'L1');
  assert.equal(escalationLevelLabel(-3), 'L1');
  assert.equal(escalationLevelLabel(NaN), 'L1');
  assert.equal(escalationLevelLabel(null), 'L1');
  assert.equal(escalationLevelLabel(2.9), 'L2');
});

test('occurrencePairKey is stable and separates fields', () => {
  assert.equal(occurrencePairKey(A, X), occurrencePairKey(A, X));
  assert.notEqual(occurrencePairKey(A, X), occurrencePairKey(A, Y));
  assert.notEqual(occurrencePairKey(A, X), occurrencePairKey(B, X));
});
