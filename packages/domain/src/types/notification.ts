import type { NotificationTheme } from './primitives';
import type { AuditIssue, IssueComment, IssueCorrection, IssueAcknowledgment } from './issue';

export interface NotificationDraft {
  displayCode?: string | undefined;
  pmName: string;
  email: string | null;
  recipientKey: string;
  hasValidRecipient: boolean;
  issueCount: number;
  projects: AuditIssue[];
  corrections: Record<string, IssueCorrection>;
  comments: Record<string, IssueComment[]>;
  acknowledgments: Record<string, IssueAcknowledgment>;
  pendingCorrectionCount: number;
  unreviewedCount: number;
  stage: 'Reminder 1' | 'Reminder 2' | 'Escalation';
  theme: NotificationTheme;
  subject: string;
  htmlBody: string;
}

export interface NotificationComposeTemplate {
  greeting: string;
  intro: string;
  actionLine: string;
  deadlineLine: string;
  closing: string;
  signature1: string;
  signature2: string;
}

/** @deprecated Use `NotificationComposeTemplate`; alias kept for workspace imports. */
export type NotificationTemplate = NotificationComposeTemplate;

export interface SavedTemplate {
  displayCode?: string | undefined;
  name: string;
  theme: NotificationTheme;
  template: NotificationComposeTemplate;
}
