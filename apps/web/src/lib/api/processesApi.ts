import { normalizeAuditPolicy } from '../auditPolicy';
import type { AuditPolicy, AuditProcess } from '../types';
import { JSON_HEADERS, parseApiError } from './client';

export type ApiProcessSummary = {
  id: string;
  displayCode: string;
  rowVersion: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  nextAuditDue: string | null;
  archivedAt?: string | null;
  auditPolicy: unknown;
  policyVersion: number;
  filesCount?: number;
  versionsCount?: number;
  latestIssueCount?: number;
  latestRunAt?: string | null;
  latestAuditRunCode?: string | null;
};

export function mapApiProcessToClient(row: ApiProcessSummary): AuditProcess {
  return {
    id: row.id,
    displayCode: row.displayCode,
    serverBacked: true,
    rowVersion: row.rowVersion,
    ...(row.filesCount !== undefined ? { serverFilesCount: row.filesCount } : {}),
    ...(row.versionsCount !== undefined ? { serverVersionsCount: row.versionsCount } : {}),
    name: row.name,
    description: row.description ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    nextAuditDue: row.nextAuditDue ?? null,
    files: [],
    activeFileId: null,
    versions: [],
    auditPolicy: normalizeAuditPolicy((row.auditPolicy ?? {}) as Partial<AuditPolicy>),
    notificationTracking: {},
    comments: {},
    corrections: {},
    acknowledgments: {},
    savedTemplates: {},
  };
}

export async function fetchProcessesFromApi(): Promise<AuditProcess[] | null> {
  const res = await fetch('/api/v1/processes', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => mapApiProcessToClient(row as ApiProcessSummary));
}

export async function createProcessOnApi(name: string, description: string): Promise<AuditProcess> {
  const res = await fetch('/api/v1/processes', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: name.trim(), description: description.trim() }),
  });
  if (!res.ok) {
    throw await parseApiError(res, 'Create failed');
  }
  const row = (await res.json()) as ApiProcessSummary;
  return mapApiProcessToClient(row);
}

export async function deleteProcessOnApi(idOrCode: string): Promise<void> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(idOrCode)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw await parseApiError(res, 'Delete failed');
  }
}

export async function updateProcessOnApi(
  idOrCode: string,
  rowVersion: number,
  body: { name?: string; description?: string; nextAuditDue?: string | null },
): Promise<AuditProcess> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(idOrCode)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { ...JSON_HEADERS, 'If-Match': String(rowVersion) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseApiError(res, 'Update failed');
  }
  const row = (await res.json()) as ApiProcessSummary;
  return mapApiProcessToClient(row);
}
