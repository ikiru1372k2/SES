import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { aggregateEscalations, type AggregatorIssueRow, type AggregatorTrackingRow } from '../src/escalations-aggregator';

describe('aggregateEscalations', () => {
  it('groups issues by manager key and attaches tracking', () => {
    const issues: AggregatorIssueRow[] = [
      {
        issueKey: 'k1',
        projectManager: 'Alice',
        email: 'alice@example.com',
        engineId: 'master-data',
        projectNo: 'P1',
        projectName: 'N1',
      },
      {
        issueKey: 'k2',
        projectManager: 'Alice',
        email: 'alice@example.com',
        engineId: 'over-planning',
        projectNo: 'P2',
        projectName: 'N2',
      },
    ];
    const tracking: AggregatorTrackingRow[] = [
      {
        managerKey: 'alice@example.com',
        managerName: 'Alice',
        managerEmail: 'alice@example.com',
        stage: 'SENT',
        resolved: false,
        lastContactAt: null,
        slaDueAt: null,
        id: 't1',
        displayCode: 'TRK-1',
        outlookCount: 1,
        teamsCount: 0,
      },
    ];
    const payload = aggregateEscalations('proc-1', issues, tracking);
    assert.equal(payload.rows.length, 1);
    const row = payload.rows[0]!;
    assert.equal(row.managerKey, 'alice@example.com');
    assert.equal(row.totalIssues, 2);
    assert.equal(row.countsByEngine['master-data'], 1);
    assert.equal(row.countsByEngine['over-planning'], 1);
    assert.equal(row.stage, 'SENT');
    assert.equal(row.trackingId, 't1');
  });

  // ─── Regression: managerKey drift between runs (bug #3/#4) ────────────
  // Scenario: Run 1 created a TrackingEntry with managerKey
  // "missing-email:smith" because the Manager Directory hadn't been populated
  // yet. After the directory entry is added, Run 2's issues compute
  // managerKey "smith@x.com". Before this fix the aggregator lost the
  // tracking row's resolved status and created a duplicate row under the new
  // key. The name-fallback lookup reunites them.
  it('carries resolved status across runs when managerKey drifts from missing-email to resolved email', () => {
    const issues: AggregatorIssueRow[] = [
      {
        issueKey: 'k-new',
        projectManager: 'Smith',
        email: 'smith@x.com', // directory resolved the email on this run
        engineId: 'master-data',
        projectNo: 'P1',
        projectName: 'N1',
      },
    ];
    const tracking: AggregatorTrackingRow[] = [
      {
        // Stored with the old unresolved key.
        managerKey: 'missing-email:smith',
        managerName: 'Smith',
        managerEmail: null,
        stage: 'RESOLVED',
        resolved: true,
        lastContactAt: new Date('2026-04-01T00:00:00Z'),
        slaDueAt: null,
        id: 't-old',
        displayCode: 'TRK-9',
        outlookCount: 3,
        teamsCount: 0,
      },
    ];
    const payload = aggregateEscalations('proc-1', issues, tracking);
    // Exactly one row (name fallback reunited them; no duplicate).
    assert.equal(payload.rows.length, 1);
    const row = payload.rows[0]!;
    assert.equal(row.managerName, 'Smith');
    assert.equal(row.totalIssues, 1);
    // Resolved status carried through from the old tracking row.
    assert.equal(row.resolved, true);
    assert.equal(row.stage, 'RESOLVED');
    assert.equal(row.trackingId, 't-old');
    assert.equal(row.outlookCount, 3);
  });

  it('falls back to name match when issue email is blank but tracking is resolved-email keyed', () => {
    const issues: AggregatorIssueRow[] = [
      {
        issueKey: 'k-drop',
        projectManager: 'Jane Doe',
        email: '', // engine produced no email this run
        engineId: 'over-planning',
        projectNo: 'P2',
        projectName: 'N2',
      },
    ];
    const tracking: AggregatorTrackingRow[] = [
      {
        managerKey: 'jane@x.com',
        managerName: 'Jane Doe',
        managerEmail: 'jane@x.com',
        stage: 'FOLLOWUP',
        resolved: false,
        lastContactAt: null,
        slaDueAt: null,
        id: 't-jane',
        displayCode: 'TRK-10',
        outlookCount: 0,
        teamsCount: 0,
      },
    ];
    const payload = aggregateEscalations('proc-1', issues, tracking);
    assert.equal(payload.rows.length, 1);
    const row = payload.rows[0]!;
    assert.equal(row.managerName, 'Jane Doe');
    assert.equal(row.stage, 'FOLLOWUP');
    assert.equal(row.trackingId, 't-jane');
    assert.equal(row.totalIssues, 1);
  });

  it('does NOT emit a duplicate empty-bucket row for a tracking entry whose name already matched an issue bucket', () => {
    // If the aggregator failed to mark the old tracking row as consumed,
    // we would see two rows: one from the new-key bucket and one empty
    // bucket from the old tracking row. Guard against that regression.
    const issues: AggregatorIssueRow[] = [
      {
        issueKey: 'k1',
        projectManager: 'Bob',
        email: 'bob@x.com',
        engineId: 'master-data',
        projectNo: 'P1',
        projectName: 'N1',
      },
    ];
    const tracking: AggregatorTrackingRow[] = [
      {
        managerKey: 'missing-email:bob',
        managerName: 'Bob',
        managerEmail: null,
        stage: 'NEW',
        resolved: false,
        lastContactAt: null,
        slaDueAt: null,
        id: 't-bob-old',
        displayCode: 'TRK-BOB',
        outlookCount: 0,
        teamsCount: 0,
      },
    ];
    const payload = aggregateEscalations('proc-1', issues, tracking);
    assert.equal(payload.rows.length, 1, 'expected a single reunited row, not a duplicate');
    assert.equal(payload.rows[0]!.managerName, 'Bob');
  });

  it('still emits an empty-bucket row for a tracking entry whose manager has no issues and no name match', () => {
    // Baseline non-regression: genuine "no-issues-this-run" tracking rows
    // must still surface so the Escalation Center can show them as resolved.
    const issues: AggregatorIssueRow[] = [];
    const tracking: AggregatorTrackingRow[] = [
      {
        managerKey: 'carol@x.com',
        managerName: 'Carol',
        managerEmail: 'carol@x.com',
        stage: 'RESOLVED',
        resolved: true,
        lastContactAt: null,
        slaDueAt: null,
        id: 't-carol',
        displayCode: 'TRK-C',
        outlookCount: 0,
        teamsCount: 0,
      },
    ];
    const payload = aggregateEscalations('proc-1', issues, tracking);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.managerName, 'Carol');
    assert.equal(payload.rows[0]!.resolved, true);
    assert.equal(payload.rows[0]!.totalIssues, 0);
  });
});
