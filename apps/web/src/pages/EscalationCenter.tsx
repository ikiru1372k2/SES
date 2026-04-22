import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onRealtimeEvent } from '../realtime/socket';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_REGISTRY } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { EscalationFilters, type SlaFilter } from '../components/escalations/EscalationFilters';
import { EscalationPanel } from '../components/escalations/EscalationPanel';
import { EscalationSummaryBar } from '../components/escalations/EscalationSummaryBar';
import { ManagerTable, type SortKey } from '../components/escalations/ManagerTable';
import { SavedViewsRail } from '../components/escalations/SavedViewsRail';
import { ShortcutOverlay } from '../components/escalations/ShortcutOverlay';
import { AnalyticsStrip } from '../components/escalations/AnalyticsStrip';
import { BulkComposer } from '../components/escalations/BulkComposer';
import { BroadcastDialog } from '../components/escalations/BroadcastDialog';
import {
  AcknowledgeDialog,
  ReescalateDialog,
  SnoozeDialog,
} from '../components/escalations/BulkActionDialog';
import toast from 'react-hot-toast';
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
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [reescOpen, setReescOpen] = useState(false);
  const [selectedTrackingIds, setSelectedTrackingIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const sortKey = (search.get('sort') as SortKey) || 'priority';
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

  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['escalations', processId],
    queryFn: () => fetchProcessEscalations(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  // Live refresh. The realtime gateway emits whenever anyone (another
  // user, the SLA cron, a bulk-action endpoint) changes tracking state
  // on this process. Previously the EscalationCenter only refetched on
  // user interaction; now it refetches quietly in the background so the
  // page always reflects the current system state.
  useEffect(() => {
    if (!processId) return;
    const off = onRealtimeEvent((envelope) => {
      if (envelope.processCode !== processId && envelope.processCode !== process?.displayCode) return;
      if (
        envelope.event === 'tracking.updated' ||
        envelope.event === 'notification.sent' ||
        envelope.event === 'audit.completed'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['escalations', processId] });
        // Invalidate any open tracking-events queries too so the timeline
        // auto-advances when the SLA cron transitions a stage.
        void queryClient.invalidateQueries({ queryKey: ['tracking-events'] });
      }
    });
    return off;
  }, [process?.displayCode, processId, queryClient]);

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
      } else if (event.key === 'Escape' && selectedTrackingIds.size > 0) {
        // Predictable get-me-out-of-here: clears the current bulk selection
        // only when nothing more modal is already open.
        if (!ackOpen && !snoozeOpen && !reescOpen && !bulkComposerOpen) {
          setSelectedTrackingIds(new Set());
        }
      } else if (event.key === 'c' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        setBulkComposerOpen(true);
      } else if (event.key === 'a' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        setAckOpen(true);
      } else if (event.key === 's' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        setSnoozeOpen(true);
      } else if (event.key === 'e' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        setReescOpen(true);
      } else if (event.key === 'r' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        void bulkResolve([...selectedTrackingIds])
          .then((res) => {
            toast.success(`${res.count} resolved.`);
            void q.refetch();
          })
          .catch((err: Error) => toast.error(err.message));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ackOpen, bulkComposerOpen, panelOpen, q, reescOpen, selectedTrackingIds, snoozeOpen]);

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
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
              title="Send one message to every manager with open findings"
            >
              <Megaphone size={14} /> Broadcast
            </button>
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

          <AnalyticsStrip rows={q.data?.rows ?? []} now={currentTime} />

          {summary ? <EscalationSummaryBar summary={summary} /> : null}

          {selectedTrackingIds.size > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
              <span className="font-medium text-brand">
                {selectedTrackingIds.size} selected
              </span>
              <span className="text-[11px] text-gray-500">
                Shortcuts: <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">c</kbd> compose ·{' '}
                <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">a</kbd> ack ·{' '}
                <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">s</kbd> snooze ·{' '}
                <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">e</kbd> escalate ·{' '}
                <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">r</kbd> resolve ·{' '}
                <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">esc</kbd> clear
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={() => setBulkComposerOpen(true)}
              >
                Compose
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={() => setAckOpen(true)}
              >
                Acknowledge
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={() => setSnoozeOpen(true)}
              >
                Snooze
              </button>
              <button
                type="button"
                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                onClick={() => setReescOpen(true)}
              >
                Re-escalate
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={() => {
                  void bulkResolve([...selectedTrackingIds])
                    .then((res) => {
                      toast.success(`${res.count} resolved.`);
                      void q.refetch();
                    })
                    .catch((err: Error) => toast.error(err.message));
                }}
              >
                Resolve
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={() => setSelectedTrackingIds(new Set())}
                aria-label="Clear selection"
              >
                Clear
              </button>
            </div>
          ) : null}

          {/* Fixed-height panel so the ManagerTable's existing
              `overflow-auto` scrolls internally instead of growing
              unbounded. The page itself still scrolls normally for
              everything above and below — this just caps the manager
              list at ~560px so users can see several rows and scroll
              the rest within the panel rather than losing the summary
              cards when paging through 15+ managers. */}
          <div className="flex h-[560px] gap-4">
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
            <div className="flex min-w-0 flex-1 flex-col">
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
                onSortKey={(k) => setParam({ sort: k === 'priority' ? null : k })}
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
      <AcknowledgeDialog
        open={ackOpen}
        onClose={() => setAckOpen(false)}
        count={selectedTrackingIds.size}
        onDone={() => {
          setSelectedTrackingIds(new Set());
          void q.refetch();
        }}
        runAction={(note) => bulkAcknowledge([...selectedTrackingIds], note || undefined)}
      />
      <SnoozeDialog
        open={snoozeOpen}
        onClose={() => setSnoozeOpen(false)}
        count={selectedTrackingIds.size}
        onDone={() => {
          setSelectedTrackingIds(new Set());
          void q.refetch();
        }}
        runAction={(days, note) => bulkSnooze([...selectedTrackingIds], days, note || undefined)}
      />
      <ReescalateDialog
        open={reescOpen}
        onClose={() => setReescOpen(false)}
        count={selectedTrackingIds.size}
        onDone={() => {
          setSelectedTrackingIds(new Set());
          void q.refetch();
        }}
        runAction={(note) => bulkReescalate([...selectedTrackingIds], note || undefined)}
      />
      <BroadcastDialog
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        onDone={() => void q.refetch()}
        processIdOrCode={process.displayCode ?? process.id}
        estimatedAudience={
          (q.data?.rows ?? []).filter((r) => !r.resolved && Boolean(r.resolvedEmail)).length
        }
        functionOptions={FUNCTION_REGISTRY.map((f) => ({ id: f.id, label: f.label }))}
      />
    </AppShell>
  );
}