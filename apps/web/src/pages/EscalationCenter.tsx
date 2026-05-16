import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onRealtimeEvent } from '../realtime/socket';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCoalescedInvalidator } from '../hooks/useCoalescedInvalidator';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Megaphone, RefreshCw, Send, X } from 'lucide-react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_REGISTRY } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/shared/Button';
import { usePageHeader } from '../components/layout/usePageHeader';
import { EscalationFilters, type SlaFilter } from '../components/escalations/EscalationFilters';
import { EscalationPanel } from '../components/escalations/EscalationPanel';
import { EscalationSummaryBar } from '../components/escalations/EscalationSummaryBar';
import { ManagerTable, type SortKey } from '../components/escalations/ManagerTable';
import { SavedViewsRail } from '../components/escalations/SavedViewsRail';
import { ShortcutOverlay } from '../components/escalations/ShortcutOverlay';
import { AnalyticsStrip } from '../components/escalations/AnalyticsStrip';
import { BulkComposer } from '../components/escalations/BulkComposer';
import { BroadcastDialog } from '../components/escalations/BroadcastDialog';
import { effectiveManagerEmail } from '../components/escalations/nextAction';
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

// Engine filter is multi-select (checkbox group), serialized into the same
// comma-separated `engine` URL param the Stage filter already uses.
function parseEnginesParam(raw: string | null): Set<FunctionId> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as FunctionId[],
  );
}

function serializeEnginesParam(s: Set<FunctionId>): string {
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
  // Selection by managerKey (not row index): realtime reorders previously
  // jumped the keyboard cursor to a different manager.
  const [selectedManagerKey, setSelectedManagerKey] = useState<string | null>(null);
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
  const sla = (search.get('sla') as SlaFilter) || 'all';
  const assignedToMe = search.get('mine') === '1';
  // #76: surface RESOLVED-but-unverified rows for the verification step.
  const needsVerification = search.get('needsVerification') === '1';

  const selectedStages = useMemo(() => parseStagesParam(search.get('stages')), [search]);
  const selectedEngines = useMemo(() => parseEnginesParam(search.get('engine')), [search]);

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

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process?.name ?? 'Process', to: process ? processDashboardPath(process.displayCode ?? process.id) : undefined },
        { label: 'Escalations' },
      ],
    }),
    [process],
  );
  usePageHeader(headerConfig);

  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['escalations', processId],
    queryFn: () => fetchProcessEscalations(processId!),
    enabled: Boolean(processId),
    staleTime: 15_000,
  });

  // Live refresh via realtime gateway. Coalesce 250ms so bursts (bulk
  // actions, SLA cron cascades) trigger one refetch per key, not N.
  const invalidate = useCoalescedInvalidator(queryClient, 250);
  useEffect(() => {
    if (!processId) return;
    const off = onRealtimeEvent((envelope) => {
      if (envelope.processCode !== processId && envelope.processCode !== process?.displayCode) return;
      if (
        envelope.event === 'tracking.updated' ||
        envelope.event === 'notification.sent' ||
        envelope.event === 'version.saved'
      ) {
        invalidate(['escalations', processId]);
        // Refresh timeline when SLA cron transitions a stage.
        invalidate(['tracking-events']);
        // #77: attachments ride on tracking.updated for live sibling uploads.
        invalidate(['tracking-attachments']);
      } else if (envelope.event === 'directory.updated') {
        // #74: directory mutations may unblock previously-blocked escalations.
        invalidate(['escalations', processId]);
        invalidate(['directory-suggestions']);
      }
    });
    return off;
  }, [invalidate, process?.displayCode, processId]);

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
      if (
        selectedEngines.size > 0 &&
        ![...selectedEngines].some((fid) => (row.countsByEngine[fid] ?? 0) > 0)
      ) {
        return false;
      }
      if (assignedToMe && currentUser?.email) {
        const em = (effectiveManagerEmail(row) ?? '').toLowerCase();
        if (em !== currentUser.email.toLowerCase()) return false;
      }
      if (selectedStages.size > 0 && row.stage && !selectedStages.has(String(row.stage))) return false;
      if (sla !== 'all') {
        const b = slaBucket(row, currentTime);
        if (b !== sla) return false;
      }
      if (needsVerification && !(row.stage === 'RESOLVED' && !row.verifiedAt)) return false;
      return true;
    });
  }, [assignedToMe, currentTime, currentUser, selectedEngines, needsVerification, q.data?.rows, selectedStages, sla]);

  const toggleStage = (stage: string) => {
    const next = new Set(selectedStages);
    if (next.has(stage)) next.delete(stage);
    else next.add(stage);
    setParam({ stages: next.size ? serializeStagesParam(next) : null });
  };

  const toggleEngine = (fid: FunctionId) => {
    const next = new Set(selectedEngines);
    if (next.has(fid)) next.delete(fid);
    else next.add(fid);
    setParam({ engine: next.size ? serializeEnginesParam(next) : null });
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
        // Clear bulk selection only when no modal is open.
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:py-8 lg:flex-row lg:px-6">
        <div className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="section-title text-xl sm:text-2xl">Escalation Center</h1>
            <span className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant={needsVerification ? 'primary' : 'secondary'}
              onClick={() => setParam({ needsVerification: needsVerification ? null : '1' })}
              title="Show only rows marked RESOLVED that still need auditor verification"
            >
              Needs verification
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void q.refetch();
                void queryClient.invalidateQueries({ queryKey: ['directory-suggestions'] });
              }}
              disabled={q.isFetching}
              leading={<RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />}
              title="Force a refresh — only needed if the live feed has dropped"
            >
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setBroadcastOpen(true)}
              leading={<Megaphone size={14} />}
              title="Send one message to every manager with open findings"
            >
              Broadcast
            </Button>
          </div>

          {q.isError ? (
            <div className="mb-4 rounded-xl border border-danger-500/40 bg-danger-50 p-3.5 text-sm text-danger-700 shadow-soft dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {(q.error as Error).message}
            </div>
          ) : null}

          {unmapped > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-500/40 bg-warning-50 p-3.5 text-sm text-warning-700 shadow-soft dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <span>
                {unmapped} manager{unmapped === 1 ? '' : 's'} in these findings aren&apos;t in the directory. Notifications can&apos;t be sent until they&apos;re resolved.
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setResolveOpen(true)}
              >
                Resolve owners
              </Button>
            </div>
          ) : null}

          <AnalyticsStrip rows={q.data?.rows ?? []} now={currentTime} />

          {summary ? <EscalationSummaryBar summary={summary} /> : null}

          {selectedTrackingIds.size > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-300 bg-brand-subtle px-3.5 py-2.5 text-sm shadow-soft dark:border-brand/40 dark:bg-brand/10">
              <span className="font-semibold text-brand">
                {selectedTrackingIds.size} selected
              </span>
              <span className="hidden text-[11px] text-ink-3 sm:inline">
                Shortcuts: <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">c</kbd> compose ·{' '}
                <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">a</kbd> ack ·{' '}
                <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">s</kbd> snooze ·{' '}
                <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">e</kbd> escalate ·{' '}
                <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">r</kbd> resolve ·{' '}
                <kbd className="rounded-sm border border-rule bg-white px-1 font-mono text-[10px] dark:border-gray-700 dark:bg-gray-800">esc</kbd> clear
              </span>
              <span className="flex-1" />
              <Button
                type="button"
                size="sm"
                onClick={() => setBulkComposerOpen(true)}
                leading={<Send size={13} />}
              >
                Compose
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAckOpen(true)}
              >
                Acknowledge
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSnoozeOpen(true)}
              >
                Snooze
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => setReescOpen(true)}
              >
                Re-escalate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
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
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedTrackingIds(new Set())}
                aria-label="Clear selection"
                leading={<X size={13} />}
              >
                Clear
              </Button>
            </div>
          ) : null}

          {/* Cap the manager list at ~560px so ManagerTable's overflow-auto
              scrolls internally; the surrounding page still scrolls. */}
          <div className="flex flex-col gap-4 md:h-[560px] md:flex-row">
            <EscalationFilters
              stages={stages}
              selectedStages={selectedStages}
              onToggleStage={toggleStage}
              selectedEngines={selectedEngines}
              onToggleEngine={toggleEngine}
              sla={sla}
              onSla={(v) => setParam({ sla: v === 'all' ? null : v })}
              assignedToMe={assignedToMe}
              onAssignedToMe={(v) => setParam({ mine: v ? '1' : null })}
            />
            <div className="hidden w-52 shrink-0 lg:block">
              <SavedViewsRail
                current={Object.fromEntries(search.entries())}
                onApply={(filters) => {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(filters)) params.set(key, value);
                  setSearch(params, { replace: true });
                }}
              />
            </div>
            <div className="flex min-h-[420px] min-w-0 flex-1 flex-col md:min-h-0">
              <ManagerTable
                rows={filteredRows}
                now={currentTime}
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
                selectedManagerKey={selectedManagerKey}
                onSelectManagerKey={setSelectedManagerKey}
                onOpenPanel={(row) => {
                  setPanelRow(row);
                  setPanelOpen(true);
                }}
                sortKey={sortKey}
                onSortKey={(k) => setParam({ sort: k === 'priority' ? null : k })}
                selectedEngines={selectedEngines}
                onEngineFromPill={toggleEngine}
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
          (q.data?.rows ?? []).filter((r) => !r.resolved && Boolean(effectiveManagerEmail(r))).length
        }
        functionOptions={FUNCTION_REGISTRY.map((f) => ({ id: f.id, label: f.label }))}
      />
    </AppShell>
  );
}
