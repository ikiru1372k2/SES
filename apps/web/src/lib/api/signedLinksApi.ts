import { JSON_HEADERS, parseApiError } from './client';

export interface ApiSignedLink {
  token: string;
  url: string;
  expiresAt: string;
  linkCode: string;
}

export async function createSignedLink(
  processCode: string,
  body: {
    managerEmail: string;
    managerName?: string;
    flaggedProjectCount?: number;
    expiresInDays?: number;
  },
): Promise<ApiSignedLink> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processCode)}/signed-links`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to create signed link');
  return (await res.json()) as ApiSignedLink;
}
