/**
 * Workspace slice — active tab, file hydration, and workspace reset.
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from '../types';
import { DEFAULT_FUNCTION_ID, type FunctionId } from '@ses/domain';
import { listFilesOnApi } from '../../lib/api/filesApi';
import { listFileVersionsOnApi } from '../../lib/api/fileVersionsApi';
import { getFileDraftOnApi } from '../../lib/api/fileDraftsApi';
import { getWorkbookRawData } from '../../lib/blobStore';
import { detectWorkbookSheets } from '../../lib/excelParser';
import { saveProcessesToLocalDb, rememberActiveProcess } from '../../lib/storage';
import type { FileDraftMetadata, WorkbookFile } from '../../lib/types';
import type { ApiFileSummary } from '../../lib/api/filesApi';

export type WorkspaceSlice = Pick<
  AppStore,
  | 'activeWorkspaceTab'
  | 'hydrateFunctionWorkspace'
  | 'setActiveFile'
  | 'setWorkspaceTab'
  | 'resetWorkspaceAfterUserSwitch'
>;

function draftKey(processId: string, functionId: FunctionId): string {
  return `${processId}:${functionId}`;
}

export async function mapApiFileToWorkbookFile(file: ApiFileSummary): Promise<WorkbookFile> {
  const rawData = (await getWorkbookRawData(file.id)) ?? {};
  const hasRawData = Object.keys(rawData).length > 0;
  const freshSheets = hasRawData ? detectWorkbookSheets(rawData) : null;
  const apiSheetMap = new Map(file.sheets.map((s) => [s.name, s]));
  const sheets = (
    freshSheets ??
    file.sheets.map((sheet) => ({
      name: sheet.name,
      status: sheet.status,
      rowCount: sheet.rowCount,
      isSelected: sheet.isSelected,
      ...(sheet.headerRowIndex !== null ? { headerRowIndex: sheet.headerRowIndex } : {}),
      ...(sheet.originalHeaders !== undefined ? { originalHeaders: sheet.originalHeaders } : {}),
      ...(sheet.normalizedHeaders !== undefined ? { normalizedHeaders: sheet.normalizedHeaders } : {}),
    }))
  ).map((sheet) => {
    if (!freshSheets) return sheet;
    const api = apiSheetMap.get(sheet.name);
    return {
      ...sheet,
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

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

let saveTimer: number | undefined;

function cancelDebouncedWorkspaceSave(): void {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

export const createWorkspaceSlice: StateCreator<AppStore, [], [], WorkspaceSlice> = (set, get) => ({
  activeWorkspaceTab: 'preview',

  hydrateFunctionWorkspace: async (processId, functionId) => {
    const process = get().processes.find(
      (item) => item.id === processId || item.displayCode === processId,
    );
    if (!process) return;
    set({ currentAuditResult: null });
    const processRef = process.displayCode ?? process.id;
    const [apiFiles, draft] = await Promise.all([
      listFilesOnApi(processRef, functionId),
      getFileDraftOnApi(processRef, functionId).catch(
        () => ({ hasDraft: false } satisfies FileDraftMetadata),
      ),
    ]);
    const mapped = await Promise.all(
      apiFiles.map(async (file) => {
        const base = await mapApiFileToWorkbookFile(file);
        const versions = await listFileVersionsOnApi(file.displayCode ?? file.id).catch(() => []);
        return { ...base, fileVersions: versions };
      }),
    );
    set((state) => ({
      fileDrafts: {
        ...state.fileDrafts,
        [draftKey(process.id, functionId)]: draft,
      },
      processes: patchProcess(state.processes, process.id, (current) => {
        const otherFiles = current.files.filter(
          (file) => (file.functionId ?? DEFAULT_FUNCTION_ID) !== functionId,
        );
        const activeStillPresent = mapped.some((file) => file.id === current.activeFileId);
        return {
          ...current,
          files: [...otherFiles, ...mapped],
          activeFileId: activeStillPresent
            ? current.activeFileId
            : (mapped[0]?.id ?? current.activeFileId),
        };
      }),
    }));
    await saveProcessesToLocalDb(get().processes);
  },

  setActiveFile: (processId, fileId) => {
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        activeFileId: fileId,
      })),
      activeWorkspaceTab: 'preview',
      currentAuditResult: null,
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
});
