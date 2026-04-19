const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export interface ApiFileSummary {
  id: string;
  displayCode: string;
  rowVersion: number;
  processId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  lastAuditedAt: string | null;
  sheets: Array<{
    id: string;
    displayCode: string;
    name: string;
    status: 'valid' | 'duplicate' | 'invalid';
    rowCount: number;
    isSelected: boolean;
    headerRowIndex: number | null;
    originalHeaders?: string[];
    normalizedHeaders?: string[];
  }>;
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}

export async function uploadFileToApi(
  processIdOrCode: string,
  file: File,
): Promise<ApiFileSummary> {
  const body = new FormData();
  body.append('file', file, file.name);
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/files`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  if (!res.ok) throw await parseError(res, 'Upload failed');
  return (await res.json()) as ApiFileSummary;
}

export async function listFilesOnApi(processIdOrCode: string): Promise<ApiFileSummary[]> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/files`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to load files');
  return (await res.json()) as ApiFileSummary[];
}

export async function deleteFileOnApi(fileIdOrCode: string): Promise<void> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to delete file');
}

export async function downloadFileFromApi(fileIdOrCode: string): Promise<Blob> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}/download`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to download file');
  return res.blob();
}
