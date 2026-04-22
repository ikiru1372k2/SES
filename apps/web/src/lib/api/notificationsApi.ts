import { JSON_HEADERS, parseApiError } from './client';

export interface ApiNotificationLog {
  id: string;
  displayCode: string;
  processId: string;
  actorUserId: string;
  managerEmail: string;
  managerName: string | null;
  channel: string;
  subject: string;
  bodyPreview: string;
  severity: string | null;
  issueCount: number;
  sentAt: string;
}

export async function recordSendOnApi(
  processCode: string,
  body: {
    managerEmail: string;
    managerName?: string;
    channel: 'outlook' | 'teams' | 'eml';
    subject: string;
    bodyPreview: string;
    issueCount: number;
    severity?: 'High' | 'Medium' | 'Low';
  },
): Promise<ApiNotificationLog> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processCode)}/notifications/sent`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to record notification send');
  return (await res.json()) as ApiNotificationLog;
}

export async function fetchNotificationLog(
  processCode: string,
  opts?: { managerEmail?: string; limit?: number },
): Promise<ApiNotificationLog[]> {
  const params = new URLSearchParams();
  if (opts?.managerEmail) params.set('managerEmail', opts.managerEmail);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processCode)}/notifications${qs}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to fetch notification log');
  return (await res.json()) as ApiNotificationLog[];
}
