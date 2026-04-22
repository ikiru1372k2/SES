import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Users } from 'lucide-react';
import { DEFAULT_FUNCTION_ID, getFunctionLabel, isFunctionId, isValidEmail, type FunctionId } from '@ses/domain';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { MembersPanel } from '../components/workspace/MembersPanel';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { NotificationsTab } from '../components/workspace/NotificationsTab';
import { TrackingTab } from '../components/workspace/TrackingTab';
import { VersionHistoryTab } from '../components/workspace/VersionHistoryTab';
import { DraftRestoreBanner } from '../components/workspace/DraftRestoreBanner';
import { AppShell } from '../components/layout/AppShell';
import { PresenceBar } from '../components/shared/PresenceBar';
import { useCurrentUser } from '../components/auth/authContext';
import { selectHasUnsavedAudit } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { isLegacyTileTrackingTabEnabled } from '../lib/featureFlags';
import { processDashboardPath } from '../lib/processRoutes';
import { useRealtime } from '../realtime/useRealtime';
import { directorySuggestions } from '../lib/api/directoryApi';
import { ResolutionDrawer } from '../components/directory/ResolutionDrawer';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));

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
  const [unmappedCount, setUnmappedCount] = useState<number | null>(null);
  const hydrateAttemptedRef = useRef(false);
  const [hydrateFinished, setHydrateFinished] = useState(false);
  // hydrating is true only while we're waiting for hydrateProcesses() to complete.
  // Derived rather than stored so we never need setState in an effect's sync path.
  const hydrating = !process && !hydrateFinished;

  const rawManagerNames = useMemo(() => {
    if (!process) return [];
    const functionFiles = process.files.filter((file) => (file.functionId ?? DEFAULT_FUNCTION_ID) === functionId);
    const auditResult = result ?? process.versions[0]?.result ?? null;
    const names = new Set<string>();
    for (const issue of auditResult?.issues ?? []) {
      const n = issue.projectManager?.trim();
      if (!n) continue;
      if (!isValidEmail(issue.email)) names.add(n);
    }
    return [...names];
  }, [process, functionId, result]);

  useEffect(() => {
    if (!managerDirectoryOn || rawManagerNames.length === 0) {
      setUnmappedCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sug = await directorySuggestions(rawManagerNames);
        if (cancelled) return;
        const n = rawManagerNames.filter((name) => !sug.results[name]?.autoMatch).length;
        setUnmappedCount(n);
      } catch {
        if (!cancelled) setUnmappedCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawManagerNames, managerDirectoryOn]);

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

  // Subscribe to realtime updates for this process. The hook accepts either
  // a PRC-* display code or a UUID; the server resolves either. When the
  // process is legacy-local (no backend record yet), presence.join returns
  // forbidden and we stay silent — no toast spam.
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
          <TabPanel scroll="split">
            <NotificationsTab process={scopedProcess} result={result ?? scopedProcess.versions[0]?.result ?? null} />
          </TabPanel>
        ) : null}
        {tab === 'tracking' && isLegacyTileTrackingTabEnabled() ? (
          <TabPanel scroll="split">
            <TrackingTab process={scopedProcess} result={result ?? scopedProcess.versions[0]?.result ?? null} />
          </TabPanel>
        ) : null}
        {tab === 'versions' ? (
          <TabPanel>
            <VersionHistoryTab process={scopedProcess} file={activeFile} functionId={functionId} />
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
    </AppShell>
  );
}
