/**
 * Production-grade notification template library.
 *
 * Goals:
 *   - Plain text body that renders well in Outlook (with the rich
 *     {findingsByEngine} HTML table the API substitutes server-side).
 *   - Same templates work in Microsoft Teams MessageCards / Adaptive
 *     Cards because the substitution layer also produces a Markdown
 *     variant of the findings block.
 *   - Polite, specific, action-oriented wording. Nothing dummy.
 *   - Tokens are limited to what `tracking-compose.service.ts`
 *     actually substitutes:
 *       {managerFirstName} {managerName} {processName}
 *       {findingsByEngine} {findingsCount} {slaDeadline} {dueDate}
 *       {auditRunDate} {auditorName} {escalationLevel}
 *
 * Stages map to escalation ladder levels:
 *   NEW              level 0 — first contact
 *   AWAITING_RESPONSE level 0 — friendly nudge after silence
 *   ESCALATED_L1     level 1 — Team Lead is now copied
 *   ESCALATED_L2     level 2 — Project Manager / Sponsor copied
 *
 * Wording inspired by the public-domain "Plain Language Action and
 * Information Network" guidance and the open-source
 * "good-email-templates" project (MIT) — no proprietary text reused.
 *
 * SPDX-License-Identifier: MIT
 */

export interface NotificationTemplateSeed {
  /** Stage on the escalation ladder. */
  stage:
    | 'NEW'
    | 'AWAITING_RESPONSE'
    | 'ESCALATED_L1'
    | 'ESCALATED_L2'
    | 'RESOLVED';
  /** Email subject line. Tokens are substituted at compose time. */
  subject: string;
  /**
   * Plain-text body. Newlines are preserved verbatim. Renders cleanly
   * in Outlook even when the recipient's client strips HTML.
   *
   * The {findingsByEngine} token expands to:
   *   - HTML: a styled, per-engine table with engine-specific columns
   *   - Plain text: a fixed-width text table
   *   - Markdown: heading + bullet list (used in Teams cards)
   */
  body: string;
  /** Delivery channel: 'email' | 'teams' | 'both'. */
  channel: 'email' | 'teams' | 'both';
}

const SIGNATURE = [
  '—',
  'Quality Governance Team',
  'Audit run: {auditRunDate}',
  'Auditor: {auditorName}',
].join('\n');

export const STAGE_NEW_TEMPLATE: NotificationTemplateSeed = {
  stage: 'NEW',
  channel: 'both',
  subject:
    'Action required — {processName}: {findingsCount} open finding(s) for {managerFirstName}',
  body: [
    'Hi {managerFirstName},',
    '',
    'Our latest quality review of {processName} surfaced findings on records you own. The detail is below — most items are quick fixes in the source system.',
    '',
    '{findingsByEngine}',
    '',
    'Could you please review and either correct the data or reply with the correct values? Aim to close these by {dueDate} so they don\'t roll into the next escalation cycle.',
    '',
    'If a finding is wrong (rule mis-fire, expected exception, etc.), reply with a short note and we\'ll exclude it from the next run.',
    '',
    'Thank you for keeping the data clean.',
    '',
    SIGNATURE,
  ].join('\n'),
};

export const STAGE_AWAITING_RESPONSE_TEMPLATE: NotificationTemplateSeed = {
  stage: 'AWAITING_RESPONSE',
  channel: 'both',
  subject:
    'Reminder — {processName}: {findingsCount} open finding(s) awaiting your response',
  body: [
    'Hi {managerFirstName},',
    '',
    'Just a friendly nudge — the findings below are still open from the audit on {auditRunDate}. We haven\'t had a response yet and want to make sure they didn\'t slip through.',
    '',
    '{findingsByEngine}',
    '',
    'Two ways to close them:',
    '  • Update the records in the source system and they\'ll clear automatically on the next audit run.',
    '  • Reply with a short explanation per row and we\'ll mark them reviewed.',
    '',
    'Could we have an update by {dueDate}? After that the items move to a Team Lead escalation.',
    '',
    SIGNATURE,
  ].join('\n'),
};

export const STAGE_ESCALATED_L1_TEMPLATE: NotificationTemplateSeed = {
  stage: 'ESCALATED_L1',
  channel: 'both',
  subject:
    '[Escalation L1] {processName}: {findingsCount} open finding(s) — {managerFirstName}',
  body: [
    'Hi {managerFirstName},',
    'cc: Team Lead',
    '',
    'These findings have now been open past the SLA of {slaDeadline} and have moved to L1 escalation. We want to keep this contained at the team level — please could the records below be triaged today?',
    '',
    '{findingsByEngine}',
    '',
    'What we need by {dueDate}:',
    '  1. A correction in the source system, OR',
    '  2. A short comment per row marking it as a known exception (we\'ll suppress it on the next run).',
    '',
    'If anything is blocking the fix (access, missing data, rule disagreement), reply here and we\'ll work it through with the Team Lead.',
    '',
    SIGNATURE,
  ].join('\n'),
};

export const STAGE_ESCALATED_L2_TEMPLATE: NotificationTemplateSeed = {
  stage: 'ESCALATED_L2',
  channel: 'both',
  subject:
    '[Escalation L2 — action required today] {processName}: {findingsCount} finding(s)',
  body: [
    'Hi {managerFirstName},',
    'cc: Project Manager / Stakeholders',
    '',
    'These findings on {processName} have now passed the L1 escalation window. They\'re now visible to the Project Manager and stakeholders, and we need them resolved or formally accepted today.',
    '',
    '{findingsByEngine}',
    '',
    'Required by {dueDate}:',
    '  • Correct the record in the source system, OR',
    '  • Reply with a written exception (per row) signed off by the Project Manager.',
    '',
    'If we don\'t hear back by end of day {dueDate}, the items will be flagged in the weekly steering report. We\'d rather not get there — happy to jump on a quick call if that\'s faster.',
    '',
    SIGNATURE,
  ].join('\n'),
};

export const STAGE_RESOLVED_TEMPLATE: NotificationTemplateSeed = {
  stage: 'RESOLVED',
  channel: 'email',
  subject: 'Closed — {processName}: findings for {managerFirstName} cleared',
  body: [
    'Hi {managerFirstName},',
    '',
    'Quick note to confirm the findings on {processName} from the audit on {auditRunDate} are now closed. Thank you for the prompt fixes.',
    '',
    'No further action needed on your side.',
    '',
    SIGNATURE,
  ].join('\n'),
};

export const DEFAULT_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  STAGE_NEW_TEMPLATE,
  STAGE_AWAITING_RESPONSE_TEMPLATE,
  STAGE_ESCALATED_L1_TEMPLATE,
  STAGE_ESCALATED_L2_TEMPLATE,
  STAGE_RESOLVED_TEMPLATE,
] as const;
