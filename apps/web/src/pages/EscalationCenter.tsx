import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { EscalationFilters, type SlaFilter } from '../components/escalations/EscalationFilters';
import { EscalationPanel } from '../components/escalations/EscalationPanel';
import { EscalationSummaryBar } from '../components/escalations/EscalationSummaryBar';
import { ManagerTable, type SortKey } from '../components/escalations/ManagerTable';
import { SavedViewsRail } from '../components/escalations/SavedViewsRail';
import { ShortcutOverlay } from '../components/escalations/ShortcutOverlay';
import { BulkComposer } from '../components/escalations/BulkComposer';
import { ResolutionDrawer } from '../components/directory/ResolutionDrawer';
import { useCurrentUser } from '../components/auth/authContext';
import { fetchProcessEscalations } from '../lib/api/escalationsApi';
import { bulkAcknowledge, bulkReescalate, bulkResolve, bulkSnooze } from '../lib/api/bulkTrackingApi';
import { processDashboardPath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';

function parseStagesParam(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function serializeStagesParam(s: Set<string>): string {
  return [...s].sort().join(',');
}

function slaBucket(row: ProcessEscalationManagerRow, now: number): SlaFilter {
  if (row.resolved || !row.slaDueAt) return 'ok';
  const t = new Date(row.slaDueAt).getTime();
  if (t < now) return 'breached';
  if (t < now + 48 * 3600000) return 'due_soon';
  return 'ok';
}

export function EscalationCenter() {
  const { processId } = useParams<{ processId: string }>();
  const [search, setSearch] = useSearchParams();
  const process = useAppStore((state) => state.processes.find((p) => p.id === processId || p.displayCode === processId));
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const currentUser = useCurrentUser();

  const [panelRow, setPanelRow] = useState<ProcessEscalationManagerRow | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [bulkComposerOpen, setBulkComposerOpen] = useState(false);
  const [selectedTrackingIds, setSelectedTrackingIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const sortKey = (search.get('sort') as SortKey) || 'issues';
  const engine = (search.get('engine') as FunctionId) || '';
  const sla = (search.get('sla') as SlaFilter) || 'all';
  const assignedToMe = search.get('mine') === '1';

  const selectedStages = useMemo(() => parseStagesParam(search.get('stages')), [search]);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      }, { replace: true });
    },
    [setSearch],
  );

  useEffect(() => {
    if (!process && processId) void hydrateProcesses();
  }, [hydrateProcesses, process, processId]);

  const q = useQuery({
    queryKey: ['escalations', processId],
    queryFn: () => fetchProcessEscalations(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  const stages = useMemo(() => {
    const rows = q.data?.rows ?? [];
    const s = new Set<string>();
    for (const r of rows) {
      if (r.stage) s.add(String(r.stage));
    }
    return [...s].sort();
  }, [q.data?.rows]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const filteredRows = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return rows.filter((row) => {
      if (engine && (row.countsByEngine[engine] ?? 0) === 0) return false;
      if (assignedToMe && currentUser?.email) {
        const em = (row.resolvedEmail ?? '').toLowerCase();
        if (em !== currentUser.email.toLowerCase()) return false;
      }
      if (selectedStages.size > 0 && row.stage && !selectedStages.has(String(row.stage))) return false;
      if (sla !== 'all') {
        const b = slaBucket(row, currentTime);
        if (b !== sla) return false;
      }
      return true;
    });
  }, [assignedToMe, currentTime, currentUser?.email, engine, q.data?.rows, selectedStages, sla]);

  const toggleStage = (stage: string) => {
    const next = new Set(selectedStages);
    if (next.has(stage)) next.delete(stage);
    else next.add(stage);
    setParam({ stages: next.size ? serializeStagesParam(next) : null });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setShortcutOpen(true);
      } else if (event.key === 'c' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        setBulkComposerOpen(true);
      } else if (event.key === 'r' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        void bulkResolve([...selectedTrackingIds]).then(() => q.refetch());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, q, selectedTrackingIds]);

  if (!processId) return <Navigate to="/" replace />;
  if (!process) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500 dark:bg-gray-950">
        Loading…
      </div>
    );
  }

  const summary = q.data?.summary;
  const unmapped = summary?.unmappedManagerCount ?? 0;

  return (
    <AppShell process={process}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 lg:flex-row lg:px-6">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link
              to={processDashboardPath(process.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
            >
              <ArrowLeft size={14} /> Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Escalation Center</h1>
          </div>

          {q.isError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {(q.error as Error).message}
            </div>
          ) : null}

          {unmapped > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <span>
                {unmapped} manager{unmapped === 1 ? '' : 's'} in these findings aren&apos;t in the directory. Notifications can&apos;t be sent until they&apos;re resolved.
              </span>
              <button
                type="button"
                className="rounded border border-amber-300 px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                onClick={() => setResolveOpen(true)}
              >
                Resolve
              </button>
            </div>
          ) : null}

          {summary ? <EscalationSummaryBar summary={summary} /> : null}

          {selectedTrackingIds.size > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
              <span>{selectedTrackingIds.size} selected</span>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => setBulkComposerOpen(true)}
              >
                Compose
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => {
                  void bulkAcknowledge([...selectedTrackingIds]).then((res) => {
                    if (res.skipped.length) {
                      window.alert(`${res.applied} acknowledged, ${res.skipped.length} skipped.`);
                    }
                    void q.refetch();
                  });
                }}
              >
                Acknowledge
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => {
                  const raw = window.prompt('Snooze for how many days? (1 – 90)', '3');
                  if (!raw) return;
                  const days = Number.parseInt(raw, 10);
                  if (!Number.isFinite(days) || days < 1 || days > 90) {
                    window.alert('Enter a number between 1 and 90.');
                    return;
                  }
                  void bulkSnooze([...selectedTrackingIds], days).then(() => q.refetch());
                }}
              >
                Snooze
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => {
                  void bulkReescalate([...selectedTrackingIds]).then((res) => {
                    if (res.skipped.length) {
                      window.alert(`${res.applied} re-escalated, ${res.skipped.length} skipped.`);
                    }
                    void q.refetch();
                  });
                }}
              >
                Re-escalate
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => {
                  void bulkResolve([...selectedTrackingIds]).then(() => q.refetch());
                }}
              >
                Resolve
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
                onClick={() => setSelectedTrackingIds(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}

          <div className="flex min-h-[480px] gap-4">
            <EscalationFilters
              stages={stages}
              selectedStages={selectedStages}
              onToggleStage={toggleStage}
              engine={engine}
              onEngine={(v) => setParam({ engine: v || null })}
              sla={sla}
              onSla={(v) => setParam({ sla: v === 'all' ? null : v })}
              assignedToMe={assignedToMe}
              onAssignedToMe={(v) => setParam({ mine: v ? '1' : null })}
            />
            <div className="w-52 shrink-0">
              <SavedViewsRail
                current={Object.fromEntries(search.entries())}
                onApply={(filters) => {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(filters)) params.set(key, value);
                  setSearch(params, { replace: true });
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <ManagerTable
                processId={process.id}
                rows={filteredRows}
                selectedTrackingIds={selectedTrackingIds}
                onToggleTracking={(trackingId) => {
                  setSelectedTrackingIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(trackingId)) next.delete(trackingId);
                    else next.add(trackingId);
                    return next;
                  });
                }}
                onToggleAllVisible={(trackingIds) => {
                  setSelectedTrackingIds((prev) => {
                    const next = new Set(prev);
                    const allSelected = trackingIds.every((id) => next.has(id));
                    if (allSelected) trackingIds.forEach((id) => next.delete(id));
                    else trackingIds.forEach((id) => next.add(id));
                    return next;
                  });
                }}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onOpenPanel={(row) => {
                  setPanelRow(row);
                  setPanelOpen(true);
                }}
                sortKey={sortKey}
                onSortKey={(k) => setParam({ sort: k === 'issues' ? null : k })}
                engineFilter={engine}
                onEngineFromPill={(fid) => setParam({ engine: engine === fid ? null : fid })}
              />
            </div>
          </div>
        </div>
      </div>

      <EscalationPanel
        processId={process.id}
        processDisplayCode={process.displayCode ?? process.id}
        row={panelRow}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />

      <ResolutionDrawer
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        rawNames={(q.data?.rows ?? []).filter((r) => r.isUnmapped).map((r) => r.managerName)}
        onResolved={() => {
          void q.refetch();
          setResolveOpen(false);
        }}
      />
      <ShortcutOverlay open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <BulkComposer
        trackingIds={[...selectedTrackingIds]}
        open={bulkComposerOpen}
        onClose={() => {
          setBulkComposerOpen(false);
          void q.refetch();
        }}
      />
    </AppShell>
  );
}
