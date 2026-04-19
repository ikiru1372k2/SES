const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export interface ApiIssueComment {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ApiIssueCorrection {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  effort?: number;
  projectState?: string;
  projectManager?: string;
  note: string;
  updatedAt: string;
}

export interface ApiIssueAcknowledgment {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  status: string;
  updatedAt: string;
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}

export async function addIssueCommentOnApi(
  processIdOrCode: string,
  issueKey: string,
  body: string,
): Promise<ApiIssueComment> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/issues/${encodeURIComponent(issueKey)}/comments`,
    {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) throw await parseError(res, 'Failed to add comment');
  return (await res.json()) as ApiIssueComment;
}

export async function deleteIssueCommentOnApi(commentIdOrCode: string): Promise<void> {
  const res = await fetch(`/api/v1/comments/${encodeURIComponent(commentIdOrCode)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to delete comment');
}

export async function saveIssueCorrectionOnApi(
  processIdOrCode: string,
  issueKey: string,
  body: { effort?: number; projectState?: string; projectManager?: string; note: string },
): Promise<ApiIssueCorrection> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/issues/${encodeURIComponent(issueKey)}/correction`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res, 'Failed to save correction');
  return (await res.json()) as ApiIssueCorrection;
}

export async function clearIssueCorrectionOnApi(
  processIdOrCode: string,
  issueKey: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/issues/${encodeURIComponent(issueKey)}/correction`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  );
  if (!res.ok) throw await parseError(res, 'Failed to clear correction');
}

export async function saveIssueAcknowledgmentOnApi(
  processIdOrCode: string,
  issueKey: string,
  body: { status: string },
): Promise<ApiIssueAcknowledgment> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/issues/${encodeURIComponent(issueKey)}/acknowledgment`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res, 'Failed to save acknowledgment');
  return (await res.json()) as ApiIssueAcknowledgment;
}
