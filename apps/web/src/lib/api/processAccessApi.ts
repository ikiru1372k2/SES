import { parseApiError } from './client';
import type { MemberScopeRow } from './membersApi';

export type ProcessPermission = 'viewer' | 'editor' | 'owner';

export interface EffectiveAccess {
  permission: ProcessPermission;
  scopes: MemberScopeRow[];
}

export async function getMyAccess(processIdOrCode: string): Promise<EffectiveAccess> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/me/access`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to load access');
  const json = (await res.json()) as { permission: ProcessPermission; scopes?: MemberScopeRow[] };
  return { permission: json.permission, scopes: json.scopes ?? [] };
}
