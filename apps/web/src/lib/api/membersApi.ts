import { JSON_HEADERS, parseApiError } from './client';

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
}

export async function listMembers(processIdOrCode: string): Promise<ProcessMemberRow[]> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load members');
  return (await res.json()) as ProcessMemberRow[];
}

export async function addMember(
  processIdOrCode: string,
  body: { email?: string; userCode?: string; permission?: 'viewer' | 'editor' | 'owner' },
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

export async function removeMember(processIdOrCode: string, memberIdOrCode: string): Promise<void> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/members/${encodeURIComponent(memberIdOrCode)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to remove member');
}
