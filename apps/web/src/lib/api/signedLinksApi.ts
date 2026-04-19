const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export interface ApiSignedLink {
  token: string;
  url: string;
  expiresAt: string;
  linkCode: string;
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
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
  if (!res.ok) throw await parseError(res, 'Failed to create signed link');
  return (await res.json()) as ApiSignedLink;
}
