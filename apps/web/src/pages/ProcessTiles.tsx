import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { FUNCTION_REGISTRY, type FunctionId } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { FunctionTile } from '../components/tiles/FunctionTile';
import { RequestFunctionAuditTile } from '../components/tiles/RequestFunctionAuditTile';
import { fetchProcessTiles, type ApiTiles } from '../lib/api/tilesApi';
import { workspacePath } from '../lib/processRoutes';
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

  const tilesQuery = useQuery({
    queryKey: ['process', processId, 'tiles'],
    queryFn: () => fetchProcessTiles(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  // Fire a hydrate once if we don't recognize the process locally — avoids a
  // flash of "not found" on hard refresh in a new browser.
  useState(() => {
    if (!process && processId) void hydrateProcesses();
    return 0;
  });

  if (!processId) return <Navigate to="/" replace />;

  const tiles = tilesQuery.data ?? EMPTY_TILES;

  return (
    <AppShell process={process ?? undefined}>
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
          >
            <ArrowLeft size={14} /> All processes
          </Link>
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FUNCTION_REGISTRY.map((fn) => (
            <FunctionTile
              key={fn.id}
              functionId={fn.id as FunctionId}
              label={fn.label}
              stats={tiles[fn.id as FunctionId]}
              onOpen={() => navigate(workspacePath(processId, fn.id))}
            />
          ))}
          <RequestFunctionAuditTile onClick={() => setModalOpen(true)} />
        </div>

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
