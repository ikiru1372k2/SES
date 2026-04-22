import { JSON_HEADERS, parseApiError } from './client';

export interface ApiTrackingEntry {
  id: string;
  displayCode: string;
  rowVersion: number;
  processId: string;
  managerName: string;
  managerEmail: string;
  stage: string;
  resolved: boolean;
  outlookCount: number;
  teamsCount: number;
  lastContactAt: string | null;
  flaggedProjectCount: number;
  key: string;
  history: Array<{ channel: string; note: string; at: string }>;
  projectStatuses: Record<string, unknown>;
  updatedAt: string;
}

export async function upsertTrackingOnApi(
  processIdOrCode: string,
  body: {
    managerKey: string;
    managerName: string;
    managerEmail?: string;
    stage?: string;
    resolved?: boolean;
    projectStatuses?: Record<string, unknown>;
  },
): Promise<ApiTrackingEntry> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/tracking`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Tracking update failed');
  return (await res.json()) as ApiTrackingEntry;
}

export async function addTrackingEventOnApi(
  trackingIdOrCode: string,
  body: { channel: string; note?: string },
): Promise<ApiTrackingEntry> {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/events`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to log tracking event');
  return (await res.json()) as ApiTrackingEntry;
}
