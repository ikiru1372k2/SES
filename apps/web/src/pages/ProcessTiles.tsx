import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, HelpCircle, Sparkles } from 'lucide-react';
import { useCurrentUser } from '../components/auth/authContext';
import { FUNCTION_REGISTRY, type FunctionId } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { ProcessDashboardBanner } from '../components/escalations/ProcessDashboardBanner';
import { TileEscalationChip } from '../components/escalations/TileEscalationChip';
import { FunctionTile } from '../components/tiles/FunctionTile';
import { RequestFunctionAuditTile } from '../components/tiles/RequestFunctionAuditTile';
import { Skeleton } from '../components/shared/Skeleton';
import { fetchProcessEscalations } from '../lib/api/escalationsApi';
import { fetchProcessTiles, type ApiTiles } from '../lib/api/tilesApi';
import { escalationCenterPath, workspacePath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';

const RequestFunctionAuditModal = lazy(() =>
  import('../components/tiles/RequestFunctionAuditModal').then((m) => ({ default: m.RequestFunctionAuditModal })),
);

const EMPTY_TILES: ApiTiles = FUNCTION_REGISTRY.reduce(
  (acc, fn) => ({ ...acc, [fn.id]: { fileCount: 0, lastUploadAt: null, hasDraft: false } }),
  {} as ApiTiles,
);

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
  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process?.name ?? 'Process' },
      ],
      overflowActions: processKey
        ? [
            {
              id: 'escalations',
              label: 'Open escalations',
              icon: AlertTriangle,
              onClick: () => navigate(escalationCenterPath(processKey)),
            },
            {
              id: 'analytics',
              label: 'Open analytics',
              icon: AlertTriangle,
              onClick: () => navigate(`/processes/${encodeURIComponent(processKey)}/analytics`),
            },
          ]
        : [],
    }),
    [navigate, process?.name, processKey],
  );
  usePageHeader(headerConfig);

  if (!processId) return <Navigate to="/" replace />;

  const tiles = tilesQuery.data ?? EMPTY_TILES;
  const showSkeleton = tilesQuery.isLoading && !tilesQuery.data;

  return (
    <AppShell process={process ?? undefined}>
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{process?.name ?? 'Process'}</h1>
          {process?.displayCode ? (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {process.displayCode}
            </span>
          ) : null}
        </div>

        <p className="mb-6 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Pick a function audit to open its workspace. Every tile owns its own files, audits, versions
          and drafts — selecting one never mixes data with another.
        </p>

        {tilesQuery.isError ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Could not load tile stats: {(tilesQuery.error as Error)?.message}
          </div>
        ) : null}

        {process ? (
          <ProcessDashboardBanner processId={process.displayCode ?? process.id} summary={escalationsQuery.data?.summary} />
        ) : null}

        {showSkeleton ? (
          <TilesSkeleton count={FUNCTION_REGISTRY.length} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCTION_REGISTRY.map((fn) => (
              <FunctionTile
                key={fn.id}
                functionId={fn.id as FunctionId}
                label={fn.label}
                stats={tiles[fn.id as FunctionId]}
                onOpen={() => navigate(workspacePath(processId, fn.id))}
                footer={
                  process ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <TileEscalationChip
                        processId={process.displayCode ?? process.id}
                        functionId={fn.id as FunctionId}
                        managerCount={escalationsQuery.data?.summary?.perEngineManagerCounts?.[fn.id] ?? 0}
                      />
                      {isAdmin ? (
                        <Link
                          to={`/admin/ai-pilot/${fn.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-subtle px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-brand hover:text-white"
                          title="Open AI Pilot for this function"
                        >
                          <Sparkles size={10} />
                          AI Pilot
                        </Link>
                      ) : null}
                    </div>
                  ) : null
                }
              />
            ))}
            <RequestFunctionAuditTile onClick={() => setModalOpen(true)} />
          </div>
        )}

        <p className="mt-8 flex items-center gap-2 text-xs text-gray-500">
          <HelpCircle size={14} />
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
          <Skeleton className="mt-5 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
