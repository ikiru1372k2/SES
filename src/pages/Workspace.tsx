import { Navigate, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { FilesSidebar } from '../components/workspace/FilesSidebar';
import { WorkspaceShell } from '../components/workspace/WorkspaceShell';
import { PreviewTab } from '../components/workspace/PreviewTab';
import { AuditResultsTab } from '../components/workspace/AuditResultsTab';
import { NotificationsTab } from '../components/workspace/NotificationsTab';
import { TrackingTab } from '../components/workspace/TrackingTab';
import { VersionHistoryTab } from '../components/workspace/VersionHistoryTab';
import { AppShell } from '../components/layout/AppShell';
import { useAppStore } from '../store/useAppStore';

const AnalyticsTab = lazy(() => import('../components/workspace/AnalyticsTab').then((module) => ({ default: module.AnalyticsTab })));

export function Workspace() {
  const { id } = useParams();
  const processes = useAppStore((state) => state.processes);
  const tab = useAppStore((state) => state.activeWorkspaceTab);
  const result = useAppStore((state) => state.currentAuditResult);
  const process = processes.find((item) => item.id === id);
  if (!process) return <Navigate to="/" replace />;
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0];

  return (
    <AppShell process={process} sidebar={<FilesSidebar process={process} />}>
      <WorkspaceShell>
        {tab === 'preview' ? <PreviewTab process={process} file={activeFile} result={result} /> : null}
        {tab === 'results' ? <AuditResultsTab process={process} file={activeFile} /> : null}
        {tab === 'notifications' ? <NotificationsTab process={process} result={result ?? process.versions[0]?.result ?? null} /> : null}
        {tab === 'tracking' ? <TrackingTab process={process} result={result ?? process.versions[0]?.result ?? null} /> : null}
        {tab === 'versions' ? <VersionHistoryTab process={process} file={activeFile} /> : null}
        {tab === 'analytics' ? (
          <Suspense fallback={<div className="p-5 text-sm text-gray-500">Loading analytics...</div>}>
            <AnalyticsTab process={process} />
          </Suspense>
        ) : null}
      </WorkspaceShell>
    </AppShell>
  );
}
