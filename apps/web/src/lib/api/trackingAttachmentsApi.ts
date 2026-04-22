import { parseApiError } from './client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface TrackingAttachmentMeta {
  id: string;
  displayCode: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  comment: string;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
}

export async function listAttachments(trackingIdOrCode: string): Promise<TrackingAttachmentMeta[]> {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/attachments`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to load attachments');
  const json = (await res.json()) as { attachments: TrackingAttachmentMeta[] };
  return json.attachments;
}

export async function uploadAttachment(
  trackingIdOrCode: string,
  file: File,
  comment: string,
): Promise<TrackingAttachmentMeta> {
  const form = new FormData();
  form.append('file', file);
  form.append('comment', comment);
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/attachments`,
    { method: 'POST', credentials: 'include', body: form },
  );
  if (!res.ok) throw await parseApiError(res, 'Upload failed');
  return (await res.json()) as TrackingAttachmentMeta;
}

export async function patchAttachmentComment(
  trackingIdOrCode: string,
  attIdOrCode: string,
  comment: string,
): Promise<TrackingAttachmentMeta> {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/attachments/${encodeURIComponent(attIdOrCode)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comment }),
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Update failed');
  return (await res.json()) as TrackingAttachmentMeta;
}

export async function deleteAttachment(
  trackingIdOrCode: string,
  attIdOrCode: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/attachments/${encodeURIComponent(attIdOrCode)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Delete failed');
  return (await res.json()) as { ok: boolean };
}

export function attachmentDownloadUrl(trackingIdOrCode: string, attIdOrCode: string): string {
  return `/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/attachments/${encodeURIComponent(attIdOrCode)}/download`;
}
