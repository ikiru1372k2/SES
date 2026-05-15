import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationDrafts, isValidEmail, notificationPlainText, openMailDraft } from '../src/notifications/notificationBuilder.js';
import type { AuditIssue } from '../src/core/types.js';

function issue(patch: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: 'issue-1',
    projectNo: '<P-1>',
    projectName: 'Project <script>alert(1)</script>',
    sheetName: 'Effort Data',
    severity: 'High',
    projectManager: 'Manager <img src=x onerror=alert(1)>',
    projectState: 'Authorised',
    effort: 950,
    auditStatus: 'HIGH EFFORT',
    notes: 'Needs <b>review</b>',
    rowIndex: 2,
    email: '',
    ...patch,
  };
}

test('notification HTML escapes workbook and template values', () => {
  const [draft] = buildNotificationDrafts({
    issues: [issue()],
    theme: 'Company Reminder',
    deadline: '<tomorrow>',
    template: {
      greeting: 'Dear',
      deadlineLine: 'by',
      intro: 'Intro <script>',
      actionLine: 'Act <now>',
      closing: 'Close & confirm',
      signature1: 'Team "A"',
      signature2: "Owner's Desk",
    },
  });
  assert.ok(draft);

  assert.ok(draft.htmlBody.includes('&lt;script&gt;'));
  assert.ok(draft.htmlBody.includes('&lt;b&gt;review&lt;/b&gt;'));
  assert.ok(draft.htmlBody.includes('&amp;'));
  assert.equal(draft.email, null);
  assert.equal(draft.hasValidRecipient, false);
  assert.match(draft.recipientKey, /^missing-email:/);
});

test('draft list exposes one recipient per valid workbook email', () => {
  const drafts = buildNotificationDrafts({
    issues: [
      issue({ id: 'valid', projectManager: 'Valid Manager', email: 'valid.manager@company.com' }),
      issue({ id: 'missing', projectManager: 'Missing Manager', email: '' }),
      issue({ id: 'invalid', projectManager: 'Invalid Manager', email: 'bad address' }),
    ],
    theme: 'Compact Update',
    deadline: '',
  });

  const recipients = [...new Set(drafts.map((draft) => draft.email).filter(isValidEmail))];

  assert.deepEqual(recipients, ['valid.manager@company.com']);
  assert.ok(drafts.some((draft) => draft.pmName.includes('Missing')));
});

test('mailto generation strips header controls, filters invalid recipients, and uses comma separators', () => {
  const fakeWindow = { location: { href: '' } };
  (globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;

  openMailDraft(['one@example.com', 'bad address', 'two@example.com'], 'Hello\r\nBcc: attacker@example.com', 'Line 1\r\nLine 2');

  assert.match(fakeWindow.location.href, /^mailto:one%40example\.com,two%40example\.com\?/);
  assert.ok(!decodeURIComponent(fakeWindow.location.href).includes('Bcc:'));
});

test('notification drafts include proposed corrections in escaped HTML and plain text', () => {
  const [draft] = buildNotificationDrafts({
    issues: [issue({
      projectNo: 'P-2',
      projectName: 'Corrected Project',
      projectManager: 'Valid Manager',
      email: 'valid.manager@company.com',
      effort: 920,
      sheetName: 'Effort',
      rowIndex: 5,
    })],
    theme: 'Company Reminder',
    deadline: '',
    corrections: {
      'P-2|Effort|5': {
        issueKey: 'P-2|Effort|5',
        processId: 'process-1',
        effort: 850,
        note: 'Capacity <cap>',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    },
  });

  assert.ok(draft);
  assert.equal(draft.pendingCorrectionCount, 1);
  assert.ok(draft.htmlBody.includes('Proposed Effort'));
  assert.ok(draft.htmlBody.includes('920h &rarr; <strong>850h</strong>'));
  assert.ok(draft.htmlBody.includes('Capacity &lt;cap&gt;'));
  assert.ok(notificationPlainText(draft).includes('proposed effort 920 -> 850'));
});
