import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { createDefaultAuditPolicy, normalizeAuditPolicy } from '../lib/auditPolicy';
import { runAudit as executeAudit } from '../lib/auditEngine';
import { parseWorkbook } from '../lib/excelParser';
import { createId } from '../lib/id';
import { DATA_KEY, loadProcesses, loadProcessesFromLocalDb, rememberActiveProcess, saveProcessesToLocalDb } from '../lib/storage';
import type { AuditPolicy, AuditProcess, AuditResult, TrackingChannel, TrackingEntry, WorkbookFile, WorkspaceTab } from '../lib/types';

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
  hydrateProcesses: () => void;
  createProcess: (name: string, description: string) => AuditProcess;
  updateProcess: (id: string, patch: Partial<AuditProcess>) => void;
  deleteProcess: (id: string) => void;
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
  markTrackingResolved: (processId: string, managerEmail: string) => void;
  reopenTracking: (processId: string, managerEmail: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
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
        void loadProcessesFromLocalDb().then((processes) => {
          if (processes.length) set({ processes });
        });
      },

      createProcess: (name, description) => {
        const process: AuditProcess = {
          id: createId(),
          name: name.trim(),
          description: description.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          files: [],
          activeFileId: null,
          versions: [],
          latestAuditResult: undefined,
          auditPolicy: createDefaultAuditPolicy(),
          notificationTracking: {},
        };
        set((state) => ({ processes: [process, ...state.processes], activeProcessId: process.id, activeWorkspaceTab: 'preview', currentAuditResult: null }));
        rememberActiveProcess(process.id);
        return process;
      },

      updateProcess: (processId, patch) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({ ...process, ...patch, updatedAt: new Date().toISOString() })),
        }));
      },

      deleteProcess: (processId) => {
        set((state) => {
          const processes = state.processes.filter((process) => process.id !== processId);
          const activeProcessId = state.activeProcessId === processId ? processes[0]?.id ?? null : state.activeProcessId;
          rememberActiveProcess(activeProcessId);
          return { processes, activeProcessId, currentAuditResult: null };
        });
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
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        const result = executeAudit(file, process.auditPolicy);
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
        const result = get().currentAuditResult;
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
            const key = `${processId}:${managerEmail}`;
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
            const entry: TrackingEntry = {
              key,
              processId,
              managerName,
              managerEmail,
              flaggedProjectCount,
              outlookCount,
              teamsCount,
              lastContactAt: now,
              stage,
              resolved: current?.resolved ?? false,
              history: [...(current?.history ?? []), { channel, at: now, note }],
            };
            return { ...process, notificationTracking: { ...process.notificationTracking, [key]: entry }, updatedAt: now };
          }),
        }));
      },

      markTrackingResolved: (processId, managerEmail) => {
        const now = new Date().toISOString();
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => {
            const key = `${processId}:${managerEmail}`;
            const current = process.notificationTracking[key];
            const entry: TrackingEntry = current ?? {
              key,
              processId,
              managerName: managerEmail.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Unassigned',
              managerEmail,
              flaggedProjectCount: 0,
              outlookCount: 0,
              teamsCount: 0,
              lastContactAt: null,
              stage: 'Not contacted',
              resolved: false,
              history: [],
            };
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
            const key = `${processId}:${managerEmail}`;
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

      setWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),
    }),
    {
      name: DATA_KEY,
      storage: browserStorage,
      partialize: (state) => ({ processes: state.processes }) as AppStore,
    },
  ),
);

export type { AppStore, UploadState };
