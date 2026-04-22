import type { TrackingEntry } from './types';
import { emptyProjectStatuses } from './projectStatuses';

export type PipelineKey = 'notContacted' | 'notified' | 'escalated' | 'resolved';

export const PIPELINE_COLUMNS: Array<{ key: PipelineKey; title: string; accent: string }> = [
  { key: 'notContacted', title: 'Not contacted', accent: 'border-gray-400' },
  { key: 'notified', title: 'Notified', accent: 'border-blue-500' },
  { key: 'escalated', title: 'Escalated', accent: 'border-amber-500' },
  { key: 'resolved', title: 'Resolved', accent: 'border-green-600' },
];

export function trackingKey(processId: string, managerEmail: string): string {
  return `${processId}:${managerEmail}`;
}

export function pipelineKey(entry: TrackingEntry): PipelineKey {
  if (entry.resolved) return 'resolved';
  const legacy = entry.stage as string;
  if (legacy === 'Resolved') return 'resolved';
  if (legacy === 'Teams escalated') return 'escalated';
  if (legacy === 'Reminder 1 sent' || legacy === 'Reminder 2 sent') return 'notified';
  if (legacy === 'Not contacted') return 'notContacted';
  switch (entry.stage) {
    case 'RESOLVED':
      return 'resolved';
    case 'ESCALATED_L1':
    case 'ESCALATED_L2':
    case 'NO_RESPONSE':
      return 'escalated';
    case 'SENT':
    case 'AWAITING_RESPONSE':
    case 'RESPONDED':
      return 'notified';
    case 'NEW':
    case 'DRAFTED':
    default:
      break;
  }
  if (entry.teamsCount > 0 || entry.outlookCount >= 2) return 'escalated';
  if (entry.outlookCount > 0) return 'notified';
  return 'notContacted';
}

export function makeDefaultTrackingEntry(
  processId: string,
  managerName: string,
  managerEmail: string,
  flaggedProjectCount: number,
): TrackingEntry {
  return {
    key: trackingKey(processId, managerEmail),
    processId,
    managerName,
    managerEmail,
    flaggedProjectCount,
    outlookCount: 0,
    teamsCount: 0,
    lastContactAt: null,
    stage: 'NEW',
    escalationLevel: 0,
    resolved: false,
    history: [],
    projectStatuses: emptyProjectStatuses(),
  };
}
