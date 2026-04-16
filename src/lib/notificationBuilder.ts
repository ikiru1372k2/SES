import type { AuditIssue, NotificationDraft } from './types';

const nameToEmail = (name: string) => {
  const clean = name.toLowerCase().replace(/[^a-z\s.]/g, '').trim();
  const parts = clean.includes('.') ? clean.split('.') : clean.split(/\s+/);
  return `${parts.filter(Boolean).join('.')}@company.com`;
};

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
    const rows = projects
      .map((issue) => `<tr><td>${issue.projectNo}</td><td>${issue.projectName}</td><td>${issue.severity}</td><td>${issue.notes}</td></tr>`)
      .join('');
    const htmlBody = `<p>Dear ${pmName},</p><p>${template.intro}</p><p>The following ${projects.length} project(s) require your attention:</p><table><tr><th>Project No</th><th>Project</th><th>Severity</th><th>Notes</th></tr>${rows}</table><p>${template.actionLine} by ${deadline || 'the agreed deadline'}.</p><p>${template.closing}</p><p>${template.signature1}<br/>${template.signature2}</p>`;
    return {
      pmName,
      email: projects.find((issue) => issue.email)?.email || nameToEmail(pmName),
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
  const url = `mailto:${to.map(encodeURIComponent).join(';')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

export function openTeamsMessage(email: string, message: string): void {
  window.open(`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}&message=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

export function buildGeneralNotification(drafts: NotificationDraft[]): { recipients: string[]; subject: string; body: string } {
  const recipients = [...new Set(drafts.map((draft) => draft.email).filter(Boolean))];
  const managerSummary = drafts
    .map((draft) => `${draft.pmName} (${draft.email}) - ${draft.issueCount} flagged project(s)`)
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
  const eml = [`To: ${draft.email}`, `Subject: ${draft.subject}`, 'Content-Type: text/html; charset=utf-8', '', draft.htmlBody].join('\r\n');
  const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${draft.pmName.replace(/\W+/g, '-').toLowerCase()}-audit-draft.eml`;
  link.click();
  URL.revokeObjectURL(url);
}
