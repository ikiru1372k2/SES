import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onRealtimeEvent } from '../realtime/socket';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCoalescedInvalidator } from '../hooks/useCoalescedInvalidator';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Megaphone, RefreshCw, Search, Send, X } from 'lucide-react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_REGISTRY } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/shared/Button';
import { usePageHeader } from '../components/layout/usePageHeader';
import { EscalationFilters, VERIFIED_STAGE_KEY, type SlaFilter } from '../components/escalations/EscalationFilters';
import { EscalationPanel } from '../components/escalations/EscalationPanel';
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
  const [bulkMoreOpen, setBulkMoreOpen] = useState(false);
  const bulkMoreRef = useRef<HTMLDivElement>(null);
  const [selectedTrackingIds, setSelectedTrackingIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const sortKey = (search.get('sort') as SortKey) || 'priority';
  const sla = (search.get('sla') as SlaFilter) || 'all';
  const assignedToMe = search.get('mine') === '1';
  // #76: surface RESOLVED-but-unverified rows for the verification step.
  const needsVerification = search.get('needsVerification') === '1';

  const selectedStages = useMemo(() => parseStagesParam(search.get('stages')), [search]);
  const selectedEngines = useMemo(() => parseEnginesParam(search.get('engine')), [search]);
  // Set by the workspace "Escalate" button (?project=<projectNo>): filter the
  // table to managers who own findings in that project and preselect them so
  // the bulk Compose bar is ready (CC's all of them).
  const projectFilter = search.get('project');
  // Free-text search across manager name, email, and any owned project
  // number/name. Persisted in the URL (?q=) like the other filters.
  const searchQuery = (search.get('q') ?? '').trim().toLowerCase();
  const appliedProjectRef = useRef<string | null>(null);

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

  const pendingVerificationCount = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return rows.filter((row) => row.stage === 'RESOLVED' && !row.verifiedAt).length;
  }, [q.data?.rows]);

  const savedViewCounts = useMemo(() => {
    const rows = q.data?.rows ?? [];
    const mine = currentUser?.email?.toLowerCase();
    let breached = 0;
    let assignedToMe = 0;
    let needsVerification = 0;
    let effortPlanning = 0;

    const planningEngines: FunctionId[] = ['missing-plan', 'over-planning'];

    for (const row of rows) {
      if (row.stage === 'RESOLVED' && !row.verifiedAt) needsVerification += 1;
      if (row.resolved) continue;

      const b = slaBucket(row, currentTime);
      if (b === 'breached') breached += 1;
      const em = (effectiveManagerEmail(row) ?? '').toLowerCase();
      if (mine && em === mine) assignedToMe += 1;
      if (planningEngines.some((e) => (row.countsByEngine[e] ?? 0) > 0)) effortPlanning += 1;
    }

    return { breached, assignedToMe, needsVerification, effortPlanning };
  }, [currentTime, currentUser?.email, q.data?.rows]);

  const onHeaderRefresh = useCallback(() => {
    void q.refetch();
    void queryClient.invalidateQueries({ queryKey: ['directory-suggestions'] });
  }, [q, queryClient]);

  const onHeaderBroadcastOpen = useCallback(() => setBroadcastOpen(true), []);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process?.name ?? 'Process', to: process ? processDashboardPath(process.displayCode ?? process.id) : undefined },
      ],
      primaryActions: [
        {
          id: 'ec-refresh',
          label: 'Refresh',
          icon: RefreshCw,
          variant: 'secondary' as const,
          tooltip: 'Force a refresh — only needed if the live feed has dropped',
          loading: q.isFetching,
          onClick: onHeaderRefresh,
        },
        {
          id: 'ec-broadcast',
          label: 'Broadcast',
          icon: Megaphone,
          variant: 'primary' as const,
          tooltip: 'Send one message to every manager with open findings',
          onClick: onHeaderBroadcastOpen,
        },
      ],
    }),
    [onHeaderBroadcastOpen, onHeaderRefresh, process, q.isFetching],
  );
  usePageHeader(headerConfig);

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


  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!bulkMoreOpen) return;
    function onDoc(ev: MouseEvent) {
      if (!bulkMoreRef.current?.contains(ev.target as Node)) setBulkMoreOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [bulkMoreOpen]);

  const filteredRows = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return rows.filter((row) => {
      // Resolved rows often have zero open counts per engine, so an engine
      // filter would hide them and a freshly-verified manager would "vanish".
      // Keep resolved/verified rows visible so the board still shows the
      // RESOLVED state instead of dropping the row entirely.
      const isResolvedRow = row.resolved || row.stage === 'RESOLVED';
      if (
        selectedEngines.size > 0 &&
        !isResolvedRow &&
        ![...selectedEngines].some((fid) => (row.countsByEngine[fid] ?? 0) > 0)
      ) {
        return false;
      }
      if (assignedToMe && currentUser?.email) {
        const em = (effectiveManagerEmail(row) ?? '').toLowerCase();
        if (em !== currentUser.email.toLowerCase()) return false;
      }
      if (selectedStages.size > 0) {
        // "Verified" is a flag, not a stage. "Resolved" means RESOLVED but
        // not yet verified, so the two ladder rows stay mutually exclusive.
        const isVerified = row.stage === 'RESOLVED' && Boolean(row.verifiedAt);
        const matchesStage = [...selectedStages].some((sel) => {
          if (sel === VERIFIED_STAGE_KEY) return isVerified;
          if (sel === 'RESOLVED') return row.stage === 'RESOLVED' && !row.verifiedAt;
          return String(row.stage) === sel;
        });
        if (!matchesStage) return false;
      }
      if (sla !== 'all') {
        const b = slaBucket(row, currentTime);
        if (b !== sla) return false;
      }
      if (needsVerification && !(row.stage === 'RESOLVED' && !row.verifiedAt)) return false;
      if (projectFilter) {
        const touches = Object.values(row.findingsByEngine ?? {}).some((refs) =>
          (refs ?? []).some((f) => f.projectNo === projectFilter),
        );
        if (!touches) return false;
      }
      if (searchQuery) {
        const haystack = [
          row.managerName ?? '',
          effectiveManagerEmail(row) ?? '',
          ...Object.values(row.findingsByEngine ?? {}).flatMap((refs) =>
            (refs ?? []).flatMap((f) => [f.projectNo ?? '', f.projectName ?? '']),
          ),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });
  }, [assignedToMe, currentTime, currentUser, selectedEngines, needsVerification, projectFilter, searchQuery, q.data?.rows, selectedStages, sla]);

  // When arriving with ?project=, preselect exactly the managers touching
  // that project so the bulk Compose bar is ready (CC's all). Applied once
  // per distinct projectFilter value, only after the rows query has
  // resolved — so a fresh load or SPA nav selects the right set and stale
  // selection from a previous project never lingers. The ref guard then
  // stops realtime refetches from re-clobbering manual changes.
  useEffect(() => {
    if (!projectFilter) {
      appliedProjectRef.current = null;
      return;
    }
    if (appliedProjectRef.current === projectFilter) return;
    if (!q.data) return; // wait for rows; effect re-runs when q.data arrives
    appliedProjectRef.current = projectFilter;
    // Derive the project's managers directly from the raw query rows using
    // the same predicate as the filter — self-contained so it can't race
    // the `filteredRows` memo (which previously yielded an unfiltered set on
    // the first render after data arrived, causing a wrong "N selected").
    const ids = (q.data.rows ?? [])
      .filter((row) =>
        Object.values(row.findingsByEngine ?? {}).some((refs) =>
          (refs ?? []).some((f) => f.projectNo === projectFilter),
        ),
      )
      .map((row) => row.trackingId)
      .filter((id): id is string => Boolean(id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL-driven preselect, mirrors AuditResultsTab deep-link pattern
    setSelectedTrackingIds(new Set(ids));
  }, [projectFilter, q.data]);

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
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 sm:py-8 lg:px-6">
        <div className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="section-title text-[22px] font-bold leading-snug tracking-tight sm:text-2xl">
              Escalation Center
            </h1>
            <span className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant={needsVerification ? 'primary' : 'secondary'}
              onClick={() => setParam({ needsVerification: needsVerification ? null : '1' })}
              title="Show only rows marked RESOLVED that still need auditor verification"
            >
              Needs verification
              {pendingVerificationCount > 0 ? ` · ${pendingVerificationCount}` : ''}
            </Button>
          </div>

          {q.isError ? (
            <div className="mb-4 rounded-xl border border-danger-500/40 bg-danger-50 p-3.5 text-sm text-danger-700 shadow-soft dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {(q.error as Error).message}
            </div>
          ) : null}

          {unmapped > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#f3d999] bg-warning-50 px-3.5 py-3 text-sm text-warning-800 shadow-soft dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-50">
              <AlertTriangle size={18} className="shrink-0 text-warning-600 dark:text-amber-400" aria-hidden />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="font-semibold text-warning-900 dark:text-amber-100">{unmapped}</span>{' '}
                manager{unmapped === 1 ? '' : 's'} in these findings aren&apos;t in the directory. Notifications can&apos;t be sent until they&apos;re
                resolved.
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

          {selectedTrackingIds.size > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-300 bg-brand-subtle px-3.5 py-2.5 text-sm shadow-soft dark:border-brand/40 dark:bg-brand/15">
              <span className="font-semibold text-brand">{selectedTrackingIds.size} selected</span>
              <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:inline-flex">
                shortcuts: <kbd className="kbd">c</kbd> compose · <kbd className="kbd">a</kbd> ack · <kbd className="kbd">s</kbd>{' '}
                snooze · <kbd className="kbd">e</kbd> escalate · <kbd className="kbd">r</kbd> resolve ·{' '}
                <kbd className="kbd">Esc</kbd> clear
              </span>
              <span className="flex-1" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="border-brand/35 text-brand hover:border-brand hover:bg-brand-subtle hover:text-brand"
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
              <div className="relative" ref={bulkMoreRef}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkMoreOpen((o) => !o)}
                  className="gap-1.5 pr-2"
                >
                  More <ChevronDown size={13} aria-hidden />
                </Button>
                {bulkMoreOpen ? (
                  <div className="absolute right-0 z-40 mt-1 w-52 rounded-lg border border-rule bg-white py-1 text-xs shadow-soft-lg dark:border-gray-700 dark:bg-gray-900">
                    <button
                      type="button"
                      className="flex w-full px-3 py-2 text-left text-ink hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                      onClick={() => {
                        setBulkMoreOpen(false);
                        setReescOpen(true);
                      }}
                    >
                      Re-escalate…
                    </button>
                    <button
                      type="button"
                      className="flex w-full px-3 py-2 text-left text-ink hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                      onClick={() => {
                        setBulkMoreOpen(false);
                        setSelectedTrackingIds(new Set());
                      }}
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}
              </div>
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
            </div>
          ) : null}

          {/* Manager list height tracks the viewport (min 560px) so tall
              tablet/desktop screens use the available space instead of a
              fixed short region; ManagerTable's overflow-auto still scrolls
              internally and the page chrome stays visible. */}
          <div className="flex flex-col gap-4 md:h-[max(560px,calc(100vh-340px))] md:flex-row md:gap-3">
            <EscalationFilters
              selectedStages={selectedStages}
              onToggleStage={toggleStage}
              selectedEngines={selectedEngines}
              onToggleEngine={toggleEngine}
              sla={sla}
              onSla={(v) => setParam({ sla: v === 'all' ? null : v })}
              assignedToMe={assignedToMe}
              onAssignedToMe={(v) => setParam({ mine: v ? '1' : null })}
            />
            <div className="flex min-h-[420px] min-w-0 flex-1 flex-col md:min-h-0">
              <div className="mb-3 shrink-0">
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={search.get('q') ?? ''}
                    onChange={(e) => setParam({ q: e.target.value })}
                    placeholder="Search managers, email, or project…"
                    aria-label="Search managers, email, or project"
                    className="w-full rounded-xl border border-rule bg-white py-2 pl-9 pr-9 text-sm text-ink shadow-soft outline-none transition-all ease-soft placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  />
                  {search.get('q') ? (
                    <button
                      type="button"
                      onClick={() => setParam({ q: null })}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-app hover:text-ink dark:hover:bg-gray-800"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
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
                onEngineFromPill={toggleEngine}
              />
            </div>
            <div className="hidden w-[200px] shrink-0 lg:block">
              <SavedViewsRail
                current={Object.fromEntries(search.entries())}
                curatorCounts={savedViewCounts}
                onApply={(filters) => {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(filters)) params.set(key, value);
                  setSearch(params, { replace: true });
                }}
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
