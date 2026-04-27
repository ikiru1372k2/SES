import { substitute } from '@ses/domain';

export const DEFAULT_SUBJECT_TEMPLATE =
  'Action Required — {processName}: Open Findings ({findingsCount})';

export const DEFAULT_BODY_TEMPLATE = [
  'Hi {managerFirstName},',
  '',
  'I hope you are doing well.',
  '',
  'We are members of the Quality Governance Team writing regarding open findings on {processName}. During our quality checks, we observed the following items that need your attention. Could you please review and do the needful at the earliest?',
  '',
  '{findingsByEngine}',
  '',
  'Kindly respond by {dueDate}. If you have any questions, please reach out.',
  '',
  'Thank you,',
  'Quality Governance Team',
  '{auditRunDate} — {auditorName}',
].join('\n');

export const SLOT_TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML-aware substitution: literal text is escaped + \n→<br>, slot values inserted verbatim. */
export function substituteHtml(template: string, htmlSlots: Record<string, string>): string {
  let result = '';
  let lastIdx = 0;
  SLOT_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_TOKEN.exec(template)) !== null) {
    const literal = template.slice(lastIdx, match.index);
    result += escapeHtml(literal).replace(/\n/g, '<br>');
    const slotName = match[1] ?? '';
    const value = htmlSlots[slotName];
    result += value ?? '';
    lastIdx = match.index + match[0].length;
  }
  result += escapeHtml(template.slice(lastIdx)).replace(/\n/g, '<br>');
  return result;
}

export function wrapEmailHtml(innerHtml: string): string {
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.55;">` +
    innerHtml +
    `</div>`
  );
}

export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function firstName(full: string): string {
  const t = full.trim();
  if (!t) return '';
  return t.split(/\s+/)[0] ?? t;
}

export function stageKeyForLevel(level: number): string {
  if (level >= 2) return 'ESCALATED_L2';
  if (level >= 1) return 'ESCALATED_L1';
  return 'NEW';
}

export function buildSubjectAndBody(
  baseSubject: string,
  baseBody: string,
  textSlots: Record<string, string>,
  htmlSlots: Record<string, string>,
): { subject: string; text: string; html: string } {
  return {
    subject: substitute(baseSubject, textSlots),
    text: substitute(baseBody, textSlots),
    html: wrapEmailHtml(substituteHtml(baseBody, htmlSlots)),
  };
}
