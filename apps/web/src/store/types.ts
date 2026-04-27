/**
 * Shared type interfaces for all Zustand store slices.
 * Centralised here so each slice file stays under the 200-line budget.
 */
import type {
  AcknowledgmentStatus,
  AuditPolicy,
  AuditProcess,
  AuditResult,
  FileDraftMetadata,
  IssueCorrection,
  NotificationComposeTemplate,
  NotificationTheme,
  ProjectTrackingStatus,
  TrackingChannel,
  WorkbookFile,
  WorkspaceTab,
} from '../lib/types';
import type { EscalationStage, FunctionId } from '@ses/domain';
import type { MappingSourceInput } from '../lib/api/auditsApi';

export type UploadState = {
  fileName: string;
  progress: number;
  status: 'uploading' | 'complete' | 'failed';
  error?: string;
};

// ---------------------------------------------------------------------------
// Slice state shapes
// ---------------------------------------------------------------------------

export interface ProcessSliceState {
  processes: AuditProcess[];
  activeProcessId: string | null;
  saveAsNewRequestCount: number;
}

export interface ProcessSliceActions {
  hydrateProcesses: () => Promise<void>;
  createProcess: (name: string, description: string) => Promise<AuditProcess>;
  updateProcess: (id: string, patch: Partial<AuditProcess>) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
  setActiveProcess: (id: string) => void;
  saveVersion: (processId: string, details: { versionName: string; notes: string }) => AuditProcess | undefined;
  saveOverCurrentVersion: (processId: string) => AuditProcess | undefined;
  requestSaveAsNewVersion: () => void;
  loadVersion: (processId: string, versionId: string) => void;
  reconcileProcessesFromServer: (remote: AuditProcess[]) => void;
  evictProcess: (id: string) => void;
}

export interface WorkspaceSliceState {
  activeWorkspaceTab: WorkspaceTab;
}

export interface WorkspaceSliceActions {
  hydrateFunctionWorkspace: (processId: string, functionId: FunctionId) => Promise<void>;
  setActiveFile: (processId: string, fileId: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  resetWorkspaceAfterUserSwitch: () => void;
}

export interface AuditSliceState {
  currentAuditResult: AuditResult | null;
  isAuditRunning: boolean;
  auditProgressText: string;
  auditRunKey: string | null;
}

export interface AuditSliceActions {
  updateAuditPolicy: (processId: string, patch: Partial<AuditPolicy>) => void;
  resetAuditPolicy: (processId: string) => void;
  runAudit: (processId: string, fileId: string, runOptions?: { mappingSource?: MappingSourceInput }) => Promise<void>;
  cancelAudit: () => void;
  hydrateLatestAuditResult: (processId: string, fileId: string, opts?: { force?: boolean }) => Promise<void>;
  currentAuditResultForFile: (processId: string, fileId: string) => AuditResult | null;
}

export interface TrackingSliceActions {
  recordTrackingEvent: (
    processId: string,
    managerName: string,
    managerEmail: string,
    flaggedProjectCount: number,
    channel: TrackingChannel,
    note: string,
  ) => void;
  setTrackingStage: (
    processId: string,
    managerName: string,
    managerEmail: string,
    flaggedProjectCount: number,
    stage: EscalationStage,
  ) => void;
  markTrackingResolved: (processId: string, managerEmail: string) => void;
  reopenTracking: (processId: string, managerEmail: string) => void;
  updateProjectStatus: (
    processId: string,
    managerEmail: string,
    projectNo: string,
    patch: Partial<Pick<ProjectTrackingStatus, 'stage' | 'feedback'>>,
    note?: string,
  ) => void;
}

export interface NotificationSliceActions {
  saveTemplate: (processId: string, name: string, theme: NotificationTheme, template: NotificationComposeTemplate) => void;
  loadTemplate: (processId: string, name: string) => NotificationComposeTemplate | null;
  deleteTemplate: (processId: string, name: string) => void;
}

export interface FileSliceState {
  uploads: Record<string, UploadState>;
  fileDrafts: Record<string, FileDraftMetadata>;
}

export interface FileSliceActions {
  uploadFile: (processId: string, file: File, functionId?: FunctionId) => Promise<void>;
  saveFileDraft: (processId: string, functionId: FunctionId, file: File, opts?: { beacon?: boolean }) => Promise<void>;
  discardFileDraft: (processId: string, functionId: FunctionId) => Promise<void>;
  promoteFileDraft: (processId: string, functionId: FunctionId, note?: string) => Promise<void>;
  deleteFile: (processId: string, fileId: string) => void;
  toggleSheet: (processId: string, fileId: string, sheetName: string) => void;
  selectAllValidSheets: (processId: string, fileId: string) => void;
  clearSheetSelection: (processId: string, fileId: string) => void;
}

export interface IssueSliceActions {
  addIssueComment: (processId: string, issueKey: string, body: string, author?: string) => void;
  deleteIssueComment: (processId: string, issueKey: string, commentId: string) => void;
  saveIssueCorrection: (processId: string, issueKey: string, correction: Omit<IssueCorrection, 'issueKey' | 'processId' | 'updatedAt'>) => void;
  clearIssueCorrection: (processId: string, issueKey: string) => void;
  setIssueAcknowledgment: (processId: string, issueKey: string, status: AcknowledgmentStatus) => void;
  clearIssueAcknowledgment: (processId: string, issueKey: string) => void;
}

// ui.slice currently has no extra state beyond what's already in the store,
// but is included as a hook point for future panel / modal state.
export interface UiSliceState {
  sidebarCollapsed: boolean;
}

export interface UiSliceActions {
  setSidebarCollapsed: (collapsed: boolean) => void;
}

// ---------------------------------------------------------------------------
// Combined shape — the single flat object every slice contributes to.
// This is the canonical AppStore type used by create() and all consumers.
// ---------------------------------------------------------------------------
export type AppStore =
  ProcessSliceState &
  ProcessSliceActions &
  WorkspaceSliceState &
  WorkspaceSliceActions &
  AuditSliceState &
  AuditSliceActions &
  TrackingSliceActions &
  NotificationSliceActions &
  FileSliceState &
  FileSliceActions &
  IssueSliceActions &
  UiSliceState &
  UiSliceActions;
