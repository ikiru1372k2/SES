import { useEffect, useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AnalyticsWorkbench } from '../components/analytics/AnalyticsWorkbench';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { processDashboardPath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';

export default function ProcessAnalytics() {
  const { processId } = useParams<{ processId: string }>();
  const process = useAppStore((state) =>
    state.processes.find((item) => item.id === processId || item.displayCode === processId),
  );
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);

  useEffect(() => {
    if (!process && processId) void hydrateProcesses();
  }, [hydrateProcesses, process, processId]);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        {
          label: process?.name ?? 'Process',
          to: process ? processDashboardPath(process.displayCode ?? process.id) : undefined,
        },
      ],
    }),
    [process],
  );
  usePageHeader(headerConfig);

  if (!processId) return <Navigate to="/" replace />;

  return (
    <AppShell process={process ?? undefined}>
      <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-gray-500">
            Whole process — across all functions. Ask the analyst, browse trends, drill into anomalies.
          </p>
        </div>
        <AnalyticsWorkbench processCode={processId} />
      </div>
    </AppShell>
  );
}
