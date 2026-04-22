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
});
