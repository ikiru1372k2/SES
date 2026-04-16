import type { AuditIssue, NotificationDraft } from './types';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const controlChars = /[\u0000-\u001f\u007f]+/g;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function sanitizeHeader(value: string): string {
  return value.split(/[\r\n]/)[0].replace(controlChars, ' ').replace(/\s+/g, ' ').trim();
}

export function isValidEmail(value: string | null | undefined): value is string {
  return Boolean(value && EMAIL_RE.test(sanitizeHeader(value)));
}

export function recipientKeyFor(name: string, email?: string | null): string {
  if (isValidEmail(email)) return sanitizeHeader(email).toLowerCase();
  const clean = sanitizeHeader(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `missing-email:${clean || 'unassigned'}`;
}

export function buildNotificationDrafts(
  issues: AuditIssue[],
  theme: NotificationDraft['theme'],
  deadline: string,
  template = {
    intro: 'Your effort workbook has flagged the projects below.',
    actionLine: 'Please review and update the workbook',
    closing: 'Thank you for closing these audit items.',
    signature1: 'Effort Audit Team',
    signature2: 'Workbook Auditor',
  },
): NotificationDraft[] {
  const byManager = new Map<string, AuditIssue[]>();
  issues.forEach((issue) => byManager.set(issue.projectManager, [...(byManager.get(issue.projectManager) ?? []), issue]));
  return [...byManager.entries()].map(([pmName, projects]) => {
    const email = projects.map((issue) => sanitizeHeader(issue.email ?? '')).find(isValidEmail) ?? null;
    const rows = projects
      .map((issue) => `<tr><td>${escapeHtml(issue.projectNo)}</td><td>${escapeHtml(issue.projectName)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.notes)}</td></tr>`)
      .join('');
    const htmlBody = `<p>Dear ${escapeHtml(pmName)},</p><p>${escapeHtml(template.intro)}</p><p>The following ${projects.length} project(s) require your attention:</p><table><tr><th>Project No</th><th>Project</th><th>Severity</th><th>Notes</th></tr>${rows}</table><p>${escapeHtml(template.actionLine)} by ${escapeHtml(deadline || 'the agreed deadline')}.</p><p>${escapeHtml(template.closing)}</p><p>${escapeHtml(template.signature1)}<br/>${escapeHtml(template.signature2)}</p>`;
    return {
      pmName,
      email,
      recipientKey: recipientKeyFor(pmName, email),
      hasValidRecipient: Boolean(email),
      issueCount: projects.length,
      projects,
      stage: projects.some((issue) => issue.severity === 'High') ? 'Escalation' : 'Reminder 1',
      theme,
      subject: `${theme}: ${projects.length} workbook audit item${projects.length === 1 ? '' : 's'}`,
      htmlBody,
    };
  });
}

export function notificationPlainText(draft: NotificationDraft): string {
  const rows = draft.projects.map((issue) => `- ${issue.projectNo} | ${issue.projectName} | ${issue.severity} | ${issue.reason ?? issue.notes}`).join('\n');
  return `Dear ${draft.pmName},\n\nThe following ${draft.issueCount} project(s) require your attention:\n\n${rows}\n\nPlease review and update the workbook by the agreed deadline.\n\nEffort Audit Team`;
}

export function openMailDraft(to: string[], subject: string, body: string): void {
  const recipients = to.map((recipient) => sanitizeHeader(recipient)).filter(isValidEmail);
  if (!recipients.length) return;
  const url = `mailto:${recipients.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(sanitizeHeader(subject))}&body=${encodeURIComponent(body.replace(controlChars, '\n'))}`;
  window.location.href = url;
}

export function openTeamsMessage(email: string, message: string): void {
  const recipient = sanitizeHeader(email);
  if (!isValidEmail(recipient)) return;
  window.open(`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(recipient)}&message=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

export function buildGeneralNotification(drafts: NotificationDraft[]): { recipients: string[]; subject: string; body: string } {
  const recipients = [...new Set(drafts.map((draft) => draft.email).filter(isValidEmail))];
  const managerSummary = drafts
    .map((draft) => `${draft.pmName} (${draft.email ?? 'missing email'}) - ${draft.issueCount} flagged project(s)`)
    .join('\n');
  const projects = drafts
    .flatMap((draft) => draft.projects.map((issue) => `- ${draft.pmName}: ${issue.projectNo} | ${issue.projectName} | ${issue.severity} | ${issue.reason ?? issue.notes}`))
    .join('\n');
  return {
    recipients,
    subject: `General QGC escalation summary: ${drafts.reduce((sum, draft) => sum + draft.issueCount, 0)} flagged project(s)`,
    body: `Dear Project Managers,\n\nThe latest QGC workbook audit identified items that require review.\n\nManagers included:\n${managerSummary}\n\nFlagged projects:\n${projects}\n\nPlease review your items and update the workbook/status before the next escalation review.\n\nEffort Audit Team`,
  };
}

export function downloadEml(draft: NotificationDraft): void {
  if (!draft.email) return;
  const eml = [`To: ${sanitizeHeader(draft.email)}`, `Subject: ${sanitizeHeader(draft.subject)}`, 'Content-Type: text/html; charset=utf-8', '', draft.htmlBody].join('\r\n');
  const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeHeader(draft.pmName).replace(/\W+/g, '-').toLowerCase()}-audit-draft.eml`;
  link.click();
  URL.revokeObjectURL(url);
}
