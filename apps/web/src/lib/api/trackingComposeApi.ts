import { parseApiError } from './client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export type ComposeDraftPayload = {
  templateId?: string;
  subject: string;
  body: string;
  cc: string[];
  removedEngineIds?: string[];
  channel?: 'email' | 'teams' | 'both';
};

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

export async function sendCompose(trackingIdOrCode: string, body: ComposeDraftPayload & { sources: string[] }) {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/send`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Send failed');
  return (await res.json()) as { ok: boolean; notificationLogId: string };
}
