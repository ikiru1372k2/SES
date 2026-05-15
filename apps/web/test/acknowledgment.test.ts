import assert from 'node:assert/strict';
import test from 'node:test';
import { auditIssueKey } from '../src/lib/domain/auditEngine.js';
import { buildNotificationDrafts } from '../src/lib/domain/notificationBuilder.js';
import type { AuditIssue, IssueAcknowledgment, IssueComment, IssueCorrection } from '../src/lib/domain/types.js';

function mk(patch: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: 'i1',
    projectNo: 'P-1',
    projectName: 'Alpha',
    sheetName: 'S',
    severity: 'High',
    projectManager: 'Wagner',
    projectState: 'Authorised',
    effort: 920,
    auditStatus: 'HIGH',
    notes: 'over',
    rowIndex: 2,
    email: 'w@x.com',
    ...patch,
  };
}

test('draft exposes unreviewedCount; acknowledged and corrected are not counted', () => {
  const i1 = mk({ id: 'i1', projectNo: 'P-1' });
  const i2 = mk({ id: 'i2', projectNo: 'P-2' });
  const i3 = mk({ id: 'i3', projectNo: 'P-3' });
  const acks: Record<string, IssueAcknowledgment> = {
    [auditIssueKey(i2)]: { issueKey: auditIssueKey(i2), processId: 'p', status: 'acknowledged', updatedAt: '' },
    [auditIssueKey(i3)]: { issueKey: auditIssueKey(i3), processId: 'p', status: 'corrected', updatedAt: '' },
  };
  const [draft] = buildNotificationDrafts({
    issues: [i1, i2, i3],
    theme: 'Company Reminder',
    deadline: '',
    acknowledgments: acks,
  });

  assert.equal(draft?.issueCount, 3);
  assert.equal(draft?.unreviewedCount, 1);
});

test('comments and corrections appear in draft HTML as escaped text', () => {
  const issue = mk({ projectName: 'Alpha <b>beta</b>', notes: 'over' });
  const key = auditIssueKey(issue);
  const corrections: Record<string, IssueCorrection> = {
    [key]: { issueKey: key, processId: 'p', effort: 800, note: 'Q3 cap', updatedAt: '' },
  };
  const comments: Record<string, IssueComment[]> = {
    [key]: [{ id: 'c1', issueKey: key, processId: 'p', author: 'me', body: 'PM confirmed', createdAt: '' }],
  };
  const [draft] = buildNotificationDrafts({
    issues: [issue],
    theme: 'Company Reminder',
    deadline: '',
    corrections,
    comments,
  });

  assert.ok(draft?.htmlBody.includes('&lt;b&gt;beta&lt;/b&gt;'));
  assert.ok(draft?.htmlBody.includes('800'));
  assert.ok(draft?.htmlBody.includes('Q3 cap'));
  assert.ok(draft?.htmlBody.includes('PM confirmed'));
});
