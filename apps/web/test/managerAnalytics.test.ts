import test from 'node:test';
import assert from 'node:assert/strict';
import { managerStats } from '../src/lib/managerAnalytics.js';
import type { AuditIssue, AuditProcess, AuditResult, AuditVersion, TrackingEntry } from '../src/lib/types.js';

function issue(patch: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: 'i1', projectNo: 'P-1', projectName: 'P', sheetName: 'S',
    severity: 'High', projectManager: 'Wagner', projectState: 'Authorised',
    effort: 900, auditStatus: 'HIGH', notes: 'over', rowIndex: 2,
    email: 'w@x.com', ...patch,
  };
}

function result(issues: AuditIssue[], runAt = '2026-01-01T00:00:00Z'): AuditResult {
  return {
    fileId: 'f', runAt,
    scannedRows: issues.length, flaggedRows: issues.length,
    issues, sheets: [{ sheetName: 'S', rowCount: issues.length, flaggedCount: issues.length }],
  };
}

function version(num: number, issues: AuditIssue[]): AuditVersion {
  return {
    id: `v${num}`, versionId: `v${num}`, versionNumber: num,
    versionName: `V${num}`, notes: '', createdAt: '2026-01-01T00:00:00Z',
    result: result(issues, `2026-01-0${num}T00:00:00Z`),
  };
}

function process(versions: AuditVersion[], tracking: TrackingEntry[]): AuditProcess {
  return {
    id: 'p', name: 'P', description: '', createdAt: '', updatedAt: '', nextAuditDue: null,
    files: [], activeFileId: null, versions,
    auditPolicy: {} as AuditProcess['auditPolicy'],
    notificationTracking: Object.fromEntries(tracking.map((t) => [t.key, t])),
    comments: {}, corrections: {}, acknowledgments: {}, savedTemplates: {},
  } as AuditProcess;
}

test('cyclesFlagged counts versions the manager appears in, not the raw issue count', () => {
  const versions = [
    version(1, [issue({ projectManager: 'Wagner' }), issue({ projectManager: 'Wagner', id: 'i2' })]),
    version(2, [issue({ projectManager: 'Wagner', id: 'i3' })]),
    version(3, [issue({ projectManager: 'Mueller', id: 'i4' })]),
  ];
  const tracking: TrackingEntry[] = [{
    key: 'p:w@x.com', processId: 'p', managerName: 'Wagner', managerEmail: 'w@x.com',
    flaggedProjectCount: 2, outlookCount: 0, teamsCount: 0, lastContactAt: null,
    stage: 'Not contacted', resolved: false, history: [], projectStatuses: {},
  }];
  const [stat] = managerStats(process(versions, tracking));
  assert.equal(stat?.cyclesFlagged, 2);
  assert.equal(stat?.chronicSlowResponder, false);
});

test('chronicSlowResponder triggers when flagged in ≥3 cycles without response', () => {
  const versions = [
    version(1, [issue({ projectManager: 'Wagner' })]),
    version(2, [issue({ projectManager: 'Wagner', id: 'i2' })]),
    version(3, [issue({ projectManager: 'Wagner', id: 'i3' })]),
  ];
  const tracking: TrackingEntry[] = [{
    key: 'p:w@x.com', processId: 'p', managerName: 'Wagner', managerEmail: 'w@x.com',
    flaggedProjectCount: 3, outlookCount: 0, teamsCount: 0, lastContactAt: null,
    stage: 'Not contacted', resolved: false, history: [], projectStatuses: {},
  }];
  const [stat] = managerStats(process(versions, tracking));
  assert.equal(stat?.cyclesFlagged, 3);
  assert.equal(stat?.chronicSlowResponder, true);
});
