import type { DirectoryRowInput } from '@ses/domain';
import { JSON_HEADERS, parseApiError } from './client';

const base = '/api/v1/directory';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await parseApiError(res, 'Directory API');
  return (await res.json()) as T;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) },
  });
  return res;
}

export class DirectoryFieldError extends Error {
  readonly field: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, field: string | undefined) {
    super(message);
    this.name = 'DirectoryFieldError';
    this.status = status;
    this.field = field;
  }
}

async function parseDirectoryFieldError(res: Response): Promise<DirectoryFieldError> {
  const body = (await res.json().catch(() => ({}))) as { field?: string; message?: string };
  return new DirectoryFieldError(body.message ?? `Directory API (${res.status})`, res.status, body.field);
}

export type DirectoryEntry = {
  id: string;
  displayCode: string;
  firstName: string;
  lastName: string;
  email: string;
  normalizedKey: string;
  aliases: string[];
  active: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export async function directoryUploadPreview(rows: DirectoryRowInput[]) {
  return json<{ preview: unknown[]; counts: Record<string, number> }>('/upload', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export async function directoryCommit(rows: DirectoryRowInput[], strategy: 'skip_duplicates' | 'update_existing') {
  return json<{ created: string[]; updated: string[]; skipped: string[]; previewCounts: Record<string, number> }>(
    '/commit',
    { method: 'POST', body: JSON.stringify({ rows, strategy }) },
  );
}

export async function directoryResolve(body: {
  rawName: string;
  directoryEntryId?: string;
  inline?: DirectoryRowInput;
}) {
  return json<DirectoryEntry>('/resolve', { method: 'POST', body: JSON.stringify(body) });
}

export async function directoryResolveBatch(items: Array<{ rawName: string; directoryEntryId: string }>) {
  return json<{ results: Array<{ rawName: string; ok: boolean; error?: string }> }>('/resolve-batch', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function directorySuggestions(rawNames: string[]) {
  return json<{
    results: Record<
      string,
      {
        autoMatch: { id: string; email: string; score: number } | null;
        candidates: Array<{ id: string; email: string; score: number }>;
        collision: boolean;
      }
    >;
  }>('/suggestions', { method: 'POST', body: JSON.stringify({ rawNames }) });
}

export async function directoryList(params: { search?: string; filter?: 'active' | 'archived' | 'all'; limit?: number; offset?: number }) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.filter) q.set('filter', params.filter);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return json<{ items: DirectoryEntry[]; total: number; limit: number; offset: number }>(qs ? `?${qs}` : '');
}

export async function directoryCreateEntry(row: DirectoryRowInput) {
  return json<DirectoryEntry>('/entries', { method: 'POST', body: JSON.stringify(row) });
}

export async function directoryArchiveBulk(ids: string[]) {
  return json<{ archived: number }>('/archive-bulk', { method: 'POST', body: JSON.stringify({ ids }) });
}

export async function directoryMerge(sourceId: string, targetId: string) {
  return json<{ repointed: number; targetId: string }>('/merge', {
    method: 'POST',
    body: JSON.stringify({ sourceId, targetId }),
  });
}

export async function directoryMergeImpact(sourceId: string, targetId: string) {
  return json<{ trackingRowsToRepoint: number; source: DirectoryEntry; target: DirectoryEntry }>(
    `/merge-impact?sourceId=${encodeURIComponent(sourceId)}&targetId=${encodeURIComponent(targetId)}`,
  );
}

export async function directoryPatch(
  id: string,
  body: Partial<{ firstName: string; lastName: string; email: string; active: boolean; applyEmailChange: boolean }>,
) {
  return json<DirectoryEntry | { requiresConfirmation: true; trackingRowsToRepoint: number; entry: DirectoryEntry }>(
    `/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export type CreateManagerPayload = {
  code: string;
  name: string;
  email: string;
  active: boolean;
};

export async function createManager(payload: CreateManagerPayload, signal?: AbortSignal) {
  const init: RequestInit = { method: 'POST', body: JSON.stringify(payload) };
  if (signal) init.signal = signal;
  const res = await request('/managers', init);
  if (!res.ok) {
    if (res.status === 400 || res.status === 409) throw await parseDirectoryFieldError(res);
    throw await parseApiError(res, 'Directory API');
  }
  return (await res.json()) as DirectoryEntry;
}

export async function deleteManager(id: string, signal?: AbortSignal) {
  const init: RequestInit = { method: 'DELETE' };
  if (signal) init.signal = signal;
  const res = await request(`/managers/${encodeURIComponent(id)}`, init);
  if (res.status === 204 || res.status === 404) return { status: res.status as 204 | 404 };
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { status: 409 as const, message: body.message ?? 'Cannot delete manager.' };
  }
  throw await parseApiError(res, 'Directory API');
}
