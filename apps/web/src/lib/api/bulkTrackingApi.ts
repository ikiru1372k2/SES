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

export type BroadcastInput = {
  processIdOrCode: string;
  payload: ComposeDraftPayload & { sources: string[] };
  filter?: { functionId?: string; includeResolved?: boolean };
};

/**
 * One entry per manager the broadcast fanned out to. Successful sends carry
 * the resolved subject / body / cc / channel so the client can hand them off
 * to the user's own Outlook / Teams app (Issue #75 handoff model). Skipped
 * and failed rows carry a reason for the post-send summary instead.
 */
export type BroadcastRecipient =
  | {
      trackingId: string;
      managerName: string;
      managerEmail: string;
      state: 'sent';
      channel: 'email' | 'teams' | 'both';
      subject: string;
      body: string;
      cc: string[];
    }
  | {
      trackingId: string;
      managerName: string;
      managerEmail: string | null;
      state: 'skipped' | 'failed';
      reason: string;
    };

export type BroadcastOutcome = {
  progress: Array<Record<string, unknown>>;
  recipients: BroadcastRecipient[];
  success: number;
  failed: number;
  skipped: number;
  total: number;
  audience: number;
};

export async function broadcastNotification(input: BroadcastInput): Promise<BroadcastOutcome> {
  const res = await fetch('/api/v1/tracking/bulk/broadcast', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseApiError(res, 'Broadcast failed');
  return (await res.json()) as BroadcastOutcome;
}
