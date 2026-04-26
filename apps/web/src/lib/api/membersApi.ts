import { JSON_HEADERS, parseApiError } from './client';

export type ScopeAccessLevel = 'viewer' | 'editor';
export type ScopeType = 'all-functions' | 'function' | 'escalation-center';
export type AccessMode = 'unrestricted' | 'scoped';

export interface MemberScopeRow {
  scopeType: ScopeType;
  functionId: string | null;
  accessLevel: ScopeAccessLevel;
}

export interface ProcessMemberRow {
  id: string;
  displayCode: string;
  userId: string;
  userCode: string;
  email: string;
  displayName: string;
  globalRole: string;
  permission: 'viewer' | 'editor' | 'owner';
  addedAt: string;
  scopes: MemberScopeRow[];
}

export interface AddMemberInput {
  email?: string;
  userCode?: string;
  permission?: 'viewer' | 'editor' | 'owner';
  accessMode?: AccessMode;
  scopes?: MemberScopeRow[];
}

export interface UpdateMemberInput {
  permission?: 'viewer' | 'editor' | 'owner';
  accessMode?: AccessMode;
  scopes?: MemberScopeRow[];
}

export async function listMembers(processIdOrCode: string): Promise<ProcessMemberRow[]> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load members');
  const rows = (await res.json()) as Array<Omit<ProcessMemberRow, 'scopes'> & { scopes?: MemberScopeRow[] }>;
  return rows.map((row) => ({ ...row, scopes: row.scopes ?? [] }));
}

export async function addMember(
  processIdOrCode: string,
  body: AddMemberInput,
): Promise<{ id: string; displayCode: string; changed: boolean }> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to add member');
  return (await res.json()) as { id: string; displayCode: string; changed: boolean };
}

export async function updateMember(
  processIdOrCode: string,
  memberIdOrCode: string,
  body: UpdateMemberInput,
): Promise<{ id: string; displayCode: string; changed: boolean }> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members/${encodeURIComponent(memberIdOrCode)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to update member');
  return (await res.json()) as { id: string; displayCode: string; changed: boolean };
}

export async function removeMember(processIdOrCode: string, memberIdOrCode: string): Promise<void> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members/${encodeURIComponent(memberIdOrCode)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to remove member');
}
