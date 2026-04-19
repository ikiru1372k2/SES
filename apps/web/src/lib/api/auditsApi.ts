const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export interface ApiAuditRunIssue {
  id: string;
  displayCode: string;
  issueKey: string;
  ruleCode: string;
  projectNo: string | null;
  projectName: string | null;
  sheetName: string | null;
  projectManager: string | null;
  projectState: string | null;
  effort: number | null;
  severity: 'High' | 'Medium' | 'Low';
  reason: string | null;
  thresholdLabel: string | null;
  recommendedAction: string | null;
  email: string | null;
  rowIndex: number | null;
  rule?: { name: string; category: string; version: number };
}

export interface ApiAuditRunSummary {
  id: string;
  displayCode: string;
  processId: string;
  fileId: string;
  status: string;
  scannedRows: number;
  flaggedRows: number;
  summary: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  jobCode: string | null;
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}

export async function runAuditOnApi(
  processIdOrCode: string,
  fileIdOrCode: string,
): Promise<ApiAuditRunSummary> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/audit/run`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fileIdOrCode }),
  });
  if (!res.ok) throw await parseError(res, 'Audit run failed');
  return (await res.json()) as ApiAuditRunSummary;
}

export async function fetchAuditIssues(runIdOrCode: string): Promise<ApiAuditRunIssue[]> {
  const res = await fetch(`/api/v1/audit-runs/${encodeURIComponent(runIdOrCode)}/issues`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseError(res, 'Failed to load issues');
  return (await res.json()) as ApiAuditRunIssue[];
}
