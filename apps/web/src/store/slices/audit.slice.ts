/**
 * Audit slice — currentAuditResult, isAuditRunning, and all audit actions.
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from '../types';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../../lib/auditPolicy';
import { runAuditAsync } from '../../lib/auditRunner';
import { createId } from '../../lib/id';
import { fetchAuditIssues, fetchLatestAuditRunForFile, runAuditOnApi, type ApiAuditRunIssue, type ApiAuditRunSummary } from '../../lib/api/auditsApi';
import type { AuditResult } from '../../lib/types';

export type AuditSlice = Pick<
  AppStore,
  | 'currentAuditResult'
  | 'isAuditRunning'
  | 'auditProgressText'
  | 'auditRunKey'
  | 'updateAuditPolicy'
  | 'resetAuditPolicy'
  | 'runAudit'
  | 'cancelAudit'
  | 'hydrateLatestAuditResult'
  | 'currentAuditResultForFile'
>;

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

function patchFile<T extends { files: { id: string }[]; updatedAt: string }>(
  process: T,
  fileId: string,
  updater: (f: T['files'][number]) => T['files'][number],
): T {
  return { ...process, files: process.files.map((f) => (f.id === fileId ? updater(f) : f)), updatedAt: new Date().toISOString() };
}

export function mapApiAuditToResult(
  fileId: string,
  run: ApiAuditRunSummary,
  issues: ApiAuditRunIssue[],
): AuditResult {
  const mapped = issues.map((issue) => ({
    id: issue.displayCode,
    issueKey: issue.issueKey,
    projectNo: issue.projectNo ?? '',
    projectName: issue.projectName ?? '',
    sheetName: issue.sheetName ?? '',
    severity: issue.severity,
    projectManager: issue.projectManager ?? '',
    projectState: issue.projectState ?? '',
    effort: issue.effort ?? 0,
    auditStatus: '',
    notes: '',
    rowIndex: issue.rowIndex ?? 0,
    email: issue.email ?? '',
    ruleId: issue.ruleCode,
    ruleCode: issue.ruleCode,
    ruleName: issue.rule?.name,
    category: issue.rule?.category,
    reason: issue.reason ?? '',
    thresholdLabel: issue.thresholdLabel ?? '',
    recommendedAction: issue.recommendedAction ?? '',
  })) as AuditResult['issues'];
  const sheetSummary =
    (run.summary as { sheets?: Array<{ sheetName: string; rowCount: number; flaggedCount: number }> }).sheets ?? [];
  return {
    fileId,
    runAt: run.completedAt ?? run.startedAt,
    scannedRows: run.scannedRows,
    flaggedRows: run.flaggedRows,
    findingsHash: run.findingsHash ?? '',
    issues: mapped,
    sheets: sheetSummary,
  };
}

export const createAuditSlice: StateCreator<AppStore, [], [], AuditSlice> = (set, get) => ({
  currentAuditResult: null,
  isAuditRunning: false,
  auditProgressText: '',
  auditRunKey: null,

  updateAuditPolicy: (processId, patch) => {
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        auditPolicy: normalizeAuditPolicy({ ...process.auditPolicy, ...patch, updatedAt: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      })),
    }));
  },

  resetAuditPolicy: (processId) => {
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        auditPolicy: createDefaultAuditPolicy(),
        updatedAt: new Date().toISOString(),
      })),
    }));
  },

  cancelAudit: () => {
    set({ isAuditRunning: false, auditProgressText: '', auditRunKey: null });
  },

  currentAuditResultForFile: (processId, fileId) => {
    const state = get();
    if (state.currentAuditResult?.fileId === fileId) return state.currentAuditResult;
    const process = state.processes.find((item) => item.id === processId);
    return [...(process?.versions ?? [])].reverse().find((v) => v.result.fileId === fileId)?.result ?? null;
  },

  hydrateLatestAuditResult: async (processId, fileId, opts) => {
    const process = get().processes.find(
      (item) => item.id === processId || item.displayCode === processId,
    );
    const file = process?.files.find((item) => item.id === fileId);
    if (!process || !file || !process.serverBacked) return;
    const fileDisplayCode = (file as { displayCode?: string }).displayCode ?? file.id;
    const processRef = process.displayCode ?? process.id;
    const existing = get().currentAuditResult;
    if (!opts?.force && existing && existing.fileId === fileId) return;
    try {
      const apiResult = await fetchLatestAuditRunForFile(processRef, fileDisplayCode);
      if (!apiResult) return;
      const apiIssues = await fetchAuditIssues(apiResult.displayCode);
      const mapped = mapApiAuditToResult(file.id, apiResult, apiIssues);
      set((state) => ({
        currentAuditResult: mapped,
        processes: patchProcess(state.processes, processId, (item) => ({
          ...item,
          latestAuditResult: mapped,
        })),
      }));
    } catch {
      // Non-fatal — tab will show "No audit run yet".
    }
  },

  runAudit: async (processId, fileId, runOptions) => {
    const process = get().processes.find((item) => item.id === processId);
    const file = process?.files.find((item) => item.id === fileId);
    if (!process || !file) return;
    const selected = file.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected);
    if (!selected.length) {
      throw new Error('No sheets selected for audit. Select at least one sheet and try again.');
    }

    const runKey = createId();
    set({
      isAuditRunning: true,
      auditProgressText: `Auditing sheet 1 of ${selected.length}...`,
      auditRunKey: runKey,
    });

    const stillActive = () => get().auditRunKey === runKey;

    const fileDisplayCode = (file as { displayCode?: string }).displayCode;
    const useServer = Boolean(process.serverBacked && process.displayCode && fileDisplayCode);

    const autoSaveAfterRun = (anchorResult: AuditResult) => {
      const current = get().processes.find((p) => p.id === processId);
      if (!current) return;
      const latest = current.latestAuditResult;
      if (!latest || latest.runAt !== anchorResult.runAt || latest.fileId !== anchorResult.fileId) return;
      if (current.versions.length > 0) return;
      get().saveVersion(processId, { versionName: `${current.name} - V1`, notes: '' });
    };

    try {
      if (useServer) {
        const apiResult = await runAuditOnApi(process.displayCode!, fileDisplayCode!, runOptions);
        const apiIssues = await fetchAuditIssues(apiResult.displayCode);
        if (!stillActive()) return;
        const mapped = mapApiAuditToResult(file.id, apiResult, apiIssues);
        set((state) => ({
          isAuditRunning: false,
          auditProgressText: '',
          auditRunKey: null,
          currentAuditResult: mapped,
          activeWorkspaceTab: 'results',
          processes: patchProcess(state.processes, processId, (item) =>
            patchFile({ ...item, latestAuditResult: mapped }, fileId, (f) => ({
              ...f,
              isAudited: true,
              lastAuditedAt: mapped.runAt,
            })),
          ),
        }));
        autoSaveAfterRun(mapped);
        return;
      }
      const result = await runAuditAsync(file, file.functionId, process.auditPolicy);
      if (!stillActive()) return;
      set((state) => ({
        isAuditRunning: false,
        auditProgressText: '',
        auditRunKey: null,
        currentAuditResult: result,
        activeWorkspaceTab: 'results',
        processes: patchProcess(state.processes, processId, (item) =>
          patchFile({ ...item, latestAuditResult: result }, fileId, (f) => ({
            ...f,
            isAudited: true,
            lastAuditedAt: result.runAt,
          })),
        ),
      }));
      autoSaveAfterRun(result);
    } catch (err) {
      if (stillActive()) set({ isAuditRunning: false, auditProgressText: '', auditRunKey: null });
      throw err;
    }
  },
});
