import { useSyncExternalStore } from 'react';
import type { FunctionId } from '@ses/domain';
import type { AuditProcess, FileDraftMetadata, AuditResult, WorkspaceTab } from '../src/lib/types';
import { vi } from 'vitest';

type MockSnap = {
  processes: AuditProcess[];
  activeProcessId: string | null;
  activeWorkspaceTab: WorkspaceTab;
  currentAuditResult: AuditResult | null;
  isAuditRunning: boolean;
  auditProgressText: string;
  uploads: Record<string, { fileName: string; progress: number; status: 'uploading' | 'complete' | 'failed'; error?: string }>;
  fileDrafts: Record<string, FileDraftMetadata>;
  hydrateProcesses: () => Promise<void>;
  hydrateFunctionWorkspace: (processId: string, functionId: FunctionId) => Promise<void>;
  createProcess: () => Promise<AuditProcess>;
  updateProcess: () => Promise<void>;
  deleteProcess: () => Promise<void>;
  setActiveProcess: () => void;
  uploadFile: () => Promise<void>;
  saveFileDraft: () => Promise<void>;
  discardFileDraft: () => Promise<void>;
  promoteFileDraft: () => Promise<void>;
  setActiveFile: () => void;
  deleteFile: () => void;
  toggleSheet: () => void;
  selectAllValidSheets: () => void;
  clearSheetSelection: () => void;
  currentAuditResultForFile: () => AuditResult | null;
  updateAuditPolicy: () => void;
  resetAuditPolicy: () => void;
  runAudit: () => Promise<void>;
  saveVersion: () => AuditProcess | undefined;
  loadVersion: () => void;
  recordTrackingEvent: () => void;
  setTrackingStage: () => void;
  markTrackingResolved: () => void;
  reopenTracking: () => void;
  addIssueComment: () => void;
  deleteIssueComment: () => void;
  saveIssueCorrection: () => void;
  clearIssueCorrection: () => void;
  setIssueAcknowledgment: () => void;
  clearIssueAcknowledgment: () => void;
  updateProjectStatus: () => void;
  saveTemplate: () => void;
  loadTemplate: () => null;
  deleteTemplate: () => void;
  setWorkspaceTab: () => void;
  resetWorkspaceAfterUserSwitch: () => void;
  reconcileProcessesFromServer: () => void;
  evictProcess: () => void;
};

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function buildSnap(): MockSnap {
  return {
    processes: [],
    activeProcessId: null,
    activeWorkspaceTab: 'preview',
    currentAuditResult: null,
    isAuditRunning: false,
    auditProgressText: '',
    uploads: {},
    fileDrafts: {},
    hydrateProcesses: vi.fn(async () => {}),
    hydrateFunctionWorkspace: vi.fn(async () => {}),
    createProcess: vi.fn(),
    updateProcess: vi.fn(),
    deleteProcess: vi.fn(),
    setActiveProcess: vi.fn(),
    uploadFile: vi.fn(),
    saveFileDraft: vi.fn(),
    discardFileDraft: vi.fn(),
    promoteFileDraft: vi.fn(),
    setActiveFile: vi.fn(),
    deleteFile: vi.fn(),
    toggleSheet: vi.fn(),
    selectAllValidSheets: vi.fn(),
    clearSheetSelection: vi.fn(),
    currentAuditResultForFile: vi.fn(() => null),
    updateAuditPolicy: vi.fn(),
    resetAuditPolicy: vi.fn(),
    runAudit: vi.fn(),
    saveVersion: vi.fn(),
    loadVersion: vi.fn(),
    recordTrackingEvent: vi.fn(),
    setTrackingStage: vi.fn(),
    markTrackingResolved: vi.fn(),
    reopenTracking: vi.fn(),
    addIssueComment: vi.fn(),
    deleteIssueComment: vi.fn(),
    saveIssueCorrection: vi.fn(),
    clearIssueCorrection: vi.fn(),
    setIssueAcknowledgment: vi.fn(),
    clearIssueAcknowledgment: vi.fn(),
    updateProjectStatus: vi.fn(),
    saveTemplate: vi.fn(),
    loadTemplate: vi.fn(() => null),
    deleteTemplate: vi.fn(),
    setWorkspaceTab: vi.fn(),
    resetWorkspaceAfterUserSwitch: vi.fn(),
    reconcileProcessesFromServer: vi.fn(),
    evictProcess: vi.fn(),
  };
}

let snap: MockSnap = buildSnap();

export function resetMockAppStore(): void {
  snap = buildSnap();
  notify();
}

export function patchMockAppStore(partial: Partial<MockSnap>): void {
  snap = { ...snap, ...partial };
  notify();
}

export function getMockAppStoreSnapshot(): MockSnap {
  return snap;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function useAppStoreImpl<T>(selector: (state: MockSnap) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snap),
    () => selector(snap),
  );
}

const useAppStore = Object.assign(useAppStoreImpl, {
  getState: (): MockSnap => snap,
  setState: (partial: Partial<MockSnap>) => {
    snap = { ...snap, ...partial };
    notify();
  },
});

export { useAppStore };
