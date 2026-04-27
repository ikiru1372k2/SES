/**
 * Notification slice — saved compose templates (per process).
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from '../types';

export type NotificationSlice = Pick<
  AppStore,
  'saveTemplate' | 'loadTemplate' | 'deleteTemplate'
>;

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

export const createNotificationSlice: StateCreator<AppStore, [], [], NotificationSlice> = (set, get) => ({
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
});
