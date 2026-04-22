import type { FunctionId } from '@ses/domain';
import type { FileDraftMetadata } from '../types';
import { JSON_HEADERS, parseApiError } from './client';

export async function getFileDraftOnApi(processIdOrCode: string, functionId: FunctionId): Promise<FileDraftMetadata> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/draft`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load draft');
  return (await res.json()) as FileDraftMetadata;
}

export async function saveFileDraftOnApi(
  processIdOrCode: string,
  functionId: FunctionId,
  file: File | Blob,
  fileName: string,
  opts?: { beacon?: boolean },
): Promise<FileDraftMetadata | { ok: true }> {
  const body = new FormData();
  body.append('file', file, fileName);
  const path = opts?.beacon ? 'draft/beacon' : 'draft';
  const url = `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/${path}`;
  if (opts?.beacon && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(url, body);
    return ok ? { ok: true } : Promise.reject(new Error('Could not queue draft save'));
  }
  const res = await fetch(url, {
    method: opts?.beacon ? 'POST' : 'PUT',
    credentials: 'include',
    body,
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to save draft');
  return (await res.json()) as FileDraftMetadata;
}

export async function promoteFileDraftOnApi(
  processIdOrCode: string,
  functionId: FunctionId,
  note: string,
): Promise<{ file: unknown; versionNumber: number }> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/draft/promote`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to promote draft');
  return (await res.json()) as { file: unknown; versionNumber: number };
}

export async function deleteFileDraftOnApi(processIdOrCode: string, functionId: FunctionId): Promise<void> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/draft`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to discard draft');
}
