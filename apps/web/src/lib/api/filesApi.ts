import type { FunctionId } from '@ses/domain';
import { parseApiError } from './client';

export interface ApiFileSummary {
  id: string;
  displayCode: string;
  rowVersion: number;
  processId: string;
  functionId: FunctionId;
  currentVersion?: number;
  state?: 'uploaded' | 'processing' | 'completed' | 'draft';
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

export interface ApiUploadResult extends ApiFileSummary {
  /** Echo of the client temp id, used to rekey the IDB cache (fixes #63 hydration bug). */
  clientTempId: string | null;
}

export async function uploadFileToApi(
  processIdOrCode: string,
  functionId: FunctionId,
  file: File,
  opts?: { clientTempId?: string },
): Promise<ApiUploadResult> {
  const body = new FormData();
  body.append('file', file, file.name);
  if (opts?.clientTempId) body.append('clientTempId', opts.clientTempId);
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/files`,
    {
      method: 'POST',
      credentials: 'include',
      body,
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Upload failed');
  return (await res.json()) as ApiUploadResult;
}

export async function listFilesOnApi(
  processIdOrCode: string,
  functionId?: FunctionId,
): Promise<ApiFileSummary[]> {
  const url = functionId
    ? `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/functions/${encodeURIComponent(functionId)}/files`
    : `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/files`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Failed to load files');
  return (await res.json()) as ApiFileSummary[];
}

export async function deleteFileOnApi(fileIdOrCode: string): Promise<void> {
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to delete file');
}

export async function downloadFileFromApi(fileIdOrCode: string, versionNumber?: number): Promise<Blob> {
  const suffix = versionNumber ? `?version=${encodeURIComponent(String(versionNumber))}` : '';
  const res = await fetch(`/api/v1/files/${encodeURIComponent(fileIdOrCode)}/download${suffix}`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to download file');
  return res.blob();
}

/**
 * Trigger a browser download from the Blob returned by `downloadFileFromApi`.
 * Kept client-side so the exact original filename is used (see #62 AC).
 */
export async function downloadFileToDisk(
  fileIdOrCode: string,
  suggestedName: string,
  versionNumber?: number,
): Promise<void> {
  const blob = await downloadFileFromApi(fileIdOrCode, versionNumber);
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
  } finally {
    // Defer revoke so the click handler can start the stream.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
