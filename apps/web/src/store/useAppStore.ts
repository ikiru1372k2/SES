import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import {
  DEFAULT_FUNCTION_ID,
  type EscalationStage,
  type FunctionId,
  type LegacyProjectTrackingRow,
  parseProjectStatuses,
} from '@ses/domain';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../lib/auditPolicy';
import { runAuditAsync } from '../lib/auditRunner';
import { deleteWorkbookRawData, getWorkbookRawData, putWorkbookRawData, renameWorkbookRawDataKey } from '../lib/blobStore';
import { parseWorkbook } from '../lib/excelParser';
import { createId } from '../lib/id';
import { createProcessOnApi, deleteProcessOnApi, fetchProcessesFromApi, updateProcessOnApi } from '../lib/api/processesApi';
import { uploadFileToApi, deleteFileOnApi, listFilesOnApi, type ApiFileSummary } from '../lib/api/filesApi';
import { listFileVersionsOnApi } from '../lib/api/fileVersionsApi';
import { deleteFileDraftOnApi, getFileDraftOnApi, promoteFileDraftOnApi, saveFileDraftOnApi } from '../lib/api/fileDraftsApi';
import { fetchAuditIssues, runAuditOnApi, type ApiAuditRunIssue, type ApiAuditRunSummary } from '../lib/api/auditsApi';
import { upsertTrackingOnApi, addTrackingEventOnApi } from '../lib/api/trackingApi';
import {
  addIssueCommentOnApi,
  deleteIssueCommentOnApi,
  saveIssueCorrectionOnApi,
  clearIssueCorrectionOnApi,
  saveIssueAcknowledgmentOnApi,
} from '../lib/api/issuesApi';
import { DATA_KEY, loadProcessesFromLocalDb, rememberActiveProcess, saveProcessesToLocalDb } from '../lib/storage';
import { makeDefaultTrackingEntry, trackingKey } from '../lib/tracking';
import type {
  AcknowledgmentStatus,
  AuditPolicy,
  AuditProcess,
  AuditResult,
  FileDraftMetadata,
  IssueAcknowledgment,
  IssueComment,
  IssueCorrection,
  NotificationComposeTemplate,
  NotificationTheme,
  ProjectTrackingStatus,
  TrackingChannel,
  TrackingEntry,
  WorkbookFile,
  WorkspaceTab,
} from '../lib/types';

function inferEscalationStageFromCounts(outlookCount: number, teamsCount: number, resolved: boolean): EscalationStage {
  if (resolved) return 'RESOLVED';
  if (teamsCount > 0) return 'ESCALATED_L1';
  if (outlookCount >= 2) return 'AWAITING_RESPONSE';
  if (outlookCount === 1) return 'SENT';
  return 'NEW';
}

type UploadState = {
  fileName: string;
  progress: number;
  status: 'uploading' | 'complete' | 'failed';
  error?: string;
};

type AppStore = {
  processes: AuditProcess[];
  activeProcessId: string | null;
  activeWorkspaceTab: WorkspaceTab;
  currentAuditResult: AuditResult | null;
  isAuditRunning: boolean;
  auditProgressText: string;
  uploads: Record<string, UploadState>;
  fileDrafts: Record<string, FileDraftMetadata>;
  hydrateProcesses: () => Promise<void>;
  hydrateFunctionWorkspace: (processId: string, functionId: FunctionId) => Promise<void>;
  createProcess: (name: string, description: string) => Promise<AuditProcess>;
  updateProcess: (id: string, patch: Partial<AuditProcess>) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
  setActiveProcess: (id: string) => void;
  uploadFile: (processId: string, file: File, functionId?: FunctionId) => Promise<void>;
  saveFileDraft: (processId: string, functionId: FunctionId, file: File, opts?: { beacon?: boolean }) => Promise<void>;
  discardFileDraft: (processId: string, functionId: FunctionId) => Promise<void>;
  promoteFileDraft: (processId: string, functionId: FunctionId, note?: string) => Promise<void>;
  setActiveFile: (processId: string, fileId: string) => void;
  deleteFile: (processId: string, fileId: string) => void;
  toggleSheet: (processId: string, fileId: string, sheetName: string) => void;
  selectAllValidSheets: (processId: string, fileId: string) => void;
  clearSheetSelection: (processId: string, fileId: string) => void;
  currentAuditResultForFile: (processId: string, fileId: string) => AuditResult | null;
  updateAuditPolicy: (processId: string, patch: Partial<AuditPolicy>) => void;
  resetAuditPolicy: (processId: string) => void;
  runAudit: (processId: string, fileId: string) => Promise<void>;
  saveVersion: (processId: string, details: { versionName: string; notes: string }) => AuditProcess | undefined;
  loadVersion: (processId: string, versionId: string) => void;
  recordTrackingEvent: (processId: string, managerName: string, managerEmail: string, flaggedProjectCount: number, channel: TrackingChannel, note: string) => void;
  setTrackingStage: (processId: string, managerName: string, managerEmail: string, flaggedProjectCount: number, stage: EscalationStage) => void;
  markTrackingResolved: (processId: string, managerEmail: string) => void;
  reopenTracking: (processId: string, managerEmail: string) => void;
  addIssueComment: (processId: string, issueKey: string, body: string, author?: string) => void;
  deleteIssueComment: (processId: string, issueKey: string, commentId: string) => void;
  saveIssueCorrection: (processId: string, issueKey: string, correction: Omit<IssueCorrection, 'issueKey' | 'processId' | 'updatedAt'>) => void;
  clearIssueCorrection: (processId: string, issueKey: string) => void;
  setIssueAcknowledgment: (processId: string, issueKey: string, status: AcknowledgmentStatus) => void;
  clearIssueAcknowledgment: (processId: string, issueKey: string) => void;
  updateProjectStatus: (
    processId: string,
    managerEmail: string,
    projectNo: string,
    patch: Partial<Pick<ProjectTrackingStatus, 'stage' | 'feedback'>>,
    note?: string,
  ) => void;
  saveTemplate: (processId: string, name: string, theme: NotificationTheme, template: NotificationComposeTemplate) => void;
  loadTemplate: (processId: string, name: string) => NotificationComposeTemplate | null;
  deleteTemplate: (processId: string, name: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  resetWorkspaceAfterUserSwitch: () => void;
  reconcileProcessesFromServer: (remote: AuditProcess[]) => void;
  evictProcess: (id: string) => void;
};

const browserStorage: PersistStorage<AppStore> = {
  getItem: async () => ({ state: { processes: await loadProcessesFromLocalDb() } as AppStore, version: 1 }),
  setItem: (_name, value: StorageValue<AppStore>) => {
    debouncedSaveProcesses(value.state?.processes ?? []);
  },
  removeItem: () => localStorage.removeItem(DATA_KEY),
};

let saveTimer: number | undefined;

function debouncedSaveProcesses(processes: AuditProcess[]): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveProcessesToLocalDb(processes);
  }, 400);
}

function cancelDebouncedWorkspaceSave(): void {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

function patchProcess(processes: AuditProcess[], processId: string, updater: (process: AuditProcess) => AuditProcess): AuditProcess[] {
  return processes.map((process) => (process.id === processId ? updater(process) : process));
}

function patchFile(process: AuditProcess, fileId: string, updater: (file: WorkbookFile) => WorkbookFile): AuditProcess {
  return { ...process, files: process.files.map((file) => (file.id === fileId ? updater(file) : file)), updatedAt: new Date().toISOString() };
}

/**
 * Convert the backend's audit-run summary + issues into the `AuditResult`
 * shape the UI already speaks. Kept flat so the downstream Results / Tracking
 * / Notifications tabs render identically whether the audit ran locally or on
 * the server.
 *
 * The backend uses `ruleCode` / `displayCode`; the UI uses `ruleId` / `id`.
 * We map both directions so saved versions keep working.
 */
function mapApiAuditToResult(
  fileId: string,
  run: ApiAuditRunSummary,
  issues: ApiAuditRunIssue[],
): AuditResult {
  const mapped = issues.map((issue) => ({
    id: issue.displayCode,
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
  const sheetSummary = (run.summary as { sheets?: Array<{ sheetName: string; rowCount: number; flaggedCount: number }> }).sheets ?? [];
  return {
    fileId,
    runAt: run.completedAt ?? run.startedAt,
    scannedRows: run.scannedRows,
    flaggedRows: run.flaggedRows,
    issues: mapped,
    sheets: sheetSummary,
  };
}

async function mapApiFileToWorkbookFile(file: ApiFileSummary): Promise<WorkbookFile> {
  const rawData = (await getWorkbookRawData(file.id)) ?? {};
  return {
    id: file.id,
    displayCode: file.displayCode,
    functionId: file.functionId,
    rowVersion: file.rowVersion,
    currentVersion: file.currentVersion ?? 1,
    state: file.state ?? 'completed',
    name: file.name,
    uploadedAt: file.uploadedAt,
    lastAuditedAt: file.lastAuditedAt,
    isAudited: Boolean(file.lastAuditedAt),
    serverBacked: true,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    sheets: file.sheets.map((sheet) => ({
      name: sheet.name,
      status: sheet.status,
      rowCount: sheet.rowCount,
      isSelected: sheet.isSelected,
      ...(sheet.headerRowIndex !== null ? { headerRowIndex: sheet.headerRowIndex } : {}),
      ...(sheet.originalHeaders !== undefined ? { originalHeaders: sheet.originalHeaders } : {}),
      ...(sheet.normalizedHeaders !== undefined ? { normalizedHeaders: sheet.normalizedHeaders } : {}),
    })),
    rawData,
  };
}

function draftKey(processId: string, functionId: FunctionId): string {
  return `${processId}:${functionId}`;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      processes: [],
      activeProcessId: null,
      activeWorkspaceTab: 'preview',
      currentAuditResult: null,
      isAuditRunning: false,
      auditProgressText: '',
      uploads: {},
      fileDrafts: {},

      hydrateProcesses: () => {
        return (async () => {
          try {
            const remote = await fetchProcessesFromApi();
            if (remote !== null) {
              get().reconcileProcessesFromServer(remote);
              return;
            }
          } catch {
            // fall through to local
          }
          return loadProcessesFromLocalDb().then((processes) => {
            if (processes.length) set({ processes });
          });
        })();
      },

      hydrateFunctionWorkspace: async (processId, functionId) => {
        const process = get().processes.find((item) => item.id === processId || item.displayCode === processId);
        if (!process) return;
        const processRef = process.displayCode ?? process.id;
        const [apiFiles, draft] = await Promise.all([
          listFilesOnApi(processRef, functionId),
          getFileDraftOnApi(processRef, functionId).catch(() => ({ hasDraft: false } satisfies FileDraftMetadata)),
        ]);
        const mapped = await Promise.all(apiFiles.map(async (file) => {
          const base = await mapApiFileToWorkbookFile(file);
          const versions = await listFileVersionsOnApi(file.displayCode ?? file.id).catch(() => []);
          return { ...base, fileVersions: versions };
        }));
        set((state) => ({
          fileDrafts: { ...state.fileDrafts, [draftKey(process.id, functionId)]: draft },
          processes: patchProcess(state.processes, process.id, (current) => {
            const otherFiles = current.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) !== functionId);
            const activeStillPresent = mapped.some((file) => file.id === current.activeFileId);
            return {
              ...current,
              files: [...otherFiles, ...mapped],
              activeFileId: activeStillPresent ? current.activeFileId : (mapped[0]?.id ?? current.activeFileId),
            };
          }),
        }));
        await saveProcessesToLocalDb(get().processes);
      },

      createProcess: async (name, description) => {
        const created = await createProcessOnApi(name, description);
        set((state) => ({
          processes: [created, ...state.processes],
          activeProcessId: created.id,
          activeWorkspaceTab: 'preview',
          currentAuditResult: null,
        }));
        rememberActiveProcess(created.id);
        await saveProcessesToLocalDb(get().processes);
        return created;
      },

      updateProcess: async (processId, patch) => {
        const proc = get().processes.find((item) => item.id === processId);
        if (proc?.serverBacked && proc.displayCode && typeof proc.rowVersion === 'number') {
          const body: { name?: string; description?: string; nextAuditDue?: string | null } = {};
          if (patch.name !== undefined) body.name = patch.name;
          if (patch.description !== undefined) body.description = patch.description;
          if (patch.nextAuditDue !== undefined) body.nextAuditDue = patch.nextAuditDue;
          if (Object.keys(body).length > 0) {
            const updated = await updateProcessOnApi(proc.displayCode, proc.rowVersion, body);
            set((state) => ({
              processes: state.processes.map((item) =>
                item.id === processId
                  ? ({
                      ...updated,
                      files: item.files,
                      activeFileId: item.activeFileId,
                      versions: item.versions,
                      ...(item.latestAuditResult !== undefined ? { latestAuditResult: item.latestAuditResult } : {}),
                      notificationTracking: item.notificationTracking,
                      comments: item.comments,
                      corrections: item.corrections,
                      acknowledgments: item.acknowledgments,
                      savedTemplates: item.savedTemplates,
                    } satisfies AuditProcess)
                  : item,
              ),
            }));
            await saveProcessesToLocalDb(get().processes);
            return;
          }
        }
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            ...patch,
            updatedAt: new Date().toISOString(),
          })),
        }));
      },

      deleteProcess: async (processId) => {
        const proc = get().processes.find((item) => item.id === processId);
        if (proc?.serverBacked && (proc.displayCode ?? proc.id)) {
          await deleteProcessOnApi(proc.displayCode ?? proc.id);
        }
        if (proc) {
          for (const file of proc.files) {
            void deleteWorkbookRawData(file.id);
          }
        }
        set((state) => {
          const processes = state.processes.filter((process) => process.id !== processId);
          const activeProcessId = state.activeProcessId === processId ? processes[0]?.id ?? null : state.activeProcessId;
          rememberActiveProcess(activeProcessId);
          return { processes, activeProcessId, currentAuditResult: null };
        });
        await saveProcessesToLocalDb(get().processes);
      },

      setActiveProcess: (processId) => {
        set({ activeProcessId: processId, activeWorkspaceTab: 'preview', currentAuditResult: null });
        rememberActiveProcess(processId);
      },

      uploadFile: async (processId, file, functionId) => {
        const fid: FunctionId = functionId ?? DEFAULT_FUNCTION_ID;
        const uploadId = createId(`${processId}-${file.name}`);
        const target = get().processes.find((p) => p.id === processId);
        set((state) => ({ uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 20, status: 'uploading' } } }));
        try {
          if (target?.serverBacked && target.displayCode) {
            // Parse locally first so the client has a deterministic temp id
            // for the IndexedDB cache — the server echoes `clientTempId` back
            // so we can rekey the raw-data cache to the server id after upload.
            const parsed = await parseWorkbook(file);
            await putWorkbookRawData(parsed.id, parsed.rawData);
            // Server-backed: POST the bytes; backend parses + stores + emits
            // file.uploaded over the realtime channel so other members see it.
            const apiFile = await uploadFileToApi(target.displayCode, fid, file, {
              clientTempId: parsed.id,
            });
            // Rekey IDB cache from temp id to server id so reload hydration
            // finds the parsed rawData (fix for #63 hydration bug).
            if (apiFile.id !== parsed.id) {
              await renameWorkbookRawDataKey(parsed.id, apiFile.id);
            }
            // Merge server metadata (displayCode, sheet codes) onto local shape
            const mergedSheets = parsed.sheets.map((s) => {
              const api = apiFile.sheets.find((x) => x.name === s.name);
              return api
                ? { ...s, serverDisplayCode: api.displayCode, serverSheetId: api.id }
                : s;
            });
            const merged = {
              ...parsed,
              id: apiFile.id,
              displayCode: apiFile.displayCode,
              functionId: apiFile.functionId,
              sheets: mergedSheets,
              serverBacked: true,
            };
            set((state) => ({
              uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 100, status: 'complete' } },
              fileDrafts: Object.fromEntries(Object.entries(state.fileDrafts).filter(([key]) => key !== draftKey(processId, fid))),
              processes: patchProcess(state.processes, processId, (process) => ({
                ...process,
                activeFileId: process.activeFileId ?? merged.id,
                files: [...process.files, merged],
                updatedAt: new Date().toISOString(),
              })),
            }));
          } else {
            // Local-only path (legacy): everything stays in the browser.
            const workbookFile = await parseWorkbook(file);
            await putWorkbookRawData(workbookFile.id, workbookFile.rawData);
            set((state) => ({
              uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 100, status: 'complete' } },
              processes: patchProcess(state.processes, processId, (process) => ({
                ...process,
                activeFileId: process.activeFileId ?? workbookFile.id,
                files: [...process.files, workbookFile],
                updatedAt: new Date().toISOString(),
              })),
            }));
          }
          window.setTimeout(() => set((state) => {
            const next = { ...state.uploads };
            delete next[uploadId];
            return { uploads: next };
          }), 900);
        } catch (error) {
          set((state) => ({ uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 100, status: 'failed', error: error instanceof Error ? error.message : 'Upload failed' } } }));
          throw error;
        }
      },

      saveFileDraft: async (processId, functionId, file, opts) => {
        const process = get().processes.find((item) => item.id === processId || item.displayCode === processId);
        if (!process?.serverBacked) return;
        const draft = await saveFileDraftOnApi(process.displayCode ?? process.id, functionId, file, file.name, opts);
        if ('ok' in draft) return;
        set((state) => ({ fileDrafts: { ...state.fileDrafts, [draftKey(process.id, functionId)]: draft } }));
      },

      discardFileDraft: async (processId, functionId) => {
        const process = get().processes.find((item) => item.id === processId || item.displayCode === processId);
        if (!process?.serverBacked) return;
        await deleteFileDraftOnApi(process.displayCode ?? process.id, functionId);
        set((state) => {
          const next = { ...state.fileDrafts };
          delete next[draftKey(process.id, functionId)];
          return { fileDrafts: next };
        });
      },

      promoteFileDraft: async (processId, functionId, note = '') => {
        const process = get().processes.find((item) => item.id === processId || item.displayCode === processId);
        if (!process?.serverBacked) return;
        await promoteFileDraftOnApi(process.displayCode ?? process.id, functionId, note);
        await get().hydrateFunctionWorkspace(process.id, functionId);
        set((state) => {
          const next = { ...state.fileDrafts };
          delete next[draftKey(process.id, functionId)];
          return { fileDrafts: next };
        });
      },

      setActiveFile: (processId, fileId) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({ ...process, activeFileId: fileId })),
          activeWorkspaceTab: 'preview',
          currentAuditResult: null,
        }));
      },

      deleteFile: (processId, fileId) => {
        const target = get().processes.find((p) => p.id === processId);
        const file = target?.files.find((f) => f.id === fileId);
        // Fire-and-forget server delete; local state is updated regardless so
        // the UI stays responsive. If the server delete fails the next page
        // reload will reveal the file is still there.
        if (target?.serverBacked && file) {
          const ref = (file as { displayCode?: string }).displayCode ?? fileId;
          void deleteFileOnApi(ref).catch((err) => {
            // Recovery: local state is already updated; server file will reappear on next reload.
            console.warn('[files] server delete failed', err);
          });
        }
        void deleteWorkbookRawData(fileId);
        set((state) => ({
          currentAuditResult: state.currentAuditResult?.fileId === fileId ? null : state.currentAuditResult,
          processes: patchProcess(state.processes, processId, (process) => {
            const files = process.files.filter((file) => file.id !== fileId);
            return { ...process, files, activeFileId: process.activeFileId === fileId ? files[0]?.id ?? null : process.activeFileId, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      toggleSheet: (processId, fileId, sheetName) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) =>
            patchFile(process, fileId, (file) => ({
              ...file,
              sheets: file.sheets.map((sheet) => (sheet.name === sheetName && sheet.status === 'valid' ? { ...sheet, isSelected: !sheet.isSelected } : sheet)),
              isAudited: false,
            })),
          ),
        }));
      },

      selectAllValidSheets: (processId, fileId) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) =>
            patchFile(process, fileId, (file) => ({
              ...file,
              sheets: file.sheets.map((sheet) => ({ ...sheet, isSelected: sheet.status === 'valid' })),
              isAudited: false,
            })),
          ),
        }));
      },

      clearSheetSelection: (processId, fileId) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) =>
            patchFile(process, fileId, (file) => ({ ...file, sheets: file.sheets.map((sheet) => ({ ...sheet, isSelected: false })), isAudited: false })),
          ),
        }));
      },

      currentAuditResultForFile: (processId, fileId) => {
        const state = get();
        if (state.currentAuditResult?.fileId === fileId) return state.currentAuditResult;
        const process = state.processes.find((item) => item.id === processId);
        return [...(process?.versions ?? [])].reverse().find((version) => version.result.fileId === fileId)?.result ?? null;
      },

      runAudit: async (processId, fileId) => {
        const process = get().processes.find((item) => item.id === processId);
        const file = process?.files.find((item) => item.id === fileId);
        if (!process || !file) return;
        const selected = file.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected);
        if (!selected.length) return;
        set({ isAuditRunning: true, auditProgressText: `Auditing sheet 1 of ${selected.length}...` });

        // When the process and file are both server-backed we run the audit on
        // the backend. That lets the RealtimeGateway emit 'audit.completed' to
        // every connected member of the process room, and keeps the audit_runs
        // / audit_issues rows as the source of truth. The local engine result
        // is still computed in parallel below so the UI can render instantly
        // even if the server round-trip takes a second.
        const fileDisplayCode = (file as { displayCode?: string }).displayCode;
        const useServer = Boolean(process.serverBacked && process.displayCode && fileDisplayCode);
        try {
          if (useServer) {
            try {
              const apiResult = await runAuditOnApi(process.displayCode!, fileDisplayCode!);
              const apiIssues = await fetchAuditIssues(apiResult.displayCode);
              const mapped = mapApiAuditToResult(file.id, apiResult, apiIssues);
              set((state) => ({
                isAuditRunning: false,
                auditProgressText: '',
                currentAuditResult: mapped,
                activeWorkspaceTab: 'results',
                processes: patchProcess(state.processes, processId, (item) =>
                  patchFile({ ...item, latestAuditResult: mapped }, fileId, (currentFile) => ({
                    ...currentFile,
                    isAudited: true,
                    lastAuditedAt: mapped.runAt,
                  })),
                ),
              }));
              return;
            } catch (err) {
              // Recovery: execution continues with the local in-browser audit engine.
              console.warn('[audit] server-side run failed, falling back to local engine', err);
            }
          }
          const result = await runAuditAsync(file, process.auditPolicy);
          set((state) => ({
            isAuditRunning: false,
            auditProgressText: '',
            currentAuditResult: result,
            activeWorkspaceTab: 'results',
            processes: patchProcess(state.processes, processId, (item) =>
              patchFile({ ...item, latestAuditResult: result }, fileId, (currentFile) => ({
                ...currentFile,
                isAudited: true,
                lastAuditedAt: result.runAt,
              })),
            ),
          }));
        } catch (err) {
          set({ isAuditRunning: false, auditProgressText: '' });
          throw err;
        }
      },

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

      saveVersion: (processId, details) => {
        const processForResult = get().processes.find((process) => process.id === processId);
        const result = get().currentAuditResult ?? processForResult?.latestAuditResult;
        if (!result) return undefined;
        let updated: AuditProcess | undefined;
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const versionNumber = process.versions.length + 1;
            const versionId = `${process.id}-v${versionNumber}`;
            updated = {
              ...process,
              updatedAt: new Date().toISOString(),
              latestAuditResult: result,
              versions: [
                {
                  id: versionId,
                  versionId,
                  versionNumber,
                  versionName: details.versionName.trim() || `${process.name} - V${versionNumber}`,
                  notes: details.notes.trim(),
                  createdAt: new Date().toISOString(),
                  result,
                  auditPolicy: result.policySnapshot ?? process.auditPolicy,
                },
                ...process.versions,
              ],
            };
            return updated;
          }),
        }));
        return updated;
      },

      loadVersion: (processId, versionId) => {
        const version = get().processes.find((process) => process.id === processId)?.versions.find((item) => item.id === versionId || item.versionId === versionId);
        if (version) set({ currentAuditResult: version.result, activeWorkspaceTab: 'results' });
      },

      recordTrackingEvent: (processId, managerName, managerEmail, flaggedProjectCount, channel, note) => {
        const now = new Date().toISOString();
        // Fire-and-forget upsert (to ensure tracking row exists) + event.
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          const managerKey = managerEmail.toLowerCase().trim();
          void (async () => {
            try {
              const row = await upsertTrackingOnApi(proc.displayCode!, {
                managerKey,
                managerName,
                managerEmail,
              });
              await addTrackingEventOnApi(row.displayCode, { channel, note });
            } catch (err) {
              // Recovery: local state already updated; event will be missing from server timeline.
              console.warn('[tracking] server event failed', err);
            }
          })();
        }
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            const outlookCount = (current?.outlookCount ?? 0) + (channel === 'outlook' || channel === 'eml' || channel === 'sendAll' ? 1 : 0);
            const teamsCount = (current?.teamsCount ?? 0) + (channel === 'teams' ? 1 : 0);
            const stage = inferEscalationStageFromCounts(outlookCount, teamsCount, current?.resolved ?? false);
            const base = makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
            const entry: TrackingEntry = {
              ...base,
              outlookCount,
              teamsCount,
              lastContactAt: now,
              stage,
              resolved: current?.resolved ?? false,
              history: [...(current?.history ?? []), { channel, at: now, note }],
              projectStatuses: parseProjectStatuses(current?.projectStatuses),
            };
            return { ...process, notificationTracking: { ...process.notificationTracking, [key]: entry }, updatedAt: now };
          }),
        }));
      },

      setTrackingStage: (processId, managerName, managerEmail, flaggedProjectCount, stage) => {
        const now = new Date().toISOString();
        // Fire-and-forget API mirror so the other user gets a live toast.
        // We don't await here because the existing optimistic-local update
        // should feel instant; if the API is slow we still render.
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          void upsertTrackingOnApi(proc.displayCode, {
            managerKey: managerEmail.toLowerCase().trim(),
            managerName,
            managerEmail,
            stage,
            resolved: stage === 'RESOLVED',
          }).catch((err) => {
            // Recovery: local store is already patched; re-sync on next page load.
            console.warn('[tracking] server upsert failed', err);
          });
        }
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            const base = current ?? makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
            const nextCounts: Pick<TrackingEntry, 'outlookCount' | 'teamsCount' | 'resolved'> = (() => {
              switch (stage) {
                case 'NEW':
                  return { outlookCount: 0, teamsCount: 0, resolved: false };
                case 'SENT':
                  return { outlookCount: Math.max(base.outlookCount, 1), teamsCount: 0, resolved: false };
                case 'AWAITING_RESPONSE':
                  return { outlookCount: Math.max(base.outlookCount, 2), teamsCount: 0, resolved: false };
                case 'ESCALATED_L1':
                case 'ESCALATED_L2':
                case 'NO_RESPONSE':
                  return {
                    outlookCount: Math.max(base.outlookCount, 1),
                    teamsCount: Math.max(base.teamsCount, 1),
                    resolved: false,
                  };
                case 'DRAFTED':
                case 'RESPONDED':
                  return {
                    outlookCount: base.outlookCount,
                    teamsCount: base.teamsCount,
                    resolved: false,
                  };
                case 'RESOLVED':
                  return { outlookCount: base.outlookCount, teamsCount: base.teamsCount, resolved: true };
                default:
                  return {
                    outlookCount: base.outlookCount,
                    teamsCount: base.teamsCount,
                    resolved: base.resolved,
                  };
              }
            })();
            const entry: TrackingEntry = {
              ...base,
              managerName,
              managerEmail,
              flaggedProjectCount,
              ...nextCounts,
              stage,
              lastContactAt: stage === 'NEW' ? null : now,
              history: [...base.history, { channel: 'manual', at: now, note: `Moved to ${stage}` }],
            };
            return { ...process, notificationTracking: { ...process.notificationTracking, [key]: entry }, updatedAt: now };
          }),
        }));
      },

      markTrackingResolved: (processId, managerEmail) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            const derivedName = managerEmail.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Unassigned';
            const entry: TrackingEntry = current ?? makeDefaultTrackingEntry(processId, derivedName, managerEmail, 0);
            return {
              ...process,
              notificationTracking: {
                ...process.notificationTracking,
                [key]: {
                  ...entry,
                  resolved: true,
                  stage: 'RESOLVED',
                  lastContactAt: now,
                  history: [...entry.history, { channel: 'manual', at: now, note: 'Marked resolved' }],
                },
              },
              updatedAt: now,
            };
          }),
        }));
      },

      reopenTracking: (processId, managerEmail) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            if (!current) return process;
            const stage = inferEscalationStageFromCounts(current.outlookCount, current.teamsCount, false);
            return {
              ...process,
              notificationTracking: {
                ...process.notificationTracking,
                [key]: {
                  ...current,
                  resolved: false,
                  stage,
                  history: [...current.history, { channel: 'manual', at: now, note: 'Reopened' }],
                },
              },
              updatedAt: now,
            };
          }),
        }));
      },

      addIssueComment: (processId, issueKey, body, author = 'Auditor') => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const now = new Date().toISOString();
        const tempId = createId('comment');
        const comment: IssueComment = {
          id: tempId,
          issueKey,
          processId,
          author: author.trim() || 'Auditor',
          body: trimmed,
          createdAt: now,
        };
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            comments: {
              ...(process.comments ?? {}),
              [issueKey]: [...(process.comments?.[issueKey] ?? []), comment],
            },
            updatedAt: now,
          })),
        }));
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          void addIssueCommentOnApi(proc.displayCode, issueKey, trimmed)
            .then((apiComment) => {
              set((state) => ({
                processes: patchProcess(state.processes, processId, (process) => ({
                  ...process,
                  comments: {
                    ...(process.comments ?? {}),
                    [issueKey]: (process.comments?.[issueKey] ?? []).map((c) =>
                      c.id === tempId ? { ...c, id: apiComment.displayCode } : c,
                    ),
                  },
                })),
              }));
            })
            .catch((err: unknown) => {
              console.warn('[issues] comment add failed', err);
            });
        }
      },

      deleteIssueComment: (processId, issueKey, commentId) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            comments: {
              ...(process.comments ?? {}),
              [issueKey]: (process.comments?.[issueKey] ?? []).filter((comment) => comment.id !== commentId),
            },
            updatedAt: now,
          })),
        }));
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked) {
          void deleteIssueCommentOnApi(commentId).catch((err: unknown) => {
            console.warn('[issues] comment delete failed', err);
          });
        }
      },

      saveIssueCorrection: (processId, issueKey, correction) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            corrections: {
              ...(process.corrections ?? {}),
              [issueKey]: {
                issueKey,
                processId,
                ...correction,
                note: correction.note.trim(),
                updatedAt: now,
              },
            },
            updatedAt: now,
          })),
        }));
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          void saveIssueCorrectionOnApi(proc.displayCode, issueKey, correction).catch((err: unknown) => {
            console.warn('[issues] correction save failed', err);
          });
        }
      },

      clearIssueCorrection: (processId, issueKey) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const corrections = { ...(process.corrections ?? {}) };
            delete corrections[issueKey];
            return { ...process, corrections, updatedAt: now };
          }),
        }));
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          void clearIssueCorrectionOnApi(proc.displayCode, issueKey).catch((err: unknown) => {
            console.warn('[issues] correction clear failed', err);
          });
        }
      },

      setIssueAcknowledgment: (processId, issueKey, status) => {
        const now = new Date().toISOString();
        const entry: IssueAcknowledgment = { issueKey, processId, status, updatedAt: now };
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            acknowledgments: {
              ...(process.acknowledgments ?? {}),
              [issueKey]: entry,
            },
            updatedAt: now,
          })),
        }));
        const proc = get().processes.find((p) => p.id === processId);
        if (proc?.serverBacked && proc.displayCode) {
          void saveIssueAcknowledgmentOnApi(proc.displayCode, issueKey, { status }).catch((err: unknown) => {
            console.warn('[issues] acknowledgment save failed', err);
          });
        }
      },

      clearIssueAcknowledgment: (processId, issueKey) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const next = { ...(process.acknowledgments ?? {}) };
            delete next[issueKey];
            return { ...process, acknowledgments: next, updatedAt: now };
          }),
        }));
      },

      updateProjectStatus: (processId, managerEmail, projectNo, patch, note) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            if (!current) return process;
            const parsed = parseProjectStatuses(current.projectStatuses);
            const legacy: Record<string, LegacyProjectTrackingRow> = { ...(parsed.legacyProjects ?? {}) };
            const existingStatus = legacy[projectNo] ?? {
              projectNo,
              stage: 'open' as const,
              feedback: '',
              history: [],
              updatedAt: now,
            };
            const newStage = patch.stage ?? existingStatus.stage;
            const stageChanged = patch.stage && patch.stage !== existingStatus.stage;
            const updated: ProjectTrackingStatus = {
              ...existingStatus,
              ...patch,
              history: (stageChanged || note
                ? [...existingStatus.history, { channel: 'manual' as TrackingChannel, at: now, note: note ?? `Stage: ${newStage}` }]
                : existingStatus.history) as ProjectTrackingStatus['history'],
              updatedAt: now,
            };
            return {
              ...process,
              notificationTracking: {
                ...process.notificationTracking,
                [key]: {
                  ...current,
                  projectStatuses: { ...parsed, legacyProjects: { ...legacy, [projectNo]: updated } },
                },
              },
              updatedAt: now,
            };
          }),
        }));
      },

      saveTemplate: (processId, name, theme, template) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            savedTemplates: {
              ...(process.savedTemplates ?? {}),
              [name]: { name, theme, template },
            },
            updatedAt: now,
          })),
        }));
      },

      loadTemplate: (processId, name) => {
        const process = get().processes.find((item) => item.id === processId);
        return process?.savedTemplates?.[name]?.template ?? null;
      },

      deleteTemplate: (processId, name) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const next = { ...(process.savedTemplates ?? {}) };
            delete next[name];
            return { ...process, savedTemplates: next, updatedAt: now };
          }),
        }));
      },

      setWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),

      resetWorkspaceAfterUserSwitch: () => {
        cancelDebouncedWorkspaceSave();
        rememberActiveProcess(null);
        set({
          processes: [],
          activeProcessId: null,
          activeWorkspaceTab: 'preview',
          currentAuditResult: null,
          isAuditRunning: false,
          auditProgressText: '',
          uploads: {},
          fileDrafts: {},
        });
      },

      evictProcess: (processId) => {
        set((state) => {
          const processes = state.processes.filter((p) => p.id !== processId);
          const activeProcessId = state.activeProcessId === processId ? (processes[0]?.id ?? null) : state.activeProcessId;
          rememberActiveProcess(activeProcessId);
          void saveProcessesToLocalDb(processes);
          return { processes, activeProcessId, ...(state.activeProcessId === processId ? { currentAuditResult: null } : {}) };
        });
      },

      reconcileProcessesFromServer: (remote) => {
        set((state) => {
          const remoteById = new Map(remote.map((p) => [p.id, p]));
          // Merge: keep local files/versions for known processes; drop server-backed ones absent from remote.
          const merged = state.processes
            .filter((local) => !local.serverBacked || remoteById.has(local.id))
            .map((local) => {
              const fromServer = remoteById.get(local.id);
              if (!fromServer) return local;
              return {
                ...fromServer,
                files: local.files,
                activeFileId: local.activeFileId,
                versions: local.versions,
                ...(local.latestAuditResult !== undefined ? { latestAuditResult: local.latestAuditResult } : {}),
                notificationTracking: local.notificationTracking,
                comments: local.comments,
                corrections: local.corrections,
                acknowledgments: local.acknowledgments,
                savedTemplates: local.savedTemplates,
              } satisfies AuditProcess;
            });
          // Append server-backed processes not yet in local store.
          for (const p of remote) {
            if (!merged.some((m) => m.id === p.id)) {
              merged.push(p);
            }
          }
          const activeStillPresent = merged.some((p) => p.id === state.activeProcessId);
          const nextActive = activeStillPresent ? state.activeProcessId : (merged[0]?.id ?? null);
          if (nextActive !== state.activeProcessId) rememberActiveProcess(nextActive);
          void saveProcessesToLocalDb(merged);
          return {
            processes: merged,
            activeProcessId: nextActive,
            ...(activeStillPresent ? {} : { currentAuditResult: null }),
          };
        });
      },
    }),
    {
      name: DATA_KEY,
      storage: browserStorage,
      version: 1,
      migrate: (persistedState) => {
        const typed = persistedState as Partial<AppStore> | undefined;
        return {
          ...typed,
          processes: Array.isArray(typed?.processes) ? typed.processes : [],
        } as AppStore;
      },
      partialize: (state) => ({ processes: state.processes }) as AppStore,
    },
  ),
);

export type { AppStore, UploadState };
