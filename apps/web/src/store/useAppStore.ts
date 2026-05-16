import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import toast from 'react-hot-toast';
import {
  DEFAULT_FUNCTION_ID,
  type EscalationStage,
  type FunctionId,
  type LegacyProjectTrackingRow,
  parseProjectStatuses,
} from '@ses/domain';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../lib/domain/auditPolicy';
import { runAuditAsync } from '../lib/audit/auditRunner';
import { deleteWorkbookRawData, getWorkbookRawData, putWorkbookRawData, renameWorkbookRawDataKey } from '../lib/storage/blobStore';
import { detectWorkbookSheets, parseWorkbook } from '../lib/workbook/excelParser';
import { createId } from '../lib/domain/id';
import { createProcessOnApi, deleteProcessOnApi, fetchProcessesFromApi, updateProcessOnApi } from '../lib/api/processesApi';
import { uploadFileToApi, deleteFileOnApi, listFilesOnApi, type ApiFileSummary } from '../lib/api/filesApi';
import { listFileVersionsOnApi } from '../lib/api/fileVersionsApi';
import { deleteFileDraftOnApi, getFileDraftOnApi, promoteFileDraftOnApi, saveFileDraftOnApi } from '../lib/api/fileDraftsApi';
import { fetchAuditIssues, fetchLatestAuditRunForFile, runAuditOnApi, type ApiAuditRunIssue, type ApiAuditRunSummary, type MappingSourceInput } from '../lib/api/auditsApi';
import { upsertTrackingOnApi, addTrackingEventOnApi } from '../lib/api/trackingApi';
import {
  addIssueCommentOnApi,
  deleteIssueCommentOnApi,
  saveIssueCorrectionOnApi,
  clearIssueCorrectionOnApi,
  saveIssueAcknowledgmentOnApi,
} from '../lib/api/issuesApi';
import { DATA_KEY, loadProcessesFromLocalDb, rememberActiveProcess, saveProcessesToLocalDb } from '../lib/storage/storage';
import { makeDefaultTrackingEntry, trackingKey } from '../lib/domain/tracking';
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
} from '../lib/domain/types';

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
  // Per-run id; in-flight runs drop their final set() if this has changed.
  // Prevents zombie results from an abandoned promise clobbering a newer one.
  auditRunKey: string | null;
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
  runAudit: (processId: string, fileId: string, runOptions?: { mappingSource?: MappingSourceInput }) => Promise<void>;
  cancelAudit: () => void;
  // Re-hydrates currentAuditResult from server on deep-link arrival when the
  // in-session result was wiped by navigation.
  hydrateLatestAuditResult: (processId: string, fileId: string, opts?: { force?: boolean }) => Promise<void>;
  saveVersion: (processId: string, details: { versionName: string; notes: string }) => AuditProcess | undefined;
  // Overwrite head version's result preserving name/notes/createdAt; creates V1 if none.
  saveOverCurrentVersion: (processId: string) => AuditProcess | undefined;
  // Cross-component signal so UnsavedAuditDialog (in Workspace) can trigger the
  // Save-as-new modal that lives inside TopBar without prop-drilling refs.
  saveAsNewRequestCount: number;
  requestSaveAsNewVersion: () => void;
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

/**
 * Resolve a server-backed process by id at call-time. Returns null if archived,
 * deleted, or never server-backed — caller skips the API mirror silently.
 * Prevents the "captured `proc` before await, process went away" race in
 * fire-and-forget issue/tracking mutators.
 */
function serverBackedProcess(
  processes: AuditProcess[],
  processId: string,
): { displayCode: string } | null {
  const proc = processes.find((p) => p.id === processId);
  if (!proc || !proc.serverBacked || !proc.displayCode) return null;
  return { displayCode: proc.displayCode };
}

function patchFile(process: AuditProcess, fileId: string, updater: (file: WorkbookFile) => WorkbookFile): AuditProcess {
  return { ...process, files: process.files.map((file) => (file.id === fileId ? updater(file) : file)), updatedAt: new Date().toISOString() };
}

/**
 * Convert the backend's audit-run summary + issues into the `AuditResult`
 * shape the UI speaks. Backend uses ruleCode/displayCode; UI uses ruleId/id —
 * map both so saved versions keep working.
 */
function mapApiAuditToResult(
  fileId: string,
  run: ApiAuditRunSummary,
  issues: ApiAuditRunIssue[],
): AuditResult {
  const mapped = issues.map((issue) => ({
    id: issue.displayCode,
    // Stable cross-run identity (IKY-xxxxxx) used for ?issue= deep-links and
    // comments/corrections/acknowledgments lookups.
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
  const sheetSummary = (run.summary as { sheets?: Array<{ sheetName: string; rowCount: number; flaggedCount: number }> }).sheets ?? [];
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

async function mapApiFileToWorkbookFile(file: ApiFileSummary): Promise<WorkbookFile> {
  const rawData = (await getWorkbookRawData(file.id)) ?? {};
  // Re-derive sheet statuses from local rawData so parser improvements take
  // effect without re-upload; preserve per-sheet isSelected from API.
  const hasRawData = Object.keys(rawData).length > 0;
  const freshSheets = hasRawData ? detectWorkbookSheets(rawData) : null;
  const apiSheetMap = new Map(file.sheets.map((s) => [s.name, s]));
  const sheets = (freshSheets ?? file.sheets.map((sheet) => ({
    name: sheet.name,
    status: sheet.status,
    rowCount: sheet.rowCount,
    isSelected: sheet.isSelected,
    ...(sheet.headerRowIndex !== null ? { headerRowIndex: sheet.headerRowIndex } : {}),
    ...(sheet.originalHeaders !== undefined ? { originalHeaders: sheet.originalHeaders } : {}),
    ...(sheet.normalizedHeaders !== undefined ? { normalizedHeaders: sheet.normalizedHeaders } : {}),
  }))).map((sheet) => {
    if (!freshSheets) return sheet;
    const api = apiSheetMap.get(sheet.name);
    return {
      ...sheet,
      // For newly-valid sheets preserve prior selection; invalid sheets deselect.
      isSelected: sheet.status === 'valid' ? (api?.isSelected ?? true) : false,
    };
  });
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
    sheets,
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
      auditRunKey: null,
      uploads: {},
      fileDrafts: {},
      saveAsNewRequestCount: 0,
      requestSaveAsNewVersion: () => {
        set((state) => ({ saveAsNewRequestCount: state.saveAsNewRequestCount + 1 }));
      },

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
        // Clear any stale result from a previous function so the results tab
        // never shows another function's audit while the new workspace loads.
        set({ currentAuditResult: null });
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
            // Parse locally first for a deterministic temp id; server echoes
            // clientTempId so we can rekey the IDB cache to the server id.
            const parsed = await parseWorkbook(file);
            await putWorkbookRawData(parsed.id, parsed.rawData);
            const apiFile = await uploadFileToApi(target.displayCode, fid, file, {
              clientTempId: parsed.id,
            });
            // Rekey IDB cache from temp id to server id so reload hydration
            // finds the parsed rawData (fix for #63 hydration bug).
            if (apiFile.id !== parsed.id) {
              await renameWorkbookRawDataKey(parsed.id, apiFile.id);
            }
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
            // Local-only legacy path: everything stays in the browser.
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
        // Fire-and-forget server delete; if it fails the file reappears on reload.
        if (target?.serverBacked && file) {
          const ref = (file as { displayCode?: string }).displayCode ?? fileId;
          void deleteFileOnApi(ref).catch((err) => {
            toast.error(err instanceof Error ? `File not deleted on server: ${err.message}` : 'File not deleted on server');
          });
        }
        void deleteWorkbookRawData(fileId);
        set((state) => ({
          currentAuditResult: state.currentAuditResult?.fileId === fileId ? null : state.currentAuditResult,
          processes: patchProcess(state.processes, processId, (process) => {
            const files = process.files.filter((file) => file.id !== fileId);
            const updated: AuditProcess = {
              ...process,
              files,
              activeFileId: process.activeFileId === fileId ? files[0]?.id ?? null : process.activeFileId,
              updatedAt: new Date().toISOString(),
            };
            if (process.latestAuditResult?.fileId === fileId) {
              delete updated.latestAuditResult;
            }
            return updated;
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

      runAudit: async (processId, fileId, runOptions) => {
        const process = get().processes.find((item) => item.id === processId);
        const file = process?.files.find((item) => item.id === fileId);
        if (!process || !file) {
          // Resource vanished between dispatch and handler (file deleted /
          // navigation mid-flight). Button-gating should have prevented this.
          return;
        }
        const selected = file.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected);
        if (!selected.length) {
          // Explicit throw so callers can toast — previously a silent return
          // caused the "Re-run does nothing / UI stays static" bug.
          throw new Error('No sheets selected for audit. Select at least one sheet and try again.');
        }

        // Claim this run; earlier in-flight runs with a different key bail.
        const runKey = createId();
        set({
          isAuditRunning: true,
          auditProgressText: `Auditing sheet 1 of ${selected.length}...`,
          auditRunKey: runKey,
        });

        // True iff this is still the active run; on false, drop the result.
        const stillActive = () => get().auditRunKey === runKey;

        const fileDisplayCode = (file as { displayCode?: string }).displayCode;
        const useServer = Boolean(process.serverBacked && process.displayCode && fileDisplayCode);

        // Autosave creates V1 once as a silent anchor. After V1 exists, runs
        // flip hasUnsavedAudit until the user clicks Save (updates V1) or
        // Save-as-new (creates V2). The anchor comparison guards against a
        // stale run committing over a newer one's findings.
        const autoSaveAfterRun = (anchorResult: AuditResult) => {
          const current = get().processes.find((p) => p.id === processId);
          if (!current) return;
          const latest = current.latestAuditResult;
          if (!latest || latest.runAt !== anchorResult.runAt || latest.fileId !== anchorResult.fileId) {
            // Newer run already committed; don't overwrite the anchor.
            return;
          }
          if (current.versions.length > 0) {
            // Anchor exists; Save split button handles Update / Save-as-new.
            return;
          }
          get().saveVersion(processId, {
            versionName: `${current.name} - V1`,
            notes: '',
          });
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
                patchFile({ ...item, latestAuditResult: mapped }, fileId, (currentFile) => ({
                  ...currentFile,
                  isAudited: true,
                  lastAuditedAt: mapped.runAt,
                })),
              ),
            }));
            autoSaveAfterRun(mapped);
            return;
          }
          // Local-only: run the per-function dispatcher in-browser.
          const result = await runAuditAsync(file, file.functionId, process.auditPolicy);
          if (!stillActive()) return;
          set((state) => ({
            isAuditRunning: false,
            auditProgressText: '',
            auditRunKey: null,
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
          autoSaveAfterRun(result);
        } catch (err) {
          // Only clear in-flight flag for the active run; else we'd stomp a newer one.
          if (stillActive()) {
            set({ isAuditRunning: false, auditProgressText: '', auditRunKey: null });
          }
          throw err;
        }
      },

      cancelAudit: () => {
        // Clearing the key is enough: in-flight runs see a mismatch and bail.
        set({ isAuditRunning: false, auditProgressText: '', auditRunKey: null });
      },

      hydrateLatestAuditResult: async (processId, fileId, opts) => {
        const process = get().processes.find((item) => item.id === processId || item.displayCode === processId);
        const file = process?.files.find((item) => item.id === fileId);
        if (!process || !file) return;
        // Only server-backed processes hydrate from server.
        if (!process.serverBacked) return;
        const fileDisplayCode = (file as { displayCode?: string }).displayCode ?? file.id;
        const processRef = process.displayCode ?? process.id;

        // Skip re-fetch if we already have an in-session result (runAudit's
        // post-audit hooks like directory resolution are already applied).
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
          // Non-fatal — invoked on navigation, don't toast.
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

      saveOverCurrentVersion: (processId) => {
        const current = get().processes.find((p) => p.id === processId);
        const result = get().currentAuditResult ?? current?.latestAuditResult;
        if (!result) return undefined;
        if (!current || current.versions.length === 0) {
          // First-save path when autosave hasn't created V1 (legacy state).
          return get().saveVersion(processId, {
            versionName: `${current?.name ?? 'Audit'} - V1`,
            notes: '',
          });
        }
        let updated: AuditProcess | undefined;
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const [head, ...rest] = process.versions;
            if (!head) return process;
            const refreshed = {
              ...head,
              // Keep identity fields (name, notes, createdAt, versionNumber,
              // versionId); swap only result + policy snapshot.
              result,
              auditPolicy: result.policySnapshot ?? head.auditPolicy ?? process.auditPolicy,
            };
            updated = {
              ...process,
              updatedAt: new Date().toISOString(),
              latestAuditResult: result,
              versions: [refreshed, ...rest],
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
        // Snapshot for rollback if server upsert fails; previously this was
        // swallowed and left local state out of sync until reload.
        const key = trackingKey(processId, managerEmail);
        const prior = get().processes.find((p) => p.id === processId)?.notificationTracking[key];
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          const managerKey = managerEmail.toLowerCase().trim();
          void (async () => {
            try {
              // Re-resolve at send-time in case the process was replaced.
              const fresh = serverBackedProcess(get().processes, processId);
              if (!fresh) throw new Error('Process is no longer available');
              const row = await upsertTrackingOnApi(fresh.displayCode, {
                managerKey,
                managerName,
                managerEmail,
              });
              await addTrackingEventOnApi(row.displayCode, { channel, note });
            } catch (err) {
              // Roll back the optimistic append.
              set((state) => ({
                processes: patchProcess(state.processes, processId, (process) => ({
                  ...process,
                  notificationTracking: prior
                    ? { ...process.notificationTracking, [key]: prior }
                    : (() => {
                        const next = { ...process.notificationTracking };
                        delete next[key];
                        return next;
                      })(),
                })),
              }));
              toast.error(
                err instanceof Error
                  ? `Tracking event not saved: ${err.message}`
                  : 'Tracking event not saved',
              );
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
        // Snapshot for rollback on failure.
        const key = trackingKey(processId, managerEmail);
        const prior = get().processes.find((p) => p.id === processId)?.notificationTracking[key];
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          void upsertTrackingOnApi(server.displayCode, {
            managerKey: managerEmail.toLowerCase().trim(),
            managerName,
            managerEmail,
            stage,
            resolved: stage === 'RESOLVED',
          }).catch((err) => {
            set((state) => ({
              processes: patchProcess(state.processes, processId, (process) => ({
                ...process,
                notificationTracking: prior
                  ? { ...process.notificationTracking, [key]: prior }
                  : (() => {
                      const next = { ...process.notificationTracking };
                      delete next[key];
                      return next;
                    })(),
              })),
            }));
            toast.error(
              err instanceof Error
                ? `Stage not saved: ${err.message}`
                : 'Stage not saved — reverted.',
            );
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
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          void addIssueCommentOnApi(server.displayCode, issueKey, trimmed)
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
              toast.error(err instanceof Error ? `Comment not added: ${err.message}` : 'Comment not added');
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
        if (serverBackedProcess(get().processes, processId)) {
          void deleteIssueCommentOnApi(commentId).catch((err: unknown) => {
            toast.error(err instanceof Error ? `Comment not deleted: ${err.message}` : 'Comment not deleted');
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
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          void saveIssueCorrectionOnApi(server.displayCode, issueKey, correction).catch((err: unknown) => {
            toast.error(err instanceof Error ? `Correction not saved: ${err.message}` : 'Correction not saved');
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
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          void clearIssueCorrectionOnApi(server.displayCode, issueKey).catch((err: unknown) => {
            toast.error(err instanceof Error ? `Correction not cleared: ${err.message}` : 'Correction not cleared');
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
        const server = serverBackedProcess(get().processes, processId);
        if (server) {
          void saveIssueAcknowledgmentOnApi(server.displayCode, issueKey, { status }).catch((err: unknown) => {
            toast.error(err instanceof Error ? `Acknowledgment not saved: ${err.message}` : 'Acknowledgment not saved');
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
          auditRunKey: null,
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
          // Keep local files/versions for known; drop server-backed absent from remote.
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
          // Append remote processes not yet in local store.
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
