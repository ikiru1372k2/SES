import { EscalationStage } from '../../../repositories/types';

export function isIndividualComposeSources(sources: unknown): boolean {
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => typeof source === 'string' && source.trim().length > 0 && source !== '__broadcast__');
}

export function stageKeyForEntry(stage: string, level: number): string {
  if (stage === EscalationStage.AWAITING_RESPONSE || stage === EscalationStage.NO_RESPONSE) return 'AWAITING_RESPONSE';
  if (stage === EscalationStage.ESCALATED_L2) return 'ESCALATED_L2';
  if (stage === EscalationStage.ESCALATED_L1) return 'ESCALATED_L1';
  if (level >= 2) return 'ESCALATED_L2';
  if (level >= 1) return 'ESCALATED_L1';
  return 'NEW';
}

export function firstName(full: string): string {
  const t = full.trim();
  if (!t) return '';
  return t.split(/\s+/)[0] ?? t;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SLOT_TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function substituteHtml(template: string, htmlSlots: Record<string, string>): string {
  let result = '';
  let lastIdx = 0;
  SLOT_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_TOKEN.exec(template)) !== null) {
    const literal = template.slice(lastIdx, match.index);
    result += escapeHtml(literal).replace(/\n/g, '<br>');
    const slotName = match[1] ?? '';
    result += htmlSlots[slotName] ?? '';
    lastIdx = match.index + match[0].length;
  }
  result += escapeHtml(template.slice(lastIdx)).replace(/\n/g, '<br>');
  return result;
}

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

export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Map a Compose "Due date" (a calendar day, no time) to the SLA instant:
 * the very end of that day, 23:59:59.999. UTC is used to stay consistent with
 * the UTC date helpers in Composer.tsx (addBusinessDays/toDateInputValue) and
 * formatDueDate above. Accepts a `yyyy-mm-dd` value or a full ISO string;
 * either way the result is end-of-day (UTC) of that calendar date. Returns
 * null when the input is missing or unparseable.
 */
export function endOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T23:59:59.999Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

export function wrapEmailHtml(innerHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.55;">${innerHtml}</div>`;
}
