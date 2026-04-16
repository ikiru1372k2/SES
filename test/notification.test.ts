import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneralNotification, buildNotificationDrafts, openMailDraft } from '../src/lib/notificationBuilder.js';
import type { AuditIssue } from '../src/lib/types.js';

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
  const [draft] = buildNotificationDrafts([issue()], 'Company Reminder', '<tomorrow>', {
    intro: 'Intro <script>',
    actionLine: 'Act <now>',
    closing: 'Close & confirm',
    signature1: 'Team "A"',
    signature2: "Owner's Desk",
  });
  assert.ok(draft);

  assert.ok(draft.htmlBody.includes('&lt;script&gt;'));
  assert.ok(draft.htmlBody.includes('&lt;b&gt;review&lt;/b&gt;'));
  assert.ok(draft.htmlBody.includes('&amp;'));
  assert.equal(draft.email, null);
  assert.equal(draft.hasValidRecipient, false);
  assert.match(draft.recipientKey, /^missing-email:/);
});

test('general notification only includes valid workbook emails', () => {
  const drafts = buildNotificationDrafts([
    issue({ id: 'valid', projectManager: 'Valid Manager', email: 'valid.manager@company.com' }),
    issue({ id: 'missing', projectManager: 'Missing Manager', email: '' }),
    issue({ id: 'invalid', projectManager: 'Invalid Manager', email: 'bad address' }),
  ], 'Compact Update', '');

  const general = buildGeneralNotification(drafts);

  assert.deepEqual(general.recipients, ['valid.manager@company.com']);
  assert.ok(general.body.includes('missing email'));
});

test('mailto generation strips header controls, filters invalid recipients, and uses comma separators', () => {
  const fakeWindow = { location: { href: '' } };
  (globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;

  openMailDraft(['one@example.com', 'bad address', 'two@example.com'], 'Hello\r\nBcc: attacker@example.com', 'Line 1\r\nLine 2');

  assert.match(fakeWindow.location.href, /^mailto:one%40example\.com,two%40example\.com\?/);
  assert.ok(!decodeURIComponent(fakeWindow.location.href).includes('Bcc:'));
});
