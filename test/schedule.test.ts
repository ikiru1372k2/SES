import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketedProcesses, daysUntilDue, nextDueDateAfterSave, scheduleBucket } from '../src/lib/scheduleHelpers.js';
import type { AuditProcess } from '../src/lib/types.js';

function process(nextAuditDue: string | null, patch: Partial<AuditProcess> = {}): AuditProcess {
  return {
    id: `process-${nextAuditDue ?? 'none'}`,
    name: 'Audit',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nextAuditDue,
    files: [],
    activeFileId: null,
    versions: [],
    auditPolicy: {
      highEffortThreshold: 900,
      mediumEffortMin: 400,
      mediumEffortMax: 800,
      lowEffortMin: 1,
      lowEffortMax: 399,
      lowEffortEnabled: false,
      zeroEffortEnabled: true,
      missingEffortEnabled: true,
      missingManagerEnabled: true,
      inPlanningEffortEnabled: true,
      onHoldEffortEnabled: true,
      onHoldEffortThreshold: 200,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    notificationTracking: {},
    comments: {},
    corrections: {},
    ...patch,
  };
}

test('schedule bucket boundaries classify due dates safely', () => {
  const now = new Date('2026-04-16T12:00:00.000Z');

  assert.equal(scheduleBucket(process('2026-04-15'), now), 'overdue');
  assert.equal(scheduleBucket(process('2026-04-16'), now), 'dueThisWeek');
  assert.equal(scheduleBucket(process('2026-04-23'), now), 'dueThisWeek');
  assert.equal(scheduleBucket(process('2026-04-24'), now), 'upcoming');
  assert.equal(scheduleBucket(process('2026-05-16'), now), 'upcoming');
  assert.equal(scheduleBucket(process('2026-05-17'), now), null);
  assert.equal(daysUntilDue('2026-04-15', now), -1);
});

test('bucketed processes are sorted and next due date respects detected cadence', () => {
  const now = new Date('2026-04-16T12:00:00.000Z');
  const buckets = bucketedProcesses([
    process('2026-04-30', { id: 'later' }),
    process('2026-04-14', { id: 'overdue' }),
    process('2026-04-20', { id: 'soon' }),
    process(null, { id: 'unscheduled' }),
  ], now);

  assert.deepEqual(buckets.overdue.map((item) => item.id), ['overdue']);
  assert.deepEqual(buckets.dueThisWeek.map((item) => item.id), ['soon']);
  assert.deepEqual(buckets.upcoming.map((item) => item.id), ['later']);

  const monthly = process('2026-04-16', {
    versions: [
      { id: 'v2', versionId: 'v2', versionNumber: 2, versionName: 'V2', notes: '', createdAt: '2026-04-16T00:00:00.000Z', result: { fileId: 'f', runAt: '2026-04-16T00:00:00.000Z', scannedRows: 0, flaggedRows: 0, issues: [], sheets: [] } },
      { id: 'v1', versionId: 'v1', versionNumber: 1, versionName: 'V1', notes: '', createdAt: '2026-03-17T00:00:00.000Z', result: { fileId: 'f', runAt: '2026-03-17T00:00:00.000Z', scannedRows: 0, flaggedRows: 0, issues: [], sheets: [] } },
    ],
  });

  assert.equal(nextDueDateAfterSave(monthly, now), '2026-05-16');
});
