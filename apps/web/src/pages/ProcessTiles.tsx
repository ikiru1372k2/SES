import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, BarChart3, HelpCircle } from 'lucide-react';
import { useCurrentUser } from '../components/auth/authContext';
import { FUNCTION_REGISTRY, type FunctionId } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { TileEscalationChip } from '../components/escalations/TileEscalationChip';
import { FunctionTile, FunctionTileAiPilotLink } from '../components/tiles/FunctionTile';
import { RequestFunctionAuditTile } from '../components/tiles/RequestFunctionAuditTile';
import { Skeleton } from '../components/shared/Skeleton';
import { PageHeader } from '../components/shared/PageHeader';
import { fetchProcessEscalations } from '../lib/api/escalationsApi';
import { fetchProcessTiles, type ApiTiles } from '../lib/api/tilesApi';
import { escalationCenterPath, processAnalyticsPath, workspacePath } from '../lib/processRoutes';
import { selectFunctionVersions } from '../lib/domain/versionScope';
import { useAppStore } from '../store/useAppStore';

const RequestFunctionAuditModal = lazy(() =>
  import('../components/tiles/RequestFunctionAuditModal').then((m) => ({ default: m.RequestFunctionAuditModal })),
);

const EMPTY_TILES: ApiTiles = FUNCTION_REGISTRY.reduce(
  (acc, fn) => ({ ...acc, [fn.id]: { fileCount: 0, lastUploadAt: null, hasDraft: false } }),
  {} as ApiTiles,
);

const headerActionClass =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-rule bg-white px-3 text-sm font-medium text-ink shadow-soft transition-all ease-soft hover:border-brand hover:text-brand active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function ProcessTiles() {
  const { processId } = useParams<{ processId: string }>();
  const navigate = useNavigate();
  const process = useAppStore((state) =>
    state.processes.find((item) => item.id === processId || item.displayCode === processId),
  );
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const [modalOpen, setModalOpen] = useState(false);
  const currentUser = useCurrentUser();
  const isAdmin = currentUser?.role === 'admin';

  const tilesQuery = useQuery({
    queryKey: ['process', processId, 'tiles'],
    queryFn: () => fetchProcessTiles(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  const escalationsQuery = useQuery({
    queryKey: ['escalations', processId],
    queryFn: () => fetchProcessEscalations(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!process && processId) void hydrateProcesses();
  }, [hydrateProcesses, process, processId]);

  const processKey = process?.displayCode ?? process?.id;
  const escalationSummary = escalationsQuery.data?.summary;
  const openEscalations = escalationSummary?.totalOpenFindings ?? 0;

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process?.name ?? 'Process' },
      ],
    }),
    [process?.name],
  );
  usePageHeader(headerConfig);

  if (!processId) return <Navigate to="/" replace />;

  const tiles = tilesQuery.data ?? EMPTY_TILES;
  const showSkeleton = tilesQuery.isLoading && !tilesQuery.data;

  return (
    <AppShell process={process ?? undefined}>
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader
          title={
            <>
              <h1 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
                {process?.name ?? 'Process'}
              </h1>
              {process?.displayCode ? (
                <span className="rounded-md bg-surface-app px-2 py-0.5 font-mono text-xs font-medium text-ink-2 ring-1 ring-inset ring-rule dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
                  {process.displayCode}
                </span>
              ) : null}
            </>
          }
          description="Pick a function audit to open its workspace. Every tile owns its own files, audits, versions and drafts — selecting one never mixes data with another."
          actions={
            processKey ? (
              <>
                <button
                  type="button"
                  className={headerActionClass}
                  onClick={() => navigate(escalationCenterPath(processKey))}
                >
                  <AlertTriangle size={14} className="shrink-0 text-warning-600" aria-hidden />
                  Escalations · {openEscalations}
                </button>
                <button
                  type="button"
                  className={headerActionClass}
                  onClick={() => navigate(processAnalyticsPath(processKey))}
                >
                  <BarChart3 size={14} className="shrink-0 text-ink-3" aria-hidden />
                  Analytics
                </button>
              </>
            ) : null
          }
        />

        {tilesQuery.isError ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 shadow-soft dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Could not load tile stats: {(tilesQuery.error as Error)?.message}
          </div>
        ) : null}

        {showSkeleton ? (
          <TilesSkeleton count={FUNCTION_REGISTRY.length} />
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCTION_REGISTRY.map((fn) => {
              const fid = fn.id as FunctionId;
              const openCount = escalationSummary?.perEngineIssueCounts?.[fid] ?? 0;
              const processCode = process?.displayCode ?? process?.id;
              // Head saved version for THIS function, derived client-side
              // from the store (same per-function identity as save) so the
              // tile reflects workspace saves and never bleeds across tiles.
              const head = process ? selectFunctionVersions(process, fid)[0] : undefined;
              const headVersionLabel = head ? `v${head.versionNumber}` : null;
              return (
                <FunctionTile
                  key={fn.id}
                  functionId={fid}
                  label={fn.label}
                  stats={tiles[fid]}
                  openEscalationCount={openCount}
                  headVersionLabel={headVersionLabel}
                  onOpen={() => navigate(workspacePath(processId, fn.id))}
                  aiPilotLink={isAdmin ? <FunctionTileAiPilotLink functionId={fid} /> : undefined}
                  escalationFooter={
                    processCode && openCount > 0 ? (
                      <TileEscalationChip processId={processCode} functionId={fid} issueCount={openCount} />
                    ) : undefined
                  }
                />
              );
            })}
            <RequestFunctionAuditTile onClick={() => setModalOpen(true)} />
          </div>
        )}

        <p className="mt-8 flex items-center gap-2 text-xs text-ink-3">
          <HelpCircle size={14} aria-hidden />
          System-defined tiles are permanent. Contact your administrator to request a new audit function.
        </p>
      </div>
      {modalOpen ? (
        <Suspense fallback={null}>
          <RequestFunctionAuditModal
            processIdOrCode={process?.displayCode ?? processId}
            onClose={() => setModalOpen(false)}
          />
        </Suspense>
      ) : null}
    </AppShell>
  );
}

function TilesSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="surface-card p-[18px]">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-8 w-full" />
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
          </div>
          <div className="mt-3.5 flex items-center justify-between border-t border-rule-2 pt-3 dark:border-gray-800">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
