import type { FunctionId } from '@ses/domain';
import { JSON_HEADERS, parseApiError } from './client';

export interface ApiTileStats {
  fileCount: number;
  lastUploadAt: string | null;
  hasDraft: boolean;
}

export type ApiTiles = Record<FunctionId, ApiTileStats>;

export async function fetchProcessTiles(processIdOrCode: string): Promise<ApiTiles> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/tiles`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load tiles');
  return (await res.json()) as ApiTiles;
}

export async function requestFunctionAudit(
  processIdOrCode: string,
  body: { proposedName: string; description?: string; contactEmail: string },
): Promise<{ displayCode: string }> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/function-audit-requests`,
    {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to submit request');
  return (await res.json()) as { displayCode: string };
}
