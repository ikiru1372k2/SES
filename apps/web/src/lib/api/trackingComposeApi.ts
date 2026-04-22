import { parseApiError } from './client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export type ComposeDraftPayload = {
  templateId?: string;
  subject: string;
  body: string;
  cc: string[];
  removedEngineIds?: string[];
  channel?: 'email' | 'teams' | 'both';
  /** Issue #75: auditor-only note captured with the handoff. */
  authorNote?: string;
  /** Issue #75: ISO-8601 date for the {{dueDate}} slot. */
  deadlineAt?: string | null;
};

/**
 * Issue #75: what the server returns after recording a send. The client
 * uses these to drive the mailto / Teams handoff — no extra preview call.
 */
export interface SendComposeResult {
  ok: boolean;
  notificationLogId: string;
  channel: 'email' | 'teams' | 'both';
  subject: string;
  body: string;
  to: string;
  cc: string[];
}

export async function fetchComposeStatus(trackingIdOrCode: string) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/compose-status`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load compose status');
  return (await res.json()) as { locked: boolean; lockedBy: string | null; lockedUntil: string | null };
}

export async function previewCompose(trackingIdOrCode: string, body: Partial<ComposeDraftPayload>) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/preview`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Preview failed');
  return (await res.json()) as { subject: string; body: string };
}

export async function saveComposeDraft(trackingIdOrCode: string, body: ComposeDraftPayload) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/compose`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Save draft failed');
  return (await res.json()) as { ok: boolean; stage: string; lockExpiresAt?: string };
}

export async function discardComposeDraft(trackingIdOrCode: string) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/compose/discard`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
  });
  if (!res.ok) throw await parseApiError(res, 'Discard failed');
  return (await res.json()) as { ok: boolean; stage: string };
}

export async function sendCompose(
  trackingIdOrCode: string,
  body: ComposeDraftPayload & { sources: string[] },
): Promise<SendComposeResult> {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/send`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Send failed');
  return (await res.json()) as SendComposeResult;
}

export async function forceReescalate(trackingIdOrCode: string) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/force-reescalate`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
  });
  if (!res.ok) throw await parseApiError(res, 'Force re-escalate failed');
  return (await res.json()) as { ok: boolean; stage: string };
}
