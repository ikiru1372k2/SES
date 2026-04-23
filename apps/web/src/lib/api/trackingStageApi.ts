import { parseApiError } from './client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface StageComment {
  id: string;
  displayCode: string;
  stage: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export async function fetchStageComments(
  trackingIdOrCode: string,
  stage?: string,
): Promise<StageComment[]> {
  const qs = stage ? `?stage=${encodeURIComponent(stage)}` : '';
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/stage-comments${qs}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to load stage comments');
  const json = (await res.json()) as { comments: StageComment[] };
  return json.comments;
}

export async function addStageComment(
  trackingIdOrCode: string,
  body: { stage: string; body: string },
): Promise<StageComment> {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/stage-comments`,
    {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to add comment');
  return (await res.json()) as StageComment;
}

export async function verifyTracking(trackingIdOrCode: string) {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/verify`,
    { method: 'POST', credentials: 'include', headers: JSON_HEADERS },
  );
  if (!res.ok) throw await parseApiError(res, 'Verify failed');
  return (await res.json()) as { ok: boolean; stage: string; verifiedAt: string };
}

export async function transitionTracking(
  trackingIdOrCode: string,
  body: { to: string; reason: string; sourceAction: string },
) {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/transition`,
    {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Stage update failed');
  return (await res.json()) as { stage: string; resolved: boolean };
}

export async function revertVerification(trackingIdOrCode: string) {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/verify`,
    { method: 'DELETE', credentials: 'include', headers: JSON_HEADERS },
  );
  if (!res.ok) throw await parseApiError(res, 'Revert verification failed');
  return (await res.json()) as { ok: boolean; stage: string };
}
