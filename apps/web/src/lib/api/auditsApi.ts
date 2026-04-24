import { JSON_HEADERS, parseApiError } from './client';

export interface MappingSourceInput {
  type: 'master_data_version' | 'uploaded_file' | 'none';
  masterDataVersionId?: string;
  uploadId?: string;
  allowUnresolvedFallback?: boolean;
}

export interface ApiAuditRunListItem {
  id: string;
  displayCode: string;
  completedAt: string | null;
  scannedRows: number;
  flaggedRows: number;
  file: { functionId: string; name: string; displayCode: string };
}

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
  /**
   * Deterministic hash of the run's issue set (Issue #74). Empty string for
   * legacy rows created before the column existed.
   */
  findingsHash?: string;
  summary: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  jobCode: string | null;
}

export async function runAuditOnApi(
  processIdOrCode: string,
  fileIdOrCode: string,
  options?: { mappingSource?: MappingSourceInput },
): Promise<ApiAuditRunSummary> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/audit/run`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fileIdOrCode, ...(options?.mappingSource ? { mappingSource: options.mappingSource } : {}) }),
  });
  if (!res.ok) throw await parseApiError(res, 'Audit run failed');
  return (await res.json()) as ApiAuditRunSummary;
}

export async function fetchAuditRunsForProcess(
  processIdOrCode: string,
  functionId?: string,
): Promise<ApiAuditRunListItem[]> {
  const params = functionId ? `?functionId=${encodeURIComponent(functionId)}` : '';
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/audit-runs${params}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Failed to load audit runs');
  return (await res.json()) as ApiAuditRunListItem[];
}

export async function fetchAuditIssues(runIdOrCode: string): Promise<ApiAuditRunIssue[]> {
  const res = await fetch(`/api/v1/audit-runs/${encodeURIComponent(runIdOrCode)}/issues`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load issues');
  return (await res.json()) as ApiAuditRunIssue[];
}

// Latest completed audit run for a file. Returns null when the server has
// no completed run yet (404), so callers can render the "No audit run yet"
// empty state without surfacing an error toast. Other failures still throw.
export async function fetchLatestAuditRunForFile(
  processIdOrCode: string,
  fileIdOrCode: string,
): Promise<ApiAuditRunSummary | null> {
  const res = await fetch(
    `/api/v1/processes/${encodeURIComponent(processIdOrCode)}/files/${encodeURIComponent(fileIdOrCode)}/audit-runs/latest`,
    { credentials: 'include' },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await parseApiError(res, 'Failed to load latest audit run');
  return (await res.json()) as ApiAuditRunSummary;
}