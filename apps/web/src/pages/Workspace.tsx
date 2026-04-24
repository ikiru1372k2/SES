import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, History, Play, Save, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_FUNCTION_ID, getFunctionLabel, isFunctionId, isValidEmail, type FunctionId } from '@ses/domain';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { MembersPanel } from '../components/workspace/MembersPanel';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { DraftRestoreBanner } from '../components/workspace/DraftRestoreBanner';
import { UnsavedAuditDialog } from '../components/workspace/UnsavedAuditDialog';
import { SaveVersionModal } from '../components/workspace/SaveVersionModal';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { PresenceBar } from '../components/shared/PresenceBar';
import { useCurrentUser } from '../components/auth/authContext';
import { downloadAuditedWorkbook } from '../lib/excelParser';
import type { MappingSourceInput } from '../lib/api/auditsApi';
import { selectCorrectionCount, selectHasUnsavedAudit, selectLatestAuditResult } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { isLegacyTileTrackingTabEnabled } from '../lib/featureFlags';
import { anchorResultForFile, formatDiffChips, summarizeDiff } from '../lib/versionDiff';
import { versionComparePath } from '../lib/processRoutes';
import { useRealtime } from '../realtime/useRealtime';
import { onRealtimeEvent } from '../realtime/socket';
import { directorySuggestions } from '../lib/api/directoryApi';
import { ResolutionDrawer } from '../components/directory/ResolutionDrawer';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));
const VersionHistoryTab = lazy(() =>
  import('../components/workspace/VersionHistoryTab').then((module) => ({ default: module.VersionHistoryTab })),
);
const TrackingTab = lazy(() =>
  import('../components/workspace/TrackingTab').then((module) => ({ default: module.TrackingTab })),
);

// Module-scope so it is stable across renders and usable in useCallback deps
// without churn. These functions require a manager-mapping source to run.
const MAPPING_ENABLED_FUNCTIONS: ReadonlySet<string> = new Set([
  'over-planning',
  'function-rate',
  'internal-cost-rate',
]);

export function Workspace() {
  const params = useParams<{ processId: string; functionId: string }>();
  const processId = params.processId;
  const functionId: FunctionId = isFunctionId(params.functionId) ? params.functionId : DEFAULT_FUNCTION_ID;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const hydrateFunctionWorkspace = useAppStore((state) => state.hydrateFunctionWorkspace);
  const hydrateLatestAuditResult = useAppStore((state) => state.hydrateLatestAuditResult);
  const fileDrafts = useAppStore((state) => state.fileDrafts);
  const promoteFileDraft = useAppStore((state) => state.promoteFileDraft);
  const discardFileDraft = useAppStore((state) => state.discardFileDraft);
  const tab = useAppStore((state) => state.activeWorkspaceTab);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const result = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const saveOverCurrentVersion = useAppStore((state) => state.saveOverCurrentVersion);
  const saveAsNewRequestCount = useAppStore((state) => state.saveAsNewRequestCount);
  const requestSaveAsNewVersion = useAppStore((state) => state.requestSaveAsNewVersion);

  const process = processes.find((item) => item.id === processId || item.displayCode === processId);
  const processRecordId = process?.id;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const currentUser = useCurrentUser();
  const managerDirectoryOn = currentUser?.managerDirectoryEnabled !== false;
  const tabFromUrl = searchParams.get('tab');
  const [membersOpen, setMembersOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  // Blocker handed off when the user picks "Save as new version" from the
  // unsaved-audit dialog. We defer the proceed/reset decision until the
  // SaveVersionModal resolves so navigation only continues if a version was
  // actually created; abandoning the modal rolls back to "stay on page".
  const pendingBlockerRef = useRef<{ proceed?: (() => void) | undefined; reset?: (() => void) | undefined } | null>(null);
  const modalSavedRef = useRef(false);
  const [mappingSource, setMappingSource] = useState<MappingSourceInput | undefined>(undefined);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset mapping source on function navigation
  useEffect(() => { setMappingSource(undefined); }, [functionId]);
  const hydrateAttemptedRef = useRef(false);
  const queryClient = useQueryClient();
  const [hydrateFinished, setHydrateFinished] = useState(false);
  const hydrating = !process && !hydrateFinished;

  useEffect(() => {
    if (saveAsNewRequestCount === 0 || !process) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate cross-component signal
    setVersionModalOpen(true);
  }, [saveAsNewRequestCount, process]);

  const rawManagerNames = useMemo(() => {
    if (!process) return [];
    const auditResult = result ?? process.versions[0]?.result ?? null;
    const names = new Set<string>();
    for (const issue of auditResult?.issues ?? []) {
      const n = issue.projectManager?.trim();
      if (!n) continue;
      if (!isValidEmail(issue.email)) names.add(n);
    }
    return [...names];
  }, [process, result]);

  const directorySuggestionsKey = useMemo(
    () => ['directory-suggestions', [...rawManagerNames].sort()] as const,
    [rawManagerNames],
  );
  const suggestionsQ = useQuery({
    queryKey: directorySuggestionsKey,
    queryFn: () => directorySuggestions(rawManagerNames),
    enabled: managerDirectoryOn && rawManagerNames.length > 0,
    staleTime: 60_000,
  });
  const unmappedCount =
    managerDirectoryOn && rawManagerNames.length > 0 && suggestionsQ.data
      ? rawManagerNames.filter((name) => !suggestionsQ.data.results[name]?.autoMatch).length
      : null;

  useEffect(() => {
    const off = onRealtimeEvent((envelope) => {
      if (envelope.event === 'directory.updated') {
        void queryClient.invalidateQueries({ queryKey: ['directory-suggestions'] });
      }
    });
    return off;
  }, [queryClient]);

  useEffect(() => {
    if (process || hydrateAttemptedRef.current) return;
    hydrateAttemptedRef.current = true;
    void hydrateProcesses().finally(() => setHydrateFinished(true));
  }, [process, hydrateProcesses]);

  useEffect(() => {
    if (!processRecordId) return;
    void hydrateFunctionWorkspace(processRecordId, functionId);
  }, [functionId, hydrateFunctionWorkspace, processRecordId]);

  useEffect(() => {
    if (tabFromUrl === 'results') {
      setWorkspaceTab('results');
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, setWorkspaceTab, tabFromUrl]);

  useEffect(() => {
    if (tab !== 'results') return;
    if (!processRecordId) return;
    // Only hydrate from a file that belongs to the current function — using
    // process.activeFileId directly would leak another function's file ID.
    const functionFiles = process?.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId) ?? [];
    const targetFileId = functionFiles.find((file) => file.id === process?.activeFileId)?.id ?? functionFiles[0]?.id;
    if (!targetFileId) return;
    void hydrateLatestAuditResult(processRecordId, targetFileId);
  }, [tab, processRecordId, process?.activeFileId, process?.files, functionId, hydrateLatestAuditResult]);

  const processRealtimeKey = process?.displayCode ?? process?.id ?? null;
  const { members } = useRealtime(processRealtimeKey, currentUser?.displayCode, {
    onEvicted: () => navigate('/'),
  });

  useEffect(() => {
    if (!hasUnsavedAudit) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedAudit]);

  const shouldBlock = useCallback<(args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean>(
    ({ currentLocation, nextLocation }) => {
      if (!hasUnsavedAudit) return false;
      if (currentLocation.pathname === nextLocation.pathname) return false;
      return true;
    },
    [hasUnsavedAudit],
  );
  const blocker = useBlocker(shouldBlock);

  // Derived workspace state. All header action handlers below read from
  // store state refs captured at call time so they stay stable across
  // renders (§9 of headerfix.md — the header must not re-render on every
  // keystroke in the workspace).
  const functionFiles = useMemo(
    () => (process ? process.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId) : []),
    [process, functionId],
  );
  const activeFile = functionFiles.find((file) => file.id === process?.activeFileId) ?? functionFiles[0];
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = (process?.versions.length ?? 0) > 0;
  const latestResult = result ?? (process ? selectLatestAuditResult(process) : null);
  const correctionCount = process ? selectCorrectionCount(process) : 0;
  const headVersion = process?.versions[0];
  const headVersionName = headVersion?.versionName ?? '';
  const nextVersionNumber = (process?.versions.length ?? 0) + 1;
  function isMappingSourceValid(src: MappingSourceInput | undefined): boolean {
    if (!src || src.type === 'none') return true;
    if (src.type === 'master_data_version') return Boolean(src.masterDataVersionId);
    if (src.type === 'uploaded_file') return Boolean(src.uploadId);
    return true;
  }
  const mappingSourceValid =
    !MAPPING_ENABLED_FUNCTIONS.has(activeFile?.functionId ?? '') || isMappingSourceValid(mappingSource);
  const canRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning && mappingSourceValid);
  const canSave = Boolean(process && latestResult && !isAuditRunning);
  const canDownload = Boolean(process && activeFile && latestResult && hasSavedVersion && !isAuditRunning);

  const onRunAudit = useCallback(async () => {
    if (!process || !activeFile) return;
    const priorAnchor = anchorResultForFile(process.versions, activeFile.id);
    const runOptions = MAPPING_ENABLED_FUNCTIONS.has(activeFile.functionId ?? '') && mappingSource
      ? { mappingSource }
      : undefined;
    try {
      await runAudit(process.id, activeFile.id, runOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audit failed — please try again.';
      toast.error(message);
      return;
    }
    const runResult = useAppStore.getState().currentAuditResult;
    if (!runResult) return;
    const diff = summarizeDiff(priorAnchor, runResult);
    if (diff && !diff.identical) {
      toast.success(`Audit complete - ${runResult.issues.length} findings (${formatDiffChips(diff)})`);
    } else if (diff?.identical && priorAnchor) {
      toast.success(`Audit complete - no change from last run (${runResult.issues.length} findings)`);
    } else {
      toast.success(`Audit complete - ${runResult.scannedRows} rows scanned, ${runResult.issues.length} issues found`);
    }
  }, [process, activeFile, mappingSource, runAudit]);

  const onQuickSave = useCallback(() => {
    if (!process || !latestResult) return;
    if (!headVersion) {
      const updated = saveOverCurrentVersion(process.id);
      if (updated) toast.success(`Saved as ${updated.versions[0]?.versionName ?? 'V1'}`);
      return;
    }
    const diff = summarizeDiff(headVersion.result, latestResult);
    if (diff?.identical) {
      toast(`No change since ${headVersionName}`, { icon: 'ℹ️' });
      return;
    }
    const updated = saveOverCurrentVersion(process.id);
    if (!updated) return;
    const chips = diff ? formatDiffChips(diff) : '';
    toast.success(chips ? `Saved to ${headVersionName} · ${chips}` : `Saved to ${headVersionName}`);
  }, [process, latestResult, headVersion, headVersionName, saveOverCurrentVersion]);

  const onSaveAsNew = useCallback(() => {
    setVersionModalOpen(true);
  }, []);

  const onDownload = useCallback(() => {
    if (!activeFile || !latestResult) return;
    downloadAuditedWorkbook(activeFile, latestResult).catch(() => toast.error('Could not download audited workbook'));
  }, [activeFile, latestResult]);

  const onDownloadCorrected = useCallback(() => {
    if (!activeFile || !latestResult || !process) return;
    downloadAuditedWorkbook(activeFile, latestResult, process.corrections).catch(() =>
      toast.error('Could not download corrected workbook'),
    );
  }, [activeFile, latestResult, process]);

  const onOpenMembers = useCallback(() => setMembersOpen(true), []);
  const onOpenVersionHistory = useCallback(() => {
    if (!process) return;
    void navigate(versionComparePath(process.displayCode ?? process.id, functionId));
  }, [navigate, process, functionId]);

  const leaveGuard = useCallback(() => !hasUnsavedAudit, [hasUnsavedAudit]);

  const headerConfig = useMemo(() => {
    if (!process) return { breadcrumbs: [] };
    const saveLabel = headVersion ? `Save to ${headVersionName}` : 'Save';
    const saveTooltip = !latestResult
      ? 'Run audit first to save.'
      : headVersion
      ? `Update ${headVersionName} in place with the latest findings. Use the caret to create a new named version.`
      : 'Save the current audit findings as V1.';
    const runTooltip = !activeFile
      ? 'Upload a file first'
      : selectedSheets === 0
      ? 'Select at least one valid sheet'
      : !mappingSourceValid
      ? 'Select a mapping source version or file before running'
      : activeFile.isAudited
      ? 'Re-run the audit with the current sheet selection'
      : 'Run the audit with the current sheet selection';
    const overflow = [];
    if (correctionCount === 0) {
      overflow.push({
        id: 'download',
        label: 'Download audited workbook',
        icon: ArrowDownToLine,
        onClick: onDownload,
        disabled: !canDownload,
        tooltip: !hasSavedVersion ? 'Save a version first to download audited workbook.' : undefined,
      });
    }
    if (correctionCount > 0) {
      overflow.push({
        id: 'download-corrected',
        label: 'Download corrected workbook',
        icon: ArrowDownToLine,
        onClick: onDownloadCorrected,
        disabled: !canDownload,
      });
      overflow.push({
        id: 'download-original',
        label: 'Download audited (original)',
        icon: ArrowDownToLine,
        onClick: onDownload,
        disabled: !canDownload,
      });
    }
    if (process.serverBacked) {
      overflow.push({ id: 'members', label: 'Members', icon: Users, onClick: onOpenMembers });
    }
    if (hasSavedVersion) {
      overflow.push({ id: 'versions', label: 'Version history', icon: History, onClick: onOpenVersionHistory });
    }
    return {
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process.name, to: `/processes/${encodeURIComponent(process.displayCode ?? process.id)}` },
        { label: getFunctionLabel(functionId) },
      ],
      primaryActions: [
        {
          id: 'run-audit',
          label: activeFile?.isAudited ? 'Re-run Audit' : 'Run Audit',
          icon: Play,
          onClick: () => {
            void onRunAudit();
          },
          shortcut: 'r',
          disabled: !canRun,
          loading: isAuditRunning,
          tooltip: runTooltip,
        },
        {
          id: 'save',
          label: saveLabel,
          icon: Save,
          onClick: onQuickSave,
          shortcut: 's',
          disabled: !canSave,
          variant: 'secondary' as const,
          tooltip: saveTooltip,
          splitMenu: [
            {
              label: 'Save as new version…',
              description: headVersion
                ? `Keeps ${headVersionName} as-is and creates V${nextVersionNumber} with a new name.`
                : 'Name this save before writing V1.',
              onClick: onSaveAsNew,
            },
          ],
        },
      ],
      overflowActions: overflow,
      leaveGuard,
    };
  }, [
    process,
    functionId,
    activeFile,
    selectedSheets,
    headVersion,
    headVersionName,
    latestResult,
    correctionCount,
    canRun,
    mappingSourceValid,
    canSave,
    canDownload,
    hasSavedVersion,
    isAuditRunning,
    nextVersionNumber,
    onRunAudit,
    onQuickSave,
    onSaveAsNew,
    onDownload,
    onDownloadCorrected,
    onOpenMembers,
    onOpenVersionHistory,
    leaveGuard,
  ]);
  usePageHeader(headerConfig);

  if (hydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500 dark:bg-gray-950">
        Loading workspace…
      </div>
    );
  }
  if (!process) return <Navigate to="/" replace />;
  const scopedProcess = { ...process, files: functionFiles };
  const draft = fileDrafts[`${process.id}:${functionId}`];
  const canManageMembers = currentUser?.role === 'admin';

  return (
    <AppShell process={process} sidebar={<FilesSidebar process={scopedProcess} functionId={functionId} />}>
      <DraftRestoreBanner
        draft={draft}
        currentFile={activeFile}
        processId={process.id}
        functionId={functionId}
        onRestore={promoteFileDraft}
        onDiscard={discardFileDraft}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-white px-5 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <PresenceBar members={members} selfCode={currentUser?.displayCode} />
          {activeFile?.lastAuditedAt ? (
            <span>Last run: {new Date(activeFile.lastAuditedAt).toLocaleString()}</span>
          ) : null}
          {hasUnsavedAudit ? (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700" title="Latest audit run isn't reflected in any saved version">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Unsaved
            </span>
          ) : null}
        </div>
      </div>
      {managerDirectoryOn && unmappedCount !== null && unmappedCount > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {unmappedCount} manager{unmappedCount === 1 ? '' : 's'} in these findings are not confidently matched in the directory. Notifications may be blocked until resolved.{' '}
          <button type="button" className="font-medium underline" onClick={() => setResolutionOpen(true)}>
            Open resolver
          </button>
        </div>
      ) : null}
      <WorkspaceShell>
        {tab === 'preview' ? (
          <TabPanel>
            <PreviewTab process={scopedProcess} file={activeFile} result={result} />
          </TabPanel>
        ) : null}
        {tab === 'results' ? (
          <TabPanel>
            <AuditResultsTab
              process={scopedProcess}
              file={activeFile}
              mappingSource={mappingSource}
              onMappingSourceChange={setMappingSource}
            />
          </TabPanel>
        ) : null}
        {tab === 'notifications' ? (
          <TabPanel>
            <NotificationsRedirect processId={process.id} onGoToResults={() => setWorkspaceTab('results')} />
          </TabPanel>
        ) : null}
        {tab === 'tracking' && isLegacyTileTrackingTabEnabled() ? (
          <TabPanel scroll="split">
            <Suspense fallback={<div className="p-5 text-sm text-gray-500">Loading tracking…</div>}>
              <TrackingTab process={scopedProcess} result={result ?? scopedProcess.versions[0]?.result ?? null} />
            </Suspense>
          </TabPanel>
        ) : null}
        {tab === 'versions' ? (
          <TabPanel>
            <Suspense fallback={<div className="p-5 text-sm text-gray-500">Loading version history…</div>}>
              <VersionHistoryTab process={scopedProcess} file={activeFile} functionId={functionId} />
            </Suspense>
          </TabPanel>
        ) : null}
        {tab === 'analytics' ? (
          <TabPanel>
            <Suspense fallback={<div className="p-5 text-sm text-gray-500">Loading analytics...</div>}>
              <AnalyticsTab process={scopedProcess} />
            </Suspense>
          </TabPanel>
        ) : null}
      </WorkspaceShell>
      {membersOpen && process.serverBacked ? (
        <MembersPanel
          processIdOrCode={process.displayCode ?? process.id}
          currentUserCode={currentUser?.displayCode}
          canManage={canManageMembers}
          onClose={() => setMembersOpen(false)}
        />
      ) : null}
      {managerDirectoryOn && resolutionOpen && rawManagerNames.length > 0 ? (
        <ResolutionDrawer
          open={resolutionOpen}
          onClose={() => setResolutionOpen(false)}
          rawNames={rawManagerNames}
          onResolved={() => {
            setResolutionOpen(false);
            void hydrateFunctionWorkspace(process.id, functionId);
          }}
        />
      ) : null}
      {versionModalOpen && process && latestResult ? (
        <SaveVersionModal
          process={process}
          onSaved={() => {
            // Version was actually created — allow the originally-blocked
            // navigation to continue. If the modal was opened outside the
            // blocker flow, pendingBlockerRef is null and this no-ops.
            modalSavedRef.current = true;
          }}
          onClose={() => {
            setVersionModalOpen(false);
            const pending = pendingBlockerRef.current;
            pendingBlockerRef.current = null;
            if (pending) {
              if (modalSavedRef.current) {
                pending.proceed?.();
              } else {
                pending.reset?.();
              }
            }
            modalSavedRef.current = false;
          }}
        />
      ) : null}
      <UnsavedAuditDialog
        open={blocker.state === 'blocked'}
        process={process}
        latestResult={result ?? process.latestAuditResult ?? null}
        activeFileId={activeFile?.id}
        onUpdate={() => {
          blocker.proceed?.();
        }}
        onSaveAsNew={() => {
          // Hand the blocker to the SaveVersionModal lifecycle. We cannot
          // proceed or reset yet — the user hasn't saved yet. The modal's
          // onSaved/onClose handlers will resolve the blocker correctly.
          modalSavedRef.current = false;
          pendingBlockerRef.current = {
            proceed: blocker.proceed,
            reset: blocker.reset,
          };
          requestSaveAsNewVersion();
        }}
        onLeave={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </AppShell>
  );
}

function NotificationsRedirect({ processId, onGoToResults }: { processId: string; onGoToResults: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-full bg-brand/10 p-3 text-brand">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 11l18-8-8 18-2-8-8-2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notifications moved</h2>
      <p className="max-w-md text-sm text-gray-600 dark:text-gray-300">
        Sending notifications and tracking responses now live in the Escalation Center, so every
        manager receives one consolidated message across all functions.
      </p>
      <div className="mt-2 flex gap-2">
        <Link
          to={`/processes/${processId}/escalations`}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Open Escalation Center
        </Link>
        <button
          type="button"
          onClick={onGoToResults}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Back to Audit Results
        </button>
      </div>
    </div>
  );
}
