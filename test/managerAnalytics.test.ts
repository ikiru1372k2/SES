import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateAcrossProcesses } from '../src/lib/managerAnalytics.js';
import type { AuditProcess, TrackingEntry } from '../src/lib/types.js';

function makeProcess(entries: TrackingEntry[]): AuditProcess {
  return {
    id: 'p', name: 'P', description: '', createdAt: '', updatedAt: '', nextAuditDue: null,
    files: [], activeFileId: null, versions: [],
    auditPolicy: {} as AuditProcess['auditPolicy'],
    notificationTracking: Object.fromEntries(entries.map((e) => [e.key, e])),
    comments: {}, corrections: {}, acknowledgments: {}, savedTemplates: {},
  } as AuditProcess;
}

test('chronicSlowResponder triggers when flagged ≥3 and response rate <50%', () => {
  const baseEntry = (email: string, outlookCount = 0, resolved = false): TrackingEntry => ({
    key: `p:${email}`,
    processId: 'p',
    managerName: 'Foo',
    managerEmail: email,
    flaggedProjectCount: 1,
    outlookCount,
    teamsCount: 0,
    lastContactAt: null,
    stage: resolved ? 'Resolved' : 'Not contacted',
    resolved,
    history: [],
    projectStatuses: {},
  });

  const processes = [
    makeProcess([baseEntry('a@x.com', 0, false)]),
    makeProcess([baseEntry('a@x.com', 0, false)]),
    makeProcess([baseEntry('a@x.com', 0, false)]),
  ];
  const [stat] = aggregateAcrossProcesses(processes).filter((s) => s.email === 'a@x.com');
  assert.equal(stat?.chronicSlowResponder, true);
});
