/**
 * Root store — composes all slices into one flat Zustand store and
 * re-exports `useAppStore` so every existing consumer continues to work
 * without any import changes.
 *
 * Persistence is identical to the original monolithic store:
 *   - Custom `browserStorage` backed by IndexedDB (loadProcessesFromLocalDb)
 *   - Only `processes` is persisted (partialize)
 *   - Version 1 with a migrate guard
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { DATA_KEY, loadProcessesFromLocalDb, saveProcessesToLocalDb } from '../lib/storage';
import type { AppStore } from './types';
import { createProcessSlice } from './slices/process.slice';
import { createWorkspaceSlice } from './slices/workspace.slice';
import { createAuditSlice } from './slices/audit.slice';
import { createTrackingSlice } from './slices/tracking.slice';
import { createNotificationSlice } from './slices/notification.slice';
import { createFileSlice } from './slices/file.slice';
import { createIssueSlice } from './slices/issue.slice';
import { createUiSlice } from './slices/ui.slice';

// ---------------------------------------------------------------------------
// Custom persistence layer — mirrors the original store's storage exactly
// ---------------------------------------------------------------------------
let saveTimer: number | undefined;

function debouncedSaveProcesses(processes: AppStore['processes']): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveProcessesToLocalDb(processes);
  }, 400);
}

const browserStorage: PersistStorage<AppStore> = {
  getItem: async () => ({
    state: { processes: await loadProcessesFromLocalDb() } as AppStore,
    version: 1,
  }),
  setItem: (_name, value: StorageValue<AppStore>) => {
    debouncedSaveProcesses(value.state?.processes ?? []);
  },
  removeItem: () => localStorage.removeItem(DATA_KEY),
};

// ---------------------------------------------------------------------------
// Composed store
// ---------------------------------------------------------------------------
export const useAppStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createProcessSlice(...args),
      ...createWorkspaceSlice(...args),
      ...createAuditSlice(...args),
      ...createTrackingSlice(...args),
      ...createNotificationSlice(...args),
      ...createFileSlice(...args),
      ...createIssueSlice(...args),
      ...createUiSlice(...args),
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

// ---------------------------------------------------------------------------
// Named re-exports for slice types (for consumers that want fine-grained
// typing without importing from deep paths)
// ---------------------------------------------------------------------------
export type { AppStore, UploadState } from './types';
export { createProcessSlice } from './slices/process.slice';
export { createWorkspaceSlice } from './slices/workspace.slice';
export { createAuditSlice } from './slices/audit.slice';
export { createTrackingSlice } from './slices/tracking.slice';
export { createNotificationSlice } from './slices/notification.slice';
export { createFileSlice } from './slices/file.slice';
export { createIssueSlice } from './slices/issue.slice';
export { createUiSlice } from './slices/ui.slice';
