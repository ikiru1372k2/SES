import type { FileVersionMetadata } from '../types';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}

export async function listFileVersionsOnApi(fileIdOrCode: string): Promise<FileVersionMetadata[]> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}/versions`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to load file versions');
  return (await res.json()) as FileVersionMetadata[];
}

export async function createFileVersionOnApi(fileIdOrCode: string, note: string): Promise<FileVersionMetadata> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}/versions`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await parseError(res, 'Failed to save file version');
  return (await res.json()) as FileVersionMetadata;
}

export async function downloadFileVersionFromApi(fileIdOrCode: string, versionNumber: number): Promise<Blob> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}/versions/${versionNumber}/download`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to download file version');
  return res.blob();
}
