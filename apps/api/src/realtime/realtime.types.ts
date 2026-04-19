/**
 * Shared event types for the realtime gateway.
 *
 * These are the only event names the server is allowed to emit. Keeping them
 * centralised here means the client can import the same union type via
 * @ses/domain if needed, and we get a compile error if a service tries to
 * emit something undeclared.
 */

export type RealtimeEventName =
  | 'presence.joined'
  | 'presence.left'
  | 'presence.moved'
  | 'presence.snapshot'
  | 'file.uploaded'
  | 'file.deleted'
  | 'audit.started'
  | 'audit.progress'
  | 'audit.completed'
  | 'version.saved'
  | 'issue.comment.added'
  | 'issue.correction.saved'
  | 'issue.acknowledgment.saved'
  | 'tracking.updated'
  | 'tracking.event_added'
  | 'notification.sent'
  | 'signed_link.created'
  | 'activity.appended'
  | 'conflict.row_version';

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEventName;
  payload: T;
  requestId: string;
  processCode?: string;
  actor?: {
    id: string;
    code: string;
    email: string;
    displayName: string;
  } | null;
  emittedAt: string;
}

/** Payload shapes for each event, kept loose so services stay flexible. */
export interface PresenceInfo {
  userId: string;
  userCode: string;
  displayName: string;
  email: string;
  socketId: string;
  tab?: string;
  focusCode?: string;
  connectedAt: string;
  lastHeartbeat: string;
}

export interface FileUploadedPayload {
  fileCode: string;
  fileId: string;
  name: string;
  sizeBytes: number;
}

export interface AuditStartedPayload {
  runCode: string;
  runId: string;
  fileCode: string;
}

export interface AuditCompletedPayload {
  runCode: string;
  runId: string;
  flaggedRows: number;
  scannedRows: number;
}

export interface TrackingUpdatedPayload {
  trackingCode: string;
  trackingId: string;
  managerKey: string;
  stage: string;
  resolved: boolean;
}

export interface ActivityAppendedPayload {
  activityCode: string;
  entityType: string;
  entityCode?: string;
  action: string;
}

export interface ConflictPayload {
  entityType: string;
  entityCode: string;
  expected: number;
  current: number;
}

export interface SignedLinkCreatedPayload {
  linkCode: string;
  managerEmail: string;
  expiresAt: string;
}

export interface NotificationSentPayload {
  managerEmail: string;
  managerName: string | null;
  channel: string;
  subject: string;
  issueCount: number;
}
