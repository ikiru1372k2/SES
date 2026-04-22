import { JSON_HEADERS, parseApiError } from './client';
import type { ComposeDraftPayload } from './trackingComposeApi';

export async function bulkCompose(
  trackingIds: string[],
  payload?: Partial<ComposeDraftPayload>,
) {
  const res = await fetch('/api/v1/tracking/bulk/compose', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds, payload }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk compose failed');
  return (await res.json()) as {
    previews: Array<{
      trackingId: string;
      managerName: string;
      managerEmail: string | null;
      subject: string;
      body: string;
    }>;
  };
}

export async function bulkSend(
  trackingIds: string[],
  payload: ComposeDraftPayload & { sources: string[] },
) {
  const res = await fetch('/api/v1/tracking/bulk/send', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds, payload }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk send failed');
  return (await res.json()) as {
    progress: Array<Record<string, unknown>>;
    success: number;
    failed: number;
    total: number;
  };
}

export async function bulkResolve(trackingIds: string[]) {
  const res = await fetch('/api/v1/tracking/bulk/resolve', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk resolve failed');
  return (await res.json()) as { ok: boolean; count: number };
}

export type BulkActionOutcome = {
  ok: boolean;
  applied: number;
  skipped: Array<{ trackingId: string; reason: string }>;
  total: number;
};

export async function bulkAcknowledge(trackingIds: string[], note?: string): Promise<BulkActionOutcome> {
  const res = await fetch('/api/v1/tracking/bulk/acknowledge', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds, note }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk acknowledge failed');
  return (await res.json()) as BulkActionOutcome;
}

export async function bulkSnooze(
  trackingIds: string[],
  days: number,
  note?: string,
): Promise<{ ok: boolean; count: number; days: number }> {
  const res = await fetch('/api/v1/tracking/bulk/snooze', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds, days, note }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk snooze failed');
  return (await res.json()) as { ok: boolean; count: number; days: number };
}

export async function bulkReescalate(trackingIds: string[], note?: string): Promise<BulkActionOutcome> {
  const res = await fetch('/api/v1/tracking/bulk/reescalate', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ trackingIds, note }),
  });
  if (!res.ok) throw await parseApiError(res, 'Bulk reescalate failed');
  return (await res.json()) as BulkActionOutcome;
}
