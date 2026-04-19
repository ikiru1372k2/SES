/**
 * Mirror of the server's RealtimeEnvelope contract.
 *
 * We duplicate these types here rather than importing them from the API
 * package because the web app doesn't take a NestJS dependency. If this
 * duplication grows painful, move the types into @ses/domain.
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
  | 'activity.appended'
  | 'conflict.row_version';

export interface RealtimeActor {
  id: string;
  code: string;
  email: string;
  displayName: string;
}

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEventName;
  payload: T;
  requestId: string;
  processCode?: string;
  actor?: RealtimeActor | null;
  emittedAt: string;
}

export interface PresenceMember {
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

export interface PresenceSnapshotPayload {
  members: PresenceMember[];
}

export type PresenceJoinedPayload = PresenceMember;

export interface PresenceLeftPayload {
  userCode: string;
  socketId: string;
  memberCount?: number;
}
