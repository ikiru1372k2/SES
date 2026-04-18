import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../lib/auditPolicy';
import { runAuditAsync } from '../lib/auditRunner';
import { deleteWorkbookRawData, putWorkbookRawData } from '../lib/blobStore';
import { parseWorkbook } from '../lib/excelParser';
import { createId } from '../lib/id';
import { createProcessOnApi, deleteProcessOnApi, fetchProcessesFromApi, updateProcessOnApi } from '../lib/api/processesApi';
import { DATA_KEY, loadProcessesFromLocalDb, rememberActiveProcess, saveProcessesToLocalDb } from '../lib/storage';
import { makeDefaultTrackingEntry, trackingKey } from '../lib/tracking';
import type {
  AcknowledgmentStatus,
  AuditPolicy,
  AuditProcess,
  AuditResult,
  IssueAcknowledgment,
  IssueComment,
  IssueCorrection,
  NotificationTemplate,
  NotificationTheme,
  ProjectTrackingStatus,
  TrackingChannel,
  TrackingEntry,
  TrackingStage,
  WorkbookFile,
  WorkspaceTab,
} from '../lib/types';

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
  hydrateProcesses: () => Promise<void>;
  createProcess: (name: string, description: string) => Promise<AuditProcess>;
  updateProcess: (id: string, patch: Partial<AuditProcess>) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
  setActiveProcess: (id: string) => void;
  uploadFile: (processId: string, file: File) => Promise<void>;
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
  setTrackingStage: (processId: string, managerName: string, managerEmail: string, flaggedProjectCount: number, stage: TrackingStage) => void;
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
  saveTemplate: (processId: string, name: string, theme: NotificationTheme, template: NotificationTemplate) => void;
  loadTemplate: (processId: string, name: string) => NotificationTemplate | null;
  deleteTemplate: (processId: string, name: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  resetWorkspaceAfterUserSwitch: () => void;
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

      hydrateProcesses: () => {
        return (async () => {
          try {
            const remote = await fetchProcessesFromApi();
            if (remote !== null) {
              set({ processes: remote });
              await saveProcessesToLocalDb(remote);
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

      uploadFile: async (processId, file) => {
        const uploadId = createId(`${processId}-${file.name}`);
        set((state) => ({ uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 20, status: 'uploading' } } }));
        try {
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

      setActiveFile: (processId, fileId) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({ ...process, activeFileId: fileId })),
          activeWorkspaceTab: 'preview',
          currentAuditResult: null,
        }));
      },

      deleteFile: (processId, fileId) => {
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
        const result = await runAuditAsync(file, process.auditPolicy);
        set((state) => ({
          isAuditRunning: false,
          auditProgressText: '',
          currentAuditResult: result,
          activeWorkspaceTab: 'results',
          processes: patchProcess(state.processes, processId, (item) =>
            patchFile({ ...item, latestAuditResult: result }, fileId, (currentFile) => ({ ...currentFile, isAudited: true, lastAuditedAt: result.runAt })),
          ),
        }));
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
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            const outlookCount = (current?.outlookCount ?? 0) + (channel === 'outlook' || channel === 'eml' || channel === 'sendAll' ? 1 : 0);
            const teamsCount = (current?.teamsCount ?? 0) + (channel === 'teams' ? 1 : 0);
            const stage = current?.resolved
              ? 'Resolved'
              : teamsCount > 0
                ? 'Teams escalated'
                : outlookCount >= 2
                  ? 'Reminder 2 sent'
                  : outlookCount === 1
                    ? 'Reminder 1 sent'
                    : 'Not contacted';
            const base = makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
            const entry: TrackingEntry = {
              ...base,
              outlookCount,
              teamsCount,
              lastContactAt: now,
              stage,
              resolved: current?.resolved ?? false,
              history: [...(current?.history ?? []), { channel, at: now, note }],
              projectStatuses: current?.projectStatuses ?? {},
            };
            return { ...process, notificationTracking: { ...process.notificationTracking, [key]: entry }, updatedAt: now };
          }),
        }));
      },

      setTrackingStage: (processId, managerName, managerEmail, flaggedProjectCount, stage) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = trackingKey(processId, managerEmail);
            const current = process.notificationTracking[key];
            const base = current ?? makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
            const countsByStage: Record<TrackingStage, Pick<TrackingEntry, 'outlookCount' | 'teamsCount' | 'resolved'>> = {
              'Not contacted': { outlookCount: 0, teamsCount: 0, resolved: false },
              'Reminder 1 sent': { outlookCount: Math.max(base.outlookCount, 1), teamsCount: 0, resolved: false },
              'Reminder 2 sent': { outlookCount: Math.max(base.outlookCount, 2), teamsCount: 0, resolved: false },
              'Teams escalated': { outlookCount: Math.max(base.outlookCount, 1), teamsCount: Math.max(base.teamsCount, 1), resolved: false },
              Resolved: { outlookCount: base.outlookCount, teamsCount: base.teamsCount, resolved: true },
            };
            const nextCounts = countsByStage[stage];
            const entry: TrackingEntry = {
              ...base,
              managerName,
              managerEmail,
              flaggedProjectCount,
              ...nextCounts,
              stage,
              lastContactAt: stage === 'Not contacted' ? null : now,
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
                  stage: 'Resolved',
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
            const stage = current.teamsCount > 0 ? 'Teams escalated' : current.outlookCount >= 2 ? 'Reminder 2 sent' : current.outlookCount === 1 ? 'Reminder 1 sent' : 'Not contacted';
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
        const comment: IssueComment = {
          id: createId('comment'),
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
            const existingStatus = current.projectStatuses?.[projectNo] ?? {
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
              history:
                stageChanged || note
                  ? [...existingStatus.history, { channel: 'manual' as const, at: now, note: note ?? `Stage: ${newStage}` }]
                  : existingStatus.history,
              updatedAt: now,
            };
            return {
              ...process,
              notificationTracking: {
                ...process.notificationTracking,
                [key]: {
                  ...current,
                  projectStatuses: { ...(current.projectStatuses ?? {}), [projectNo]: updated },
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
        });
      },
    }),
    {
      name: DATA_KEY,
      storage: browserStorage,
      partialize: (state) => ({ processes: state.processes }) as AppStore,
    },
  ),
);

export type { AppStore, UploadState };
