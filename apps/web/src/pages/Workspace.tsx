import { Navigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { MembersPanel } from '../components/workspace/MembersPanel';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { NotificationsTab } from '../components/workspace/NotificationsTab';
import { TrackingTab } from '../components/workspace/TrackingTab';
import { VersionHistoryTab } from '../components/workspace/VersionHistoryTab';
import { AppShell } from '../components/layout/AppShell';
import { PresenceBar } from '../components/shared/PresenceBar';
import { useCurrentUser } from '../components/auth/AuthGate';
import { selectHasUnsavedAudit } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { useRealtime } from '../realtime/useRealtime';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));

export function Workspace() {
  const { id } = useParams();
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const tab = useAppStore((state) => state.activeWorkspaceTab);
  const result = useAppStore((state) => state.currentAuditResult);
  const process = processes.find((item) => item.id === id);
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const currentUser = useCurrentUser();
  const [membersOpen, setMembersOpen] = useState(false);
  const [hydrating, setHydrating] = useState<boolean>(!process);
  const [hydrateAttempted, setHydrateAttempted] = useState(false);

  // If the user hard-refreshed /workspace/<id> in a tab that has no cached
  // process (incognito, different logged-in user, cleared storage) the store
  // will briefly be empty. Fetch once before deciding whether the process
  // really doesn't exist — otherwise we redirect to Dashboard and the user
  // loses their deep link.
  useEffect(() => {
    if (process) {
      setHydrating(false);
      return;
    }
    if (hydrateAttempted) return;
    setHydrateAttempted(true);
    void hydrateProcesses().finally(() => setHydrating(false));
  }, [process, hydrateAttempted, hydrateProcesses]);

  // Subscribe to realtime updates for this process. The hook accepts either
  // a PRC-* display code or a UUID; the server resolves either. When the
  // process is legacy-local (no backend record yet), presence.join returns
  // forbidden and we stay silent — no toast spam.
  const processRealtimeKey = process?.displayCode ?? process?.id ?? null;
  const { members } = useRealtime(processRealtimeKey);

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
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0] ?? undefined;
  const canManageMembers = currentUser?.role === 'admin'; // Owners are verified server-side too; admin is the quick client-side hint.

  const accessory = (
    <div className="flex items-center gap-2">
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
    <AppShell process={process} sidebar={<FilesSidebar process={process} />} topBarAccessory={accessory}>
      <WorkspaceShell>
        {tab === 'preview' ? (
          <TabPanel>
            <PreviewTab process={process} file={activeFile} result={result} />
          </TabPanel>
        ) : null}
        {tab === 'results' ? (
          <TabPanel>
            <AuditResultsTab process={process} file={activeFile} />
          </TabPanel>
        ) : null}
        {tab === 'notifications' ? (
          <TabPanel scroll="split">
            <NotificationsTab process={process} result={result ?? process.versions[0]?.result ?? null} />
          </TabPanel>
        ) : null}
        {tab === 'tracking' ? (
          <TabPanel scroll="split">
            <TrackingTab process={process} result={result ?? process.versions[0]?.result ?? null} />
          </TabPanel>
        ) : null}
        {tab === 'versions' ? (
          <TabPanel>
            <VersionHistoryTab process={process} file={activeFile} />
          </TabPanel>
        ) : null}
        {tab === 'analytics' ? (
          <TabPanel>
            <Suspense fallback={<div className="p-5 text-sm text-gray-500">Loading analytics...</div>}>
              <AnalyticsTab process={process} />
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
