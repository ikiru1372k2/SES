import { Navigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { TabPanel } from '../components/workspace/TabPanel';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { NotificationsTab } from '../components/workspace/NotificationsTab';
import { TrackingTab } from '../components/workspace/TrackingTab';
import { VersionHistoryTab } from '../components/workspace/VersionHistoryTab';
import { AppShell } from '../components/layout/AppShell';
import { PresenceBar } from '../components/shared/PresenceBar';
import { selectHasUnsavedAudit } from '../store/selectors';
import { useAppStore } from '../store/useAppStore';
import { useRealtime } from '../realtime/useRealtime';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));

export function Workspace() {
  const { id } = useParams();
  const processes = useAppStore((state) => state.processes);
  const tab = useAppStore((state) => state.activeWorkspaceTab);
  const result = useAppStore((state) => state.currentAuditResult);
  const process = processes.find((item) => item.id === id);
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;

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

  if (!process) return <Navigate to="/" replace />;
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0] ?? undefined;

  return (
    <AppShell
      process={process}
      sidebar={<FilesSidebar process={process} />}
      topBarAccessory={<PresenceBar members={members} />}
    >
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
    </AppShell>
  );
}
