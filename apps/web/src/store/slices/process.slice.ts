/**
 * Process slice — process list, activeProcessId, and all process CRUD actions.
 *
 * The slice is a plain factory function that receives Zustand's `set` and
 * `get` helpers and returns the slice state + actions. It is composed into
 * the root store by store/index.ts via `create()`.
 */
import type { StateCreator } from 'zustand';
import type { AuditProcess } from '../../lib/types';
import type { AppStore } from '../types';
import {
  createProcessOnApi,
  deleteProcessOnApi,
  fetchProcessesFromApi,
  updateProcessOnApi,
} from '../../lib/api/processesApi';
import { loadProcessesFromLocalDb, rememberActiveProcess, saveProcessesToLocalDb } from '../../lib/storage';

// Inline helper — avoids a circular import with the root store utilities.
function patchProcess(
  processes: AuditProcess[],
  processId: string,
  updater: (p: AuditProcess) => AuditProcess,
): AuditProcess[] {
  return processes.map((p) => (p.id === processId ? updater(p) : p));
}

export type ProcessSlice = Pick<
  AppStore,
  | 'processes'
  | 'activeProcessId'
  | 'saveAsNewRequestCount'
  | 'hydrateProcesses'
  | 'createProcess'
  | 'updateProcess'
  | 'deleteProcess'
  | 'setActiveProcess'
  | 'saveVersion'
  | 'saveOverCurrentVersion'
  | 'requestSaveAsNewVersion'
  | 'loadVersion'
  | 'reconcileProcessesFromServer'
  | 'evictProcess'
>;

export const createProcessSlice: StateCreator<AppStore, [], [], ProcessSlice> = (set, get) => ({
  processes: [],
  activeProcessId: null,
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
    const { deleteWorkbookRawData } = await import('../../lib/blobStore');
    const proc = get().processes.find((item) => item.id === processId);
    if (proc?.serverBacked && (proc.displayCode ?? proc.id)) {
      await deleteProcessOnApi(proc.displayCode ?? proc.id);
    }
    if (proc) {
      for (const file of proc.files) void deleteWorkbookRawData(file.id);
    }
    set((state) => {
      const processes = state.processes.filter((p) => p.id !== processId);
      const activeProcessId =
        state.activeProcessId === processId ? (processes[0]?.id ?? null) : state.activeProcessId;
      rememberActiveProcess(activeProcessId);
      return { processes, activeProcessId, currentAuditResult: null };
    });
    await saveProcessesToLocalDb(get().processes);
  },

  setActiveProcess: (processId) => {
    set({ activeProcessId: processId, activeWorkspaceTab: 'preview', currentAuditResult: null });
    rememberActiveProcess(processId);
  },

  saveVersion: (processId, details) => {
    const processForResult = get().processes.find((p) => p.id === processId);
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
    const version = get()
      .processes.find((p) => p.id === processId)
      ?.versions.find((v) => v.id === versionId || v.versionId === versionId);
    if (version) set({ currentAuditResult: version.result, activeWorkspaceTab: 'results' });
  },

  reconcileProcessesFromServer: (remote) => {
    set((state) => {
      const remoteById = new Map(remote.map((p) => [p.id, p]));
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
      for (const p of remote) {
        if (!merged.some((m) => m.id === p.id)) merged.push(p);
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

  evictProcess: (processId) => {
    set((state) => {
      const processes = state.processes.filter((p) => p.id !== processId);
      const activeProcessId =
        state.activeProcessId === processId ? (processes[0]?.id ?? null) : state.activeProcessId;
      rememberActiveProcess(activeProcessId);
      void saveProcessesToLocalDb(processes);
      return {
        processes,
        activeProcessId,
        ...(state.activeProcessId === processId ? { currentAuditResult: null } : {}),
      };
    });
  },
});
