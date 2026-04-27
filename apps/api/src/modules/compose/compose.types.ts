import type { EscalationSendChannel } from '../../outbound/outbound-delivery.service';

export type ComposeDraftPayload = {
  templateId?: string;
  subject: string;
  body: string;
  cc: string[];
  removedEngineIds?: string[];
  channel?: EscalationSendChannel;
  /** Auditor-only note persisted alongside the send. Not shown to the manager. */
  authorNote?: string;
  /** ISO-8601 date for the {dueDate} slot. */
  deadlineAt?: string | null;
  /** Map of projectNo → URL the auditor pasted in. Empty entries are ignored. */
  projectLinks?: Record<string, string>;
};
