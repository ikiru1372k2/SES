export type { EscalationStage } from '../escalationStages';
export type {
  ProjectStatusesV2,
  EngineProjectStatus,
  EngineSubStatus,
  ProjectStatusesAggregate,
} from '../projectStatuses';

export type SheetStatus = 'valid' | 'duplicate' | 'invalid';
export type Severity = 'High' | 'Medium' | 'Low';
export type WorkspaceTab =
  | 'preview'
  | 'results'
  | 'notifications'
  | 'tracking'
  | 'versions'
  | 'analytics';
export type IssueCategory =
  | 'Overplanning'
  | 'Missing Planning'
  | 'Function Rate'
  | 'Internal Cost Rate'
  | 'Other'
  | 'Effort Threshold'
  | 'Missing Data'
  | 'Planning Risk'
  | 'Capacity Risk'
  | 'Data Quality'
  | 'Needs Review';
export type NotificationTheme =
  | 'Company Reminder'
  | 'Executive Summary'
  | 'Compact Update'
  | 'Formal'
  | 'Urgent'
  | 'Friendly Follow-up'
  | 'Escalation';
export type AcknowledgmentStatus = 'needs_review' | 'acknowledged' | 'corrected';
export type TrackingChannel =
  | 'outlook'
  | 'eml'
  | 'teams'
  | 'manual'
  | 'sendAll'
  | 'manager_response'
  | 'stage_transition';
export type ProjectTrackingStage = 'open' | 'acknowledged' | 'corrected' | 'resolved';
