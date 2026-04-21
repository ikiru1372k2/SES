import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Users } from 'lucide-react';
import { DEFAULT_FUNCTION_ID, getFunctionLabel, isFunctionId, type FunctionId } from '@ses/domain';
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
import { useCurrentUser } from '../components/auth/AuthGate';
import { selectHasUnsavedAudit } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { processDashboardPath } from '../lib/processRoutes';
import { useRealtime } from '../realtime/useRealtime';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));

export function Workspace() {
  // New surface: /processes/:processId/:functionId — back-compat with old
  // /workspace/:id is handled by a redirect in App.tsx, so `id` is no longer read here.
  const params = useParams<{ processId: string; functionId: string }>();
  const processId = params.processId;
  const functionId: FunctionId = isFunctionId(params.functionId) ? params.functionId : DEFAULT_FUNCTION_ID;
  const navigate = useNavigate();
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const hydrateFunctionWorkspace = useAppStore((state) => state.hydrateFunctionWorkspace);
  const fileDrafts = useAppStore((state) => state.fileDrafts);
  const promoteFileDraft = useAppStore((state) => state.promoteFileDraft);
  const discardFileDraft = useAppStore((state) => state.discardFileDraft);
  const tab = useAppStore((state) => state.activeWorkspaceTab);
  const result = useAppStore((state) => state.currentAuditResult);
  const process = processes.find((item) => item.id === processId || item.displayCode === processId);
  const processRecordId = process?.id;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const currentUser = useCurrentUser();
  const [membersOpen, setMembersOpen] = useState(false);
  const hydrateAttemptedRef = useRef(false);
  const [hydrateFinished, setHydrateFinished] = useState(false);
  // hydrating is true only while we're waiting for hydrateProcesses() to complete.
  // Derived rather than stored so we never need setState in an effect's sync path.
  const hydrating = !process && !hydrateFinished;

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
        {tab === 'tracking' ? (
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
    </AppShell>
  );
}
