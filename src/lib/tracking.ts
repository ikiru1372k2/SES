import type { TrackingEntry } from './types';

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
    stage: 'Not contacted',
    resolved: false,
    history: [],
    projectStatuses: {},
  };
}
