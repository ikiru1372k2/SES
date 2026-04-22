import { DEFAULT_FUNCTION_ID, type FunctionId } from '@ses/domain';

/**
 * When true (default), primary URLs use `/processes/...` (tile dashboard + function workspace).
 * Set `VITE_FEATURE_TILES_DASHBOARD=false` to use `/workspace/...` as the canonical client routes
 * and keep `/processes/...` as redirects for bookmarks.
 */
export function isTilesDashboardEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_TILES_DASHBOARD !== 'false';
}

export function processDashboardPath(processIdOrCode: string): string {
  const id = encodeURIComponent(processIdOrCode);
  return isTilesDashboardEnabled() ? `/processes/${id}` : `/workspace/${id}`;
}

export function workspacePath(processIdOrCode: string, functionId: FunctionId): string {
  const pid = encodeURIComponent(processIdOrCode);
  const fid = encodeURIComponent(functionId);
  return isTilesDashboardEnabled() ? `/processes/${pid}/${fid}` : `/workspace/${pid}/${fid}`;
}

export function versionComparePath(processIdOrCode: string, functionId: FunctionId): string {
  const pid = encodeURIComponent(processIdOrCode);
  const fid = encodeURIComponent(functionId);
  return isTilesDashboardEnabled()
    ? `/processes/${pid}/${fid}/compare`
    : `/workspace/${pid}/${fid}/compare`;
}

export function defaultWorkspacePath(processIdOrCode: string): string {
  return workspacePath(processIdOrCode, DEFAULT_FUNCTION_ID);
}

export function escalationCenterPath(processIdOrCode: string, search?: URLSearchParams | Record<string, string>): string {
  const pid = encodeURIComponent(processIdOrCode);
  const base = isTilesDashboardEnabled() ? `/processes/${pid}/escalations` : `/workspace/${pid}/escalations`;
  if (!search) return base;
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
