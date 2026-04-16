import type { AuditProcess, TrackingEntry } from './types';
import { getWorkbookRawData } from './blobStore';
import { detectWorkbookSheets } from './excelParser';
import { createId } from './id';
import { normalizeAuditPolicy } from './auditPolicy';

export const DATA_KEY = 'effort-auditor-data';
export const UI_KEY = 'effort-auditor-ui';

export function loadProcesses(): AuditProcess[] {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const processes = parsed.processes ?? parsed.state?.processes ?? [];
    return sanitizeProcesses(processes);
  } catch {
    return [];
  }
}

export function saveProcesses(processes: AuditProcess[]): void {
  localStorage.setItem(DATA_KEY, JSON.stringify({ processes: stripRawDataFromProcesses(processes), version: 1 }));
}

export async function loadProcessesFromLocalDb(): Promise<AuditProcess[]> {
  try {
    const response = await fetch('/api/local-db', { cache: 'no-store' });
    if (!response.ok) return loadProcesses();
    const parsed = await response.json();
    const processes = parsed.processes ?? [];
    return hydrateWorkbookRawData(sanitizeProcesses(processes));
  } catch {
    return hydrateWorkbookRawData(loadProcesses());
  }
}

export async function saveProcessesToLocalDb(processes: AuditProcess[]): Promise<void> {
  saveProcesses(processes);
  try {
    await fetch('/api/local-db', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processes: stripRawDataFromProcesses(processes), version: 1 }),
    });
  } catch {
    // Browser storage remains the fallback when the local file API is unavailable.
  }
}

export function displayName(name: string): string {
  return name.replaceAll('_', ' ');
}

export function sanitizeProcesses(value: unknown): AuditProcess[] {
  return Array.isArray(value) ? value.map(sanitizeProcess).filter(Boolean) as AuditProcess[] : [];
}

export async function hydrateWorkbookRawData(processes: AuditProcess[]): Promise<AuditProcess[]> {
  return Promise.all(processes.map(async (process) => ({
    ...process,
    files: await Promise.all(process.files.map(async (file) => ({
      ...file,
      rawData: Object.keys(file.rawData).length ? file.rawData : await getWorkbookRawData(file.id) ?? {},
    }))),
  })));
}

function stripRawDataFromProcesses(processes: AuditProcess[]): AuditProcess[] {
  return processes.map((process) => ({
    ...process,
    files: process.files.map((file) => ({ ...file, rawData: {} })),
  }));
}

export function rememberActiveProcess(id: string | null): void {
  localStorage.setItem(UI_KEY, JSON.stringify({ lastActiveProcessId: id }));
}

export function loadActiveProcessId(): string | null {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || '{}').lastActiveProcessId ?? null;
  } catch {
    return null;
  }
}

function sanitizeProcess(value: unknown): AuditProcess | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<AuditProcess>;
  const now = new Date().toISOString();
  if (!item.id || !item.name) return null;
  const processId = String(item.id);
  const versions = Array.isArray(item.versions)
    ? item.versions.filter((version) => version?.result).map((version, index) => {
        const versionNumber = Number(version.versionNumber ?? ((item.versions?.length ?? 0) - index)) || index + 1;
        const versionId = String(version.versionId ?? version.id ?? `${processId}-v${versionNumber}`);
        const auditPolicy = version.auditPolicy ? normalizeAuditPolicy(version.auditPolicy) : version.result.policySnapshot ? normalizeAuditPolicy(version.result.policySnapshot) : undefined;
        const policySnapshot = version.result.policySnapshot ? normalizeAuditPolicy(version.result.policySnapshot) : version.auditPolicy ? normalizeAuditPolicy(version.auditPolicy) : undefined;
        return {
          ...version,
          id: versionId,
          versionId,
          versionNumber,
          versionName: String(version.versionName ?? version.label ?? `Version ${versionNumber}`),
          notes: String(version.notes ?? ''),
          ...(auditPolicy ? { auditPolicy } : {}),
          result: {
            ...version.result,
            ...(policySnapshot ? { policySnapshot } : {}),
          },
        };
      })
    : [];
  const tracking = sanitizeTracking(item.notificationTracking, processId);

  const latestPolicySnapshot = item.latestAuditResult?.policySnapshot ? normalizeAuditPolicy(item.latestAuditResult.policySnapshot) : undefined;
  const latestAuditResult = item.latestAuditResult ? {
    ...item.latestAuditResult,
    ...(latestPolicySnapshot ? { policySnapshot: latestPolicySnapshot } : {}),
  } : versions[0]?.result;

  return {
    id: processId,
    name: String(item.name),
    description: String(item.description ?? ''),
    createdAt: String(item.createdAt ?? now),
    updatedAt: String(item.updatedAt ?? item.createdAt ?? now),
    nextAuditDue: item.nextAuditDue ? String(item.nextAuditDue) : null,
    files: Array.isArray(item.files)
      ? item.files.map((file) => {
          const rawData = file.rawData && typeof file.rawData === 'object' ? file.rawData as Record<string, unknown[][]> : {};
          const redetectedSheets = Object.keys(rawData).length ? detectWorkbookSheets(rawData) : [];
          const previousSelection = new Map((Array.isArray(file.sheets) ? file.sheets : []).map((sheet) => [sheet.name, sheet.isSelected]));
          return {
            ...file,
            id: String(file.id ?? createId()),
            name: String(file.name ?? 'Workbook.xlsx'),
            uploadedAt: String(file.uploadedAt ?? now),
            lastAuditedAt: file.lastAuditedAt ? String(file.lastAuditedAt) : null,
            isAudited: Boolean(file.isAudited),
            sheets: redetectedSheets.map((sheet) => ({ ...sheet, isSelected: sheet.status === 'valid' ? previousSelection.get(sheet.name) ?? true : false })),
            rawData,
          };
        })
      : [],
    activeFileId: item.activeFileId ? String(item.activeFileId) : null,
    versions,
    ...(latestAuditResult ? { latestAuditResult } : {}),
    auditPolicy: normalizeAuditPolicy(item.auditPolicy),
    notificationTracking: tracking,
    comments: sanitizeComments(item.comments, processId),
    corrections: sanitizeCorrections(item.corrections, processId),
  };
}

function sanitizeComments(value: unknown, processId: string): AuditProcess['comments'] {
  if (!value || typeof value !== 'object') return {};
  const comments: AuditProcess['comments'] = {};
  Object.entries(value as Record<string, unknown>).forEach(([issueKey, entries]) => {
    if (!Array.isArray(entries)) return;
    comments[issueKey] = entries
      .filter((entry): entry is Partial<AuditProcess['comments'][string][number]> => Boolean(entry && typeof entry === 'object'))
      .map((entry) => ({
        id: String(entry.id ?? createId('comment')),
        issueKey: String(entry.issueKey ?? issueKey),
        processId,
        author: String(entry.author ?? 'Auditor'),
        body: String(entry.body ?? ''),
        createdAt: String(entry.createdAt ?? new Date().toISOString()),
      }))
      .filter((entry) => entry.body.trim());
  });
  return comments;
}

function sanitizeTracking(value: unknown, processId: string): Record<string, TrackingEntry> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, Partial<TrackingEntry>>).map(([key, entry]) => {
    const managerEmail = String(entry.managerEmail ?? key.split(':').at(-1) ?? '');
    const trackingKey = `${processId}:${managerEmail}`;
    return [trackingKey, {
      key: trackingKey,
      processId,
      managerName: String(entry.managerName ?? 'Unassigned'),
      managerEmail,
      flaggedProjectCount: Number(entry.flaggedProjectCount ?? 0),
      outlookCount: Number(entry.outlookCount ?? 0),
      teamsCount: Number(entry.teamsCount ?? 0),
      lastContactAt: entry.lastContactAt ? String(entry.lastContactAt) : null,
      stage: entry.stage ?? 'Not contacted',
      resolved: Boolean(entry.resolved),
      history: Array.isArray(entry.history) ? entry.history.map((event) => ({
        channel: event.channel ?? 'manual',
        at: String(event.at ?? new Date().toISOString()),
        note: String(event.note ?? ''),
      })) : [],
    } satisfies TrackingEntry];
  }));
}

function sanitizeCorrections(value: unknown, processId: string): AuditProcess['corrections'] {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, Partial<AuditProcess['corrections'][string]>>).map(([issueKey, correction]) => {
    const next = {
      issueKey: String(correction.issueKey ?? issueKey),
      processId,
      ...(correction.effort !== undefined ? { effort: Number(correction.effort) || 0 } : {}),
      ...(correction.projectState ? { projectState: String(correction.projectState) } : {}),
      ...(correction.projectManager ? { projectManager: String(correction.projectManager) } : {}),
      note: String(correction.note ?? ''),
      updatedAt: String(correction.updatedAt ?? new Date().toISOString()),
    };
    return [next.issueKey, next];
  }));
}
