import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import { DEFAULT_FUNCTION_ID, getFunctionLabel, isFunctionId, isValidEmail, type FunctionId } from '@ses/domain';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { MembersPanel } from '../components/workspace/MembersPanel';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { DraftRestoreBanner } from '../components/workspace/DraftRestoreBanner';
import { UnsavedAuditDialog } from '../components/workspace/UnsavedAuditDialog';
import { AppShell } from '../components/layout/AppShell';
import { PresenceBar } from '../components/shared/PresenceBar';
import { useCurrentUser } from '../components/auth/authContext';
import { selectHasUnsavedAudit } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { isLegacyTileTrackingTabEnabled } from '../lib/featureFlags';
import { processDashboardPath } from '../lib/processRoutes';
import { useRealtime } from '../realtime/useRealtime';
import { onRealtimeEvent } from '../realtime/socket';
import { directorySuggestions } from '../lib/api/directoryApi';
import { ResolutionDrawer } from '../components/directory/ResolutionDrawer';

// E5: cold tabs — Analytics, Version History, and the legacy Tracking tab
// each pull sizable dependencies (recharts, per-tab logic). Most users hit
// Preview + Audit Results only; the rest are worth lazy-loading so initial
// workspace open doesn't pay their cost.
const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));
const VersionHistoryTab = lazy(() =>
  import('../components/workspace/VersionHistoryTab').then((module) => ({ default: module.VersionHistoryTab })),
);
const TrackingTab = lazy(() =>
  import('../components/workspace/TrackingTab').then((module) => ({ default: module.TrackingTab })),
);

export function Workspace() {
  // New surface: /processes/:processId/:functionId — back-compat with old
  // /workspace/:id is handled by a redirect in App.tsx, so `id` is no longer read here.
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
  const process = processes.find((item) => item.id === processId || item.displayCode === processId);
  const processRecordId = process?.id;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const currentUser = useCurrentUser();
  const managerDirectoryOn = currentUser?.managerDirectoryEnabled !== false;
  const tabFromUrl = searchParams.get('tab');
  const [membersOpen, setMembersOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const hydrateAttemptedRef = useRef(false);
  const queryClient = useQueryClient();
  const [hydrateFinished, setHydrateFinished] = useState(false);
  // hydrating is true only while we're waiting for hydrateProcesses() to complete.
  // Derived rather than stored so we never need setState in an effect's sync path.
  const hydrating = !process && !hydrateFinished;

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

  // Issue #74: unmapped-manager banner is a React Query rather than a
  // manual effect so any `directory.updated` realtime event or explicit
  // invalidation from elsewhere re-runs the suggestion fetch automatically.
  // The query key embeds the sorted name list so the cache buckets per
  // distinct input and avoids double-fetches across remounts.
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

  // Realtime invalidation: directory mutations (resolve, inline add, merge,
  // archive, delete) must flush the amber banner immediately without a
  // browser refresh.
  useEffect(() => {
    const off = onRealtimeEvent((envelope) => {
      if (envelope.event === 'directory.updated') {
        void queryClient.invalidateQueries({ queryKey: ['directory-suggestions'] });
      }
    });
    return off;
  }, [queryClient]);

  // If the user hard-refreshed /workspace/<id> in a tab that has no cached
  // process (incognito, different logged-in user, cleared storage) the store
  // will briefly be empty. Fetch once before deciding whether the process
  // really doesn't exist — otherwise we redirect to Dashboard and the user
  // loses their deep link.
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

  // When the user lands on the Audit Results tab without an in-session
  // result (deep link from the Escalation Center, bookmarked URL, hard
  // refresh, …) fetch the latest completed run from the server. The
  // store action no-ops if `currentAuditResult` is already populated for
  // this file, so this is safe to fire on every render of the results tab.
  useEffect(() => {
    if (tab !== 'results') return;
    if (!processRecordId) return;
    const targetFileId = process?.activeFileId
      ?? process?.files.find((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId)?.id;
    if (!targetFileId) return;
    void hydrateLatestAuditResult(processRecordId, targetFileId);
  }, [tab, processRecordId, process?.activeFileId, process?.files, functionId, hydrateLatestAuditResult]);

  // Subscribe to realtime updates for this process. The hook accepts either
  // a PRC-* display code or a UUID; the server resolves either. When the
  // process is legacy-local (no backend record yet), presence.join returns
  // forbidden and we stay silent — no toast spam.
  const processRealtimeKey = process?.displayCode ?? process?.id ?? null;
  const { members } = useRealtime(processRealtimeKey, currentUser?.displayCode, {
    onEvicted: () => navigate('/'),
  });

  // Last-resort safety net for tab-close / hard-refresh / browser-back,
  // which useBlocker can't intercept. The custom UnsavedAuditDialog below
  // handles all in-app navigation — that's where the rich diff UI lives.
  useEffect(() => {
    if (!hasUnsavedAudit) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedAudit]);

  // Intercept in-app navigation (clicks on router Links / programmatic
  // navigate()) and show the UnsavedAuditDialog with a rich diff summary.
  const shouldBlock = useCallback<(args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean>(
    ({ currentLocation, nextLocation }) => {
      if (!hasUnsavedAudit) return false;
      // Same-pathname transitions (tab changes via URL search params) don't
      // count as leaving the workspace.
      if (currentLocation.pathname === nextLocation.pathname) return false;
      return true;
    },
    [hasUnsavedAudit],
  );
  const blocker = useBlocker(shouldBlock);
  const requestSaveAsNewVersion = useAppStore((state) => state.requestSaveAsNewVersion);

  if (hydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500 dark:bg-gray-950">
        Loading workspace…
      </div>
    );
  }
  if (!process) return <Navigate to="/" replace />;
  // Scope the file list to the selected function so each tile only sees its own files.
  const functionFiles = process.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId);
  const scopedProcess = { ...process, files: functionFiles };
  const activeFile = functionFiles.find((file) => file.id === process.activeFileId) ?? functionFiles[0] ?? undefined;
  const draft = fileDrafts[`${process.id}:${functionId}`];
  const canManageMembers = currentUser?.role === 'admin'; // Owners are verified server-side too; admin is the quick client-side hint.

  const accessory = (
    <div className="flex items-center gap-2">
      <Link
        to={processDashboardPath(process.id)}
        className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
        title="Back to tiles"
      >
        <ArrowLeft size={14} />
        <span className="hidden sm:inline">{getFunctionLabel(functionId)}</span>
      </Link>
      <PresenceBar members={members} selfCode={currentUser?.displayCode} />
      {process.serverBacked ? (
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
          title="Members"
        >
          <Users size={14} />
          <span className="hidden sm:inline">Members</span>
        </button>
      ) : null}
    </div>
  );

  return (
    <AppShell process={process} sidebar={<FilesSidebar process={scopedProcess} functionId={functionId} />} topBarAccessory={accessory}>
      <DraftRestoreBanner
        draft={draft}
        currentFile={activeFile}
        processId={process.id}
        functionId={functionId}
        onRestore={promoteFileDraft}
        onDiscard={discardFileDraft}
      />
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
            <AuditResultsTab process={scopedProcess} file={activeFile} />
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
      <UnsavedAuditDialog
        open={blocker.state === 'blocked'}
        process={process}
        latestResult={result ?? process.latestAuditResult ?? null}
        activeFileId={activeFile?.id}
        onUpdate={() => {
          // saveOverCurrentVersion has already run inside the dialog; we
          // just need to resume navigation.
          blocker.proceed?.();
        }}
        onSaveAsNew={() => {
          // Open the Save-as-new modal owned by TopBar, then cancel the
          // block so the user can interact with it. They can retry
          // navigation once they've saved.
          requestSaveAsNewVersion();
          blocker.reset?.();
        }}
        onLeave={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </AppShell>
  );
}

// Someone landed here from a bookmark or a persisted tab. The old tile-local
// notifications workflow has been retired; route them to the Escalation
// Center instead, which is the single source of truth for notify + track.
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