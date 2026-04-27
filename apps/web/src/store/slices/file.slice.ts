/**
 * File slice — uploads, file drafts, sheet toggles, and file CRUD.
 */
import type { StateCreator } from 'zustand';
import toast from 'react-hot-toast';
import { DEFAULT_FUNCTION_ID, type FunctionId } from '@ses/domain';
import type { AppStore } from '../types';
import { uploadFileToApi, deleteFileOnApi, type ApiFileSummary } from '../../lib/api/filesApi';
import { deleteFileDraftOnApi, getFileDraftOnApi, promoteFileDraftOnApi, saveFileDraftOnApi } from '../../lib/api/fileDraftsApi';
import { deleteWorkbookRawData, putWorkbookRawData, renameWorkbookRawDataKey } from '../../lib/blobStore';
import { parseWorkbook } from '../../lib/excelParser';
import { createId } from '../../lib/id';
import type { WorkbookFile } from '../../lib/types';

export type FileSlice = Pick<
  AppStore,
  | 'uploads'
  | 'fileDrafts'
  | 'uploadFile'
  | 'saveFileDraft'
  | 'discardFileDraft'
  | 'promoteFileDraft'
  | 'deleteFile'
  | 'toggleSheet'
  | 'selectAllValidSheets'
  | 'clearSheetSelection'
>;

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

function patchFile(
  process: AppStore['processes'][number],
  fileId: string,
  updater: (f: WorkbookFile) => WorkbookFile,
): AppStore['processes'][number] {
  return {
    ...process,
    files: process.files.map((f) => (f.id === fileId ? updater(f) : f)),
    updatedAt: new Date().toISOString(),
  };
}

function draftKey(processId: string, functionId: FunctionId): string {
  return `${processId}:${functionId}`;
}

export const createFileSlice: StateCreator<AppStore, [], [], FileSlice> = (set, get) => ({
  uploads: {},
  fileDrafts: {},

  uploadFile: async (processId, file, functionId) => {
    const fid: FunctionId = functionId ?? DEFAULT_FUNCTION_ID;
    const uploadId = createId(`${processId}-${file.name}`);
    const target = get().processes.find((p) => p.id === processId);
    set((state) => ({
      uploads: { ...state.uploads, [uploadId]: { fileName: file.name, progress: 20, status: 'uploading' } },
    }));
    try {
      if (target?.serverBacked && target.displayCode) {
        const parsed = await parseWorkbook(file);
        await putWorkbookRawData(parsed.id, parsed.rawData);
        const apiFile = await uploadFileToApi(target.displayCode, fid, file, { clientTempId: parsed.id });
        if (apiFile.id !== parsed.id) await renameWorkbookRawDataKey(parsed.id, apiFile.id);
        const mergedSheets = parsed.sheets.map((s) => {
          const api = (apiFile as ApiFileSummary).sheets.find((x) => x.name === s.name);
          return api ? { ...s, serverDisplayCode: api.displayCode, serverSheetId: api.id } : s;
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
          fileDrafts: Object.fromEntries(
            Object.entries(state.fileDrafts).filter(([k]) => k !== draftKey(processId, fid)),
          ),
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            activeFileId: process.activeFileId ?? merged.id,
            files: [...process.files, merged],
            updatedAt: new Date().toISOString(),
          })),
        }));
      } else {
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
      window.setTimeout(() => {
        set((state) => {
          const next = { ...state.uploads };
          delete next[uploadId];
          return { uploads: next };
        });
      }, 900);
    } catch (error) {
      set((state) => ({
        uploads: {
          ...state.uploads,
          [uploadId]: {
            fileName: file.name,
            progress: 100,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed',
          },
        },
      }));
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

  deleteFile: (processId, fileId) => {
    const target = get().processes.find((p) => p.id === processId);
    const file = target?.files.find((f) => f.id === fileId);
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
        const files = process.files.filter((f) => f.id !== fileId);
        const updated = {
          ...process,
          files,
          activeFileId: process.activeFileId === fileId ? (files[0]?.id ?? null) : process.activeFileId,
          updatedAt: new Date().toISOString(),
        };
        if (process.latestAuditResult?.fileId === fileId) delete (updated as { latestAuditResult?: unknown }).latestAuditResult;
        return updated;
      }),
    }));
  },

  toggleSheet: (processId, fileId, sheetName) => {
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) =>
        patchFile(process, fileId, (file) => ({
          ...file,
          sheets: file.sheets.map((sheet) =>
            sheet.name === sheetName && sheet.status === 'valid'
              ? { ...sheet, isSelected: !sheet.isSelected }
              : sheet,
          ),
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
        patchFile(process, fileId, (file) => ({
          ...file,
          sheets: file.sheets.map((sheet) => ({ ...sheet, isSelected: false })),
          isAudited: false,
        })),
      ),
    }));
  },
});
