import type { FunctionId } from '@ses/domain';

export interface ApiTileStats {
  fileCount: number;
  lastUploadAt: string | null;
  hasDraft: boolean;
}

export type ApiTiles = Record<FunctionId, ApiTileStats>;

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}

export async function fetchProcessTiles(processIdOrCode: string): Promise<ApiTiles> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/tiles`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to load tiles');
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res, 'Failed to submit request');
  return (await res.json()) as { displayCode: string };
}
