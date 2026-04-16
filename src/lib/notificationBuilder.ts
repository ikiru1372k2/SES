import { auditIssueKey } from './auditEngine';
import type {
  AuditIssue,
  IssueAcknowledgment,
  IssueComment,
  IssueCorrection,
  NotificationDraft,
  NotificationTemplate,
  NotificationTheme,
} from './types';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
// eslint-disable-next-line no-control-regex
const controlChars = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function sanitizeHeader(value: string): string {
  return (value.split(/[\r\n]/)[0] ?? '').replace(controlChars, ' ').replace(/\s+/g, ' ').trim();
}

export function isValidEmail(value: string | null | undefined): value is string {
  return Boolean(value && EMAIL_RE.test(sanitizeHeader(value)));
}

export function managerKey(name: string, email?: string | null): string {
  if (isValidEmail(email)) return sanitizeHeader(email).toLowerCase();
  const clean = sanitizeHeader(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `missing-email:${clean || 'unassigned'}`;
}

/** @deprecated Use managerKey instead. Kept only for migration. */
export const recipientKeyFor = managerKey;

export function defaultTemplateForTheme(theme: NotificationTheme): Omit<NotificationTemplate, 'greeting' | 'deadlineLine'> {
  switch (theme) {
    case 'Executive Summary':
      return {
        intro: 'Executive summary of flagged items from the latest QGC workbook audit.',
        actionLine: 'Your review is requested',
        closing: 'Thank you for your continued attention to these items.',
        signature1: 'Effort Audit Team',
        signature2: 'QGC Governance',
      };
    case 'Compact Update':
      return {
        intro: 'Quick note about flagged items in the latest audit.',
        actionLine: 'Please update when you can',
        closing: 'Thanks.',
        signature1: 'Effort Audit Team',
        signature2: '',
      };
    case 'Formal':
      return {
        intro: 'Pursuant to the QGC audit, the projects listed below require your review.',
        actionLine: 'Kindly provide updates',
        closing: 'Regards,',
        signature1: 'Effort Audit Team',
        signature2: 'QGC Governance Office',
      };
    case 'Urgent':
      return {
        intro: 'Urgent: the items below exceeded overplanning thresholds and require immediate attention.',
        actionLine: 'Please respond within 48 hours',
        closing: 'Escalation may occur after the deadline.',
        signature1: 'Effort Audit Team',
        signature2: '',
      };
    case 'Friendly Follow-up':
      return {
        intro: 'Hope you are well! Wanted to follow up on a few items from the latest audit.',
        actionLine: 'Let me know if you have any questions',
        closing: 'Thanks again,',
        signature1: 'Effort Audit Team',
        signature2: '',
      };
    case 'Escalation':
      return {
        intro: 'This is a formal escalation notice for the flagged items below.',
        actionLine: 'Immediate resolution is requested',
        closing: 'Your prompt attention is required.',
        signature1: 'Effort Audit Team',
        signature2: 'QGC Governance',
      };
    case 'Company Reminder':
    default:
      return {
        intro: 'Your effort workbook has flagged the projects below.',
        actionLine: 'Please review and update the workbook',
        closing: 'Thank you for closing these audit items.',
        signature1: 'Effort Audit Team',
        signature2: 'Workbook Auditor',
      };
  }
}

export interface BuildNotificationDraftsOptions {
  issues: AuditIssue[];
  theme: NotificationTheme;
  deadline: string;
  template?: NotificationTemplate;
  corrections?: Record<string, IssueCorrection>;
  comments?: Record<string, IssueComment[]>;
  acknowledgments?: Record<string, IssueAcknowledgment>;
}

export function buildNotificationDrafts(options: BuildNotificationDraftsOptions): NotificationDraft[] {
  const {
    issues,
    theme,
    deadline,
    template: templateOverride,
    corrections = {},
    comments = {},
    acknowledgments = {},
  } = options;
  const template: NotificationTemplate = {
    greeting: 'Dear',
    deadlineLine: 'by',
    ...defaultTemplateForTheme(theme),
    ...templateOverride,
  };
  const byManager = new Map<string, AuditIssue[]>();
  issues.forEach((issue) => byManager.set(issue.projectManager, [...(byManager.get(issue.projectManager) ?? []), issue]));
  return [...byManager.entries()].map(([pmName, projects]) => {
    const email = projects.map((issue) => sanitizeHeader(issue.email ?? '')).find(isValidEmail) ?? null;
    const draftCorrections = Object.fromEntries(
      projects
        .map((issue) => [auditIssueKey(issue), corrections[auditIssueKey(issue)]])
        .filter((entry): entry is [string, IssueCorrection] => Boolean(entry[1])),
    );
    const draftComments = projects.reduce<Record<string, IssueComment[]>>((acc, issue) => {
      const issueComments = comments[auditIssueKey(issue)] ?? [];
      if (issueComments.length) acc[auditIssueKey(issue)] = issueComments;
      return acc;
    }, {});
    const draftAcknowledgments = Object.fromEntries(
      projects
        .map((issue) => [auditIssueKey(issue), acknowledgments[auditIssueKey(issue)]])
        .filter((entry): entry is [string, IssueAcknowledgment] => Boolean(entry[1])),
    );
    const projectsExpanded = projects.map((issue) => {
      const key = auditIssueKey(issue);
      return {
        issue,
        correction: corrections[key],
        comments: comments[key] ?? [],
        acknowledgment: acknowledgments[key],
      };
    });
    const unreviewedCount = projectsExpanded.filter(
      (item) => item.acknowledgment?.status !== 'acknowledged' && item.acknowledgment?.status !== 'corrected',
    ).length;
    const cellStyle = 'padding:8px 12px;border:1px solid #e5e7eb;vertical-align:top;font-size:12px;';
    const headerCellStyle =
      'padding:8px 12px;border:1px solid #d1d5db;background:#f3f4f6;font-weight:600;text-align:left;font-size:12px;';
    const rowsHtml = projectsExpanded
      .map(({ issue, correction, comments: issueComments, acknowledgment }, index) => {
        const rowBg = index % 2 === 0 ? 'background:#ffffff;' : 'background:#f9fafb;';
        const severityColor = issue.severity === 'High' ? '#dc2626' : issue.severity === 'Medium' ? '#d97706' : '#2563eb';
        const statusLabel = acknowledgment
          ? acknowledgment.status === 'corrected'
            ? 'Corrected'
            : acknowledgment.status === 'acknowledged'
              ? 'Acknowledged'
              : 'Needs review'
          : 'Needs review';
        const correctionCell = correction
          ? `${escapeHtml(String(issue.effort))}h &rarr; <strong>${escapeHtml(String(correction.effort ?? issue.effort))}h</strong>`
          : `${escapeHtml(String(issue.effort))}h`;
        return `<tr style="${rowBg}">
      <td style="${cellStyle}">${escapeHtml(issue.projectNo)}</td>
      <td style="${cellStyle}">${escapeHtml(issue.projectName)}</td>
      <td style="${cellStyle}"><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${severityColor};color:#ffffff;font-size:11px;font-weight:600;">${escapeHtml(issue.severity)}</span></td>
      <td style="${cellStyle}">${escapeHtml(issue.notes)}</td>
      <td style="${cellStyle}">${correctionCell}</td>
      <td style="${cellStyle}">${escapeHtml(correction?.note ?? '')}</td>
      <td style="${cellStyle}">${issueComments.map((c) => escapeHtml(c.body)).join('<br>')}</td>
      <td style="${cellStyle}">${escapeHtml(statusLabel)}</td>
    </tr>`;
      })
      .join('');
    const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:900px;">
<p>Dear ${escapeHtml(pmName)},</p>
<p>${escapeHtml(template.intro)}</p>
<p>The following <strong>${projects.length}</strong> project(s) require your attention:</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d1d5db;margin:12px 0;">
<thead>
<tr>
<th style="${headerCellStyle}">Project No</th>
<th style="${headerCellStyle}">Project</th>
<th style="${headerCellStyle}">Severity</th>
<th style="${headerCellStyle}">Notes</th>
<th style="${headerCellStyle}">Proposed Effort</th>
<th style="${headerCellStyle}">Correction Note</th>
<th style="${headerCellStyle}">Auditor Comments</th>
<th style="${headerCellStyle}">Status</th>
</tr>
</thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>${escapeHtml(template.actionLine)} by <strong>${escapeHtml(deadline || 'the agreed deadline')}</strong>.</p>
<p>${escapeHtml(template.closing)}</p>
<p style="margin-top:24px;color:#6b7280;">
${escapeHtml(template.signature1)}<br/>
${escapeHtml(template.signature2)}
</p>
</div>`;
    return {
      pmName,
      email,
      recipientKey: managerKey(pmName, email),
      hasValidRecipient: Boolean(email),
      issueCount: projects.length,
      projects,
      corrections: draftCorrections,
      comments: draftComments,
      acknowledgments: draftAcknowledgments,
      pendingCorrectionCount: projectsExpanded.filter((p) => p.correction).length,
      unreviewedCount,
      stage: projects.some((issue) => issue.severity === 'High') ? 'Escalation' : 'Reminder 1',
      theme,
      subject: `${theme}: ${projects.length} workbook audit item${projects.length === 1 ? '' : 's'}`,
      htmlBody,
    };
  });
}

export function notificationPlainText(draft: NotificationDraft): string {
  const rows = draft.projects.map((issue) => {
    const correction = draft.corrections[auditIssueKey(issue)];
    const correctionText = correction ? ` | proposed effort ${issue.effort} -> ${correction.effort ?? issue.effort}${correction.note ? ` (${correction.note})` : ''}` : '';
    return `- ${issue.projectNo} | ${issue.projectName} | ${issue.severity} | ${issue.reason ?? issue.notes}${correctionText}`;
  }).join('\n');
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
