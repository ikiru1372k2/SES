import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onRealtimeEvent } from '../realtime/socket';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCoalescedInvalidator } from '../hooks/useCoalescedInvalidator';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { EscalationFilters, type SlaFilter } from '../components/escalations/EscalationFilters';
import { ManagerTable, type SortKey } from '../components/escalations/ManagerTable';
import { SavedViewsRail } from '../components/escalations/SavedViewsRail';
import { effectiveManagerEmail } from '../components/escalations/nextAction';
import toast from 'react-hot-toast';
import { useCurrentUser } from '../components/auth/authContext';
import { fetchProcessEscalations } from '../lib/api/escalationsApi';
import { bulkResolve } from '../lib/api/bulkTrackingApi';
import { useAppStore } from '../store/useAppStore';
import { EscalationPageHeader } from './escalation-center/EscalationPageHeader';
import { BulkSelectionBar } from './escalation-center/BulkSelectionBar';
import { EscalationDialogs } from './escalation-center/EscalationDialogs';
import { useEscalationKeyboard } from './escalation-center/useEscalationKeyboard';

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
  // L4: track selection by managerKey, not row index — realtime reorders
  // were previously jumping the keyboard cursor to a different manager.
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
  const engine = (search.get('engine') as FunctionId) || '';
  const sla = (search.get('sla') as SlaFilter) || 'all';
  const assignedToMe = search.get('mine') === '1';
  // Issue #76: surface RESOLVED-but-unverified rows so auditors can finish
  // the verification step without hunting for them.
  const needsVerification = search.get('needsVerification') === '1';

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

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: process?.name ?? 'Process', to: process ? `/processes/${encodeURIComponent(process.displayCode ?? process.id)}` : undefined },
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

  // Live refresh. The realtime gateway emits whenever anyone (another
  // user, the SLA cron, a bulk-action endpoint) changes tracking state
  // on this process. Previously the EscalationCenter only refetched on
  // user interaction; now it refetches quietly in the background so the
  // page always reflects the current system state.
  // L10/E2: realtime bursts (bulk actions, SLA cron cascades) can emit
  // many events per second. Coalesce per-key invalidations to 250ms so
  // we do one refetch per key per burst instead of N.
  const invalidate = useCoalescedInvalidator(queryClient, 250);
  useEffect(() => {
    if (!processId) return;
    const off = onRealtimeEvent((envelope) => {
      if (envelope.processCode !== processId && envelope.processCode !== process?.displayCode) return;
      if (
        envelope.event === 'tracking.updated' ||
        envelope.event === 'notification.sent' ||
        envelope.event === 'audit.completed'
      ) {
        invalidate(['escalations', processId]);
        // Invalidate any open tracking-events queries too so the timeline
        // auto-advances when the SLA cron transitions a stage.
        invalidate(['tracking-events']);
        // Issue #77: attachments list rides on the same tracking.updated
        // channel so a sibling auditor's upload shows up live.
        invalidate(['tracking-attachments']);
      } else if (envelope.event === 'directory.updated') {
        // Issue #74: a Manager Directory mutation (inline-add, alias,
        // merge, archive, delete) invalidates the "unmapped manager"
        // banner and may free a previously-blocked escalation for send.
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
      if (engine && (row.countsByEngine[engine] ?? 0) === 0) return false;
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
  }, [assignedToMe, currentTime, currentUser, engine, needsVerification, q.data?.rows, selectedStages, sla]);

  const toggleStage = (stage: string) => {
    const next = new Set(selectedStages);
    if (next.has(stage)) next.delete(stage);
    else next.add(stage);
    setParam({ stages: next.size ? serializeStagesParam(next) : null });
  };

  useEscalationKeyboard({
    selectedTrackingIds,
    ackOpen,
    snoozeOpen,
    reescOpen,
    bulkComposerOpen,
    panelOpen,
    q,
    onShortcutOpen: () => setShortcutOpen(true),
    onAckOpen: () => setAckOpen(true),
    onSnoozeOpen: () => setSnoozeOpen(true),
    onReescOpen: () => setReescOpen(true),
    onBulkComposerOpen: () => setBulkComposerOpen(true),
    onClearSelection: () => setSelectedTrackingIds(new Set()),
  });

  if (!processId) return <Navigate to="/" replace />;
  if (!process) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500 dark:bg-gray-950">
        Loading…
      </div>
    );
  }

  const unmapped = q.data?.summary?.unmappedManagerCount ?? 0;

  return (
    <AppShell process={process}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:py-8 lg:flex-row lg:px-6">
        <div className="min-w-0 flex-1">
          <EscalationPageHeader
            needsVerification={needsVerification}
            onToggleNeedsVerification={() => setParam({ needsVerification: needsVerification ? null : '1' })}
            q={q}
            onRefresh={() => {
              void q.refetch();
              void queryClient.invalidateQueries({ queryKey: ['directory-suggestions'] });
            }}
            onBroadcast={() => setBroadcastOpen(true)}
            unmapped={unmapped}
            onResolveUnmapped={() => setResolveOpen(true)}
            currentTime={currentTime}
            rows={q.data?.rows ?? []}
          />

          <BulkSelectionBar
            selectedTrackingIds={selectedTrackingIds}
            onCompose={() => setBulkComposerOpen(true)}
            onAck={() => setAckOpen(true)}
            onSnooze={() => setSnoozeOpen(true)}
            onReescalate={() => setReescOpen(true)}
            onResolve={() => {
              void bulkResolve([...selectedTrackingIds])
                .then((res) => {
                  toast.success(`${res.count} resolved.`);
                  void q.refetch();
                })
                .catch((err: Error) => toast.error(err.message));
            }}
            onClear={() => setSelectedTrackingIds(new Set())}
          />

          {/* Fixed-height panel so the ManagerTable's existing
              `overflow-auto` scrolls internally instead of growing
              unbounded. The page itself still scrolls normally for
              everything above and below — this just caps the manager
              list at ~560px so users can see several rows and scroll
              the rest within the panel rather than losing the summary
              cards when paging through 15+ managers. */}
          <div className="flex flex-col gap-4 md:h-[560px] md:flex-row">
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
                engineFilter={engine}
                onEngineFromPill={(fid) => setParam({ engine: engine === fid ? null : fid })}
              />
            </div>
          </div>
        </div>
      </div>

      <EscalationDialogs
        processId={process.id}
        processDisplayCode={process.displayCode ?? process.id}
        panelRow={panelRow}
        panelOpen={panelOpen}
        onPanelClose={() => setPanelOpen(false)}
        resolveOpen={resolveOpen}
        onResolveClose={() => setResolveOpen(false)}
        q={q}
        onResolved={() => {
          void q.refetch();
          setResolveOpen(false);
        }}
        shortcutOpen={shortcutOpen}
        onShortcutClose={() => setShortcutOpen(false)}
        bulkComposerOpen={bulkComposerOpen}
        onBulkComposerClose={() => {
          setBulkComposerOpen(false);
          void q.refetch();
        }}
        selectedTrackingIds={selectedTrackingIds}
        onSelectionClear={() => setSelectedTrackingIds(new Set())}
        ackOpen={ackOpen}
        onAckClose={() => setAckOpen(false)}
        snoozeOpen={snoozeOpen}
        onSnoozeClose={() => setSnoozeOpen(false)}
        reescOpen={reescOpen}
        onReescClose={() => setReescOpen(false)}
        broadcastOpen={broadcastOpen}
        onBroadcastClose={() => setBroadcastOpen(false)}
      />
    </AppShell>
  );
}
