import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, History, Loader2, Play, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_FUNCTION_ID, getFunctionLabel, isFunctionId, isValidEmail, type FunctionId } from '@ses/domain';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { DraftRestoreBanner } from '../components/workspace/DraftRestoreBanner';
import { WorkspaceStatusCards } from '../components/workspace/WorkspaceStatusCards';
import { SaveVersionModal } from '../components/workspace/SaveVersionModal';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { useCurrentUser } from '../components/auth/authContext';
import { downloadAuditedWorkbook } from '../lib/workbook/excelParser';
import type { MappingSourceInput } from '../lib/api/auditsApi';
import { selectCorrectionCount, selectLatestAuditResult } from '../store/selectors';
import { selectFunctionVersions } from '../lib/domain/versionScope';
import { useAppStore } from '../store/useAppStore';
import { isLegacyTileTrackingTabEnabled } from '../lib/featureFlags';
import { resolveWorkspaceMetrics } from '../lib/workbook/auditResultFilter';
import { anchorResultForFile, formatDiffChips, summarizeDiff } from '../lib/workbook/versionDiff';
import { escalationCenterPath, processDashboardPath } from '../lib/processRoutes';
import { useRealtime } from '../realtime/useRealtime';
import { onRealtimeEvent } from '../realtime/socket';
import { directorySuggestions } from '../lib/api/directoryApi';
import { ResolutionDrawer } from '../components/directory/ResolutionDrawer';
import { useEffectiveAccess } from '../hooks/useEffectiveAccess';

const READ_ONLY_TOOLTIP = 'Read-only access — ask an admin for editor scope.';

const VersionHistoryTab = lazy(() =>
  import('../components/workspace/VersionHistoryTab').then((module) => ({ default: module.VersionHistoryTab })),
);
const TrackingTab = lazy(() =>
  import('../components/workspace/TrackingTab').then((module) => ({ default: module.TrackingTab })),
);

// Module-scope (stable for useCallback deps). These require a mapping source.
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
  const clearCurrentAuditResult = useAppStore((state) => state.clearCurrentAuditResult);
  const result = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const saveOverCurrentVersion = useAppStore((state) => state.saveOverCurrentVersion);
  const saveAsNewRequestCount = useAppStore((state) => state.saveAsNewRequestCount);

  const process = processes.find((item) => item.id === processId || item.displayCode === processId);
  const processRecordId = process?.id;
  const currentUser = useCurrentUser();
  const managerDirectoryOn = currentUser?.managerDirectoryEnabled !== false;
  const tabFromUrl = searchParams.get('tab');
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [mappingSource, setMappingSource] = useState<MappingSourceInput | undefined>(undefined);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset mapping source on function navigation
  useEffect(() => { setMappingSource(undefined); }, [functionId]);
  const hydrateAttemptedRef = useRef<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const [hydratedProcessParam, setHydratedProcessParam] = useState<string | undefined>(undefined);
  const hydrating = !process && hydratedProcessParam !== processId;

  useEffect(() => {
    if (saveAsNewRequestCount === 0 || !process) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate cross-component signal
    setVersionModalOpen(true);
  }, [saveAsNewRequestCount, process]);

  const rawManagerNames = useMemo(() => {
    if (!process) return [];
    // Scoped to this function's head so the directory-name scan never pulls
    // another function's saved findings.
    const auditResult = result ?? selectFunctionVersions(process, functionId)[0]?.result ?? null;
    const names = new Set<string>();
    for (const issue of auditResult?.issues ?? []) {
      const n = issue.projectManager?.trim();
      if (!n) continue;
      if (!isValidEmail(issue.email)) names.add(n);
    }
    return [...names];
  }, [process, result, functionId]);

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
    if (process) {
      if (hydratedProcessParam !== processId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- record route param covered by store data
        setHydratedProcessParam(processId);
      }
      return;
    }
    if (hydrateAttemptedRef.current === processId) return;
    hydrateAttemptedRef.current = processId;
    void hydrateProcesses().finally(() => setHydratedProcessParam(processId));
  }, [hydratedProcessParam, process, processId, hydrateProcesses]);

  // Synchronously drop any session result the moment the process or function
  // changes (e.g. navigating to another process via URL), before async
  // hydration runs — otherwise the previous file/process's result can leak
  // into the metrics bar / Issues count for a render or two.
  useEffect(() => {
    clearCurrentAuditResult();
  }, [processRecordId, functionId, clearCurrentAuditResult]);

  useEffect(() => {
    if (!processRecordId) return;
    void hydrateFunctionWorkspace(processRecordId, functionId);
  }, [functionId, hydrateFunctionWorkspace, processRecordId]);

  useEffect(() => {
    if (tabFromUrl === 'results' || tabFromUrl === 'versions') {
      setWorkspaceTab(tabFromUrl);
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, setWorkspaceTab, tabFromUrl]);

  useEffect(() => {
    if (tab !== 'results') return;
    if (!processRecordId) return;
    // Only hydrate from a file belonging to the current function; activeFileId
    // alone would leak another function's file ID.
    const functionFiles = process?.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId) ?? [];
    const targetFileId = functionFiles.find((file) => file.id === process?.activeFileId)?.id ?? functionFiles[0]?.id;
    if (!targetFileId) return;
    void hydrateLatestAuditResult(processRecordId, targetFileId);
  }, [tab, processRecordId, process?.activeFileId, process?.files, functionId, hydrateLatestAuditResult]);

  const processRealtimeKey = process?.displayCode ?? process?.id ?? null;
  // Subscribe for the realtime eviction side-effect. `members` is no longer
  // consumed here (PresenceBar was removed), so we don't destructure it.
  useRealtime(processRealtimeKey, currentUser?.displayCode, {
    onEvicted: () => navigate('/'),
  });


  // Header action handlers read store via refs at call-time to stay stable
  // across renders (header must not re-render on every keystroke).
  const functionFiles = useMemo(
    () => (process ? process.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId) : []),
    [process, functionId],
  );
  // Versioning is independent per function: only this function's saved
  // versions drive the head / next number / pills, so saving Master Data
  // never bumps Function Rate (and vice-versa).
  const functionVersions = useMemo(
    () => (process ? selectFunctionVersions(process, functionId) : []),
    [process, functionId],
  );
  const activeFile = functionFiles.find((file) => file.id === process?.activeFileId) ?? functionFiles[0];
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = functionVersions.length > 0;
  // Unfiltered: Run / Save / Download legitimately act on the latest result
  // regardless of sheet selection or active file. Pass a function-scoped
  // process so the version fallback (and latestAuditResult guard) can't pick
  // another function's result.
  const latestResult =
    result ??
    (process
      ? selectLatestAuditResult({ ...process, files: functionFiles, versions: functionVersions })
      : null);
  // Scoped to the active file (zeros when none) — drives the Issues·N tab
  // count so it can't show a stale count from another file/version.
  const filteredIssueCount = useMemo(
    () => resolveWorkspaceMetrics(process, activeFile, result).issues,
    [process, activeFile, result],
  );
  const correctionCount = process ? selectCorrectionCount(process) : 0;
  const headVersion = functionVersions[0];
  const headVersionName = headVersion?.versionName ?? '';
  const nextVersionNumber = functionVersions.length + 1;
  function isMappingSourceValid(src: MappingSourceInput | undefined): boolean {
    if (!src || src.type === 'none') return true;
    if (src.type === 'master_data_version') return Boolean(src.masterDataVersionId);
    if (src.type === 'uploaded_file') return Boolean(src.uploadId);
    return true;
  }
  const mappingSourceValid =
    !MAPPING_ENABLED_FUNCTIONS.has(activeFile?.functionId ?? '') || isMappingSourceValid(mappingSource);
  const accessGate = useEffectiveAccess(process?.serverBacked ? process.displayCode ?? process.id : null);
  // Local-only processes have no membership row; the user owns their session.
  const canEditThisFunction = process?.serverBacked
    ? accessGate.canEditFunction(activeFile?.functionId ?? functionId)
    : true;
  const featureCanRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning && mappingSourceValid);
  const featureCanSave = Boolean(process && latestResult && !isAuditRunning);
  const canRun = featureCanRun && canEditThisFunction;
  const canSave = featureCanSave && canEditThisFunction;
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

  const onOpenVersionHistory = useCallback(() => {
    setWorkspaceTab('versions');
  }, [setWorkspaceTab]);

  const headerConfig = useMemo(() => {
    if (!process) return { breadcrumbs: [] };
    const saveLabel = headVersion ? `Save to ${headVersionName}` : 'Save';
    const saveTooltip = !canEditThisFunction
      ? READ_ONLY_TOOLTIP
      : !latestResult
      ? 'Run audit first to save.'
      : headVersion
      ? `Update ${headVersionName} in place with the latest findings. Use the caret to create a new named version.`
      : 'Save the current audit findings as V1.';
    const runTooltip = !canEditThisFunction
      ? READ_ONLY_TOOLTIP
      : !activeFile
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
        id: 'download-original',
        label: 'Download audited (original)',
        icon: ArrowDownToLine,
        onClick: onDownload,
        disabled: !canDownload,
      });
    }
    if (hasSavedVersion) {
      overflow.push({ id: 'versions', label: 'Version history', icon: History, onClick: onOpenVersionHistory });
    }
    return {
      // Show which function the user is in (matches master). Without this
      // third crumb, Workspace pages for different functions looked
      // identical — you couldn't tell Master Data from Function Rate.
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process.name, to: processDashboardPath(process.displayCode ?? process.id) },
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
        ...(correctionCount > 0
          ? [
              {
                id: 'download-corrected',
                label: 'Download corrected',
                icon: ArrowDownToLine,
                onClick: onDownloadCorrected,
                disabled: !canDownload,
                variant: 'secondary' as const,
              },
            ]
          : []),
      ],
      overflowActions: overflow,
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
    canEditThisFunction,
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
    onOpenVersionHistory,
  ]);
  usePageHeader(headerConfig);

  if (hydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-surface-app text-sm text-gray-500 dark:bg-gray-950">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Loading workspace…
      </div>
    );
  }
  if (!process) return <Navigate to="/" replace />;
  const scopedProcess = { ...process, files: functionFiles, versions: functionVersions };
  const draft = fileDrafts[`${process.id}:${functionId}`];

  return (
    <AppShell process={process} sidebar={<FilesSidebar process={scopedProcess} functionId={functionId} canEdit={canEditThisFunction} readOnlyReason={READ_ONLY_TOOLTIP} />}>
      <DraftRestoreBanner
        draft={draft}
        currentFile={activeFile}
        processId={process.id}
        functionId={functionId}
        onRestore={promoteFileDraft}
        onDiscard={discardFileDraft}
      />
      <WorkspaceStatusCards
        activeFile={activeFile}
        sessionResult={result}
        process={scopedProcess}
        onSaveAsNew={onSaveAsNew}
      />
      {managerDirectoryOn && unmappedCount !== null && unmappedCount > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-950 shadow-soft dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {unmappedCount} manager{unmappedCount === 1 ? '' : 's'} in these findings are not confidently matched in the directory. Notifications may be blocked until resolved.{' '}
          <button type="button" className="font-medium underline" onClick={() => setResolutionOpen(true)}>
            Open resolver
          </button>
        </div>
      ) : null}
      <WorkspaceShell
        issueCount={filteredIssueCount}
        versionCount={functionVersions.length}
      >
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
              canEdit={canEditThisFunction}
              readOnlyReason={READ_ONLY_TOOLTIP}
            />
          </TabPanel>
        ) : null}
        {tab === 'notifications' ? (
          <TabPanel>
            <NotificationsRedirect processId={process.displayCode ?? process.id} onGoToResults={() => setWorkspaceTab('results')} />
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
      </WorkspaceShell>
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
          process={scopedProcess}
          functionId={functionId}
          onClose={() => setVersionModalOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}

function NotificationsRedirect({ processId, onGoToResults }: { processId: string; onGoToResults: () => void }) {
  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-10 text-center shadow-soft dark:border-gray-800 dark:bg-gray-900">
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
          to={escalationCenterPath(processId)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98]"
        >
          Open Escalation Center
        </Link>
        <button
          type="button"
          onClick={onGoToResults}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-soft transition-all ease-soft hover:bg-gray-50 hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Back to Audit Results
        </button>
      </div>
    </div>
  );
}
