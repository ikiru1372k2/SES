import type { EscalationStage, ProjectStatusesV2, TrackingChannel, ProjectTrackingStage } from './primitives';

export interface TrackingEvent {
  channel: TrackingChannel;
  kind?: string | undefined;
  at: string;
  note: string;
  reason?: string | undefined;
  payload?: unknown;
}

export interface TrackingEntry {
  key: string;
  displayCode?: string | undefined;
  rowVersion?: number | undefined;
  processId: string;
  managerName: string;
  managerEmail: string;
  flaggedProjectCount: number;
  outlookCount: number;
  teamsCount: number;
  lastContactAt: string | null;
  stage: EscalationStage;
  escalationLevel?: number | undefined;
  resolved: boolean;
  history: TrackingEvent[];
  projectStatuses: ProjectStatusesV2;
}

export interface ProjectTrackingStatus {
  projectNo: string;
  stage: ProjectTrackingStage;
  feedback: string;
  history: TrackingEvent[];
  updatedAt: string;
}
