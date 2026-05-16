import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BadgeCheck, CheckCircle2, Maximize2, MessageCircleReply, Minimize2 } from 'lucide-react';
import { canTransition, isEscalationStage, type ProcessEscalationManagerRow } from '@ses/domain';
import { transitionTracking, verifyTracking } from '../../lib/api/trackingStageApi';
import { onRealtimeEvent } from '../../realtime/socket';
import { ActivityFeed } from './ActivityFeed';
import { AttachmentsTab } from './AttachmentsTab';
import { Composer } from './Composer';
import { FindingsTab } from './FindingsTab';
import { effectiveManagerEmail } from './nextAction';

type TabId = 'findings' | 'compose' | 'activity' | 'attachments';

const WIDTH_STORAGE_KEY = 'ses.escalationPanel.width';
const DEFAULT_WIDTH = 512;
const MIN_WIDTH = 360;
const KEYBOARD_STEP = 24;

const getMaxWidth = () => (typeof window === 'undefined' ? 1024 : Math.round(window.innerWidth * 0.95));
const getMaximizedWidth = () => (typeof window === 'undefined' ? 1024 : Math.round(window.innerWidth * 0.9));

const clampWidth = (value: number) => {
  const max = getMaxWidth();
  if (Number.isNaN(value)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(max, value));
};

const loadStoredWidth = () => {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
    return clampWidth(parsed);
  } catch {
    return DEFAULT_WIDTH;
  }
};

export function EscalationPanel({
  processId,
  processDisplayCode,
  row,
  open,
  onClose,
}: {
  processId: string;
  processDisplayCode: string;
  row: ProcessEscalationManagerRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>('findings');
  const [savedWidth, setSavedWidth] = useState<number>(() => loadStoredWidth());
  const [width, setWidth] = useState<number>(() => loadStoredWidth());
  const [isMaximized, setIsMaximized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const trackingRef = row?.trackingId ?? row?.trackingDisplayCode ?? null;

  // Reset to Findings when switching manager so we don't land on stale Composer/Activity.
  const prevManagerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = row?.managerKey ?? null;
    if (key && key !== prevManagerKeyRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab('findings');
    }
    prevManagerKeyRef.current = key;
  }, [row?.managerKey]);

  // Live-refresh on tracking.updated for this process; no polling.
  useEffect(() => {
    if (!processDisplayCode) return;
    return onRealtimeEvent((envelope) => {
      if (
        envelope.event === 'tracking.updated' &&
        (envelope.processCode === processDisplayCode || envelope.processCode === processId)
      ) {
        void qc.invalidateQueries({ queryKey: ['escalations'] });
        void qc.invalidateQueries({ queryKey: ['tracking-events', trackingRef] });
      }
    });
  }, [processDisplayCode, processId, trackingRef, qc]);
  const stage = row && isEscalationStage(row.stage) ? row.stage : null;
  const awaitingVerification = Boolean(row && row.stage === 'RESOLVED' && !row.verifiedAt);
  const managerEmail = row ? effectiveManagerEmail(row) : null;
  const canMarkResponded = Boolean(
    trackingRef &&
      row &&
      !row.resolved &&
      stage &&
      canTransition(stage, 'RESPONDED'),
  );
  const canMarkResolved = Boolean(
    trackingRef &&
      row &&
      !row.resolved &&
      stage &&
      canTransition(stage, 'RESOLVED'),
  );
  // Only surface Verify when row is RESOLVED but unverified; previously it
  // showed on any unverified row and invited bogus verifications.
  const canVerify = awaitingVerification;

  const verifyMut = useMutation({
    mutationFn: () => {
      if (!trackingRef) return Promise.reject(new Error('No tracking row'));
      return verifyTracking(trackingRef);
    },
    onSuccess: () => {
      toast.success('Verified — moved to Resolved.');
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      void qc.invalidateQueries({ queryKey: ['tracking-events', trackingRef] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transitionMut = useMutation({
    mutationFn: (payload: { to: 'RESPONDED' | 'RESOLVED'; reason: string; sourceAction: string }) => {
      if (!trackingRef) return Promise.reject(new Error('No tracking row'));
      return transitionTracking(trackingRef, payload);
    },
    onSuccess: (result) => {
      toast.success(result.stage === 'RESOLVED' ? 'Marked resolved.' : 'Marked as manager responded.');
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      void qc.invalidateQueries({ queryKey: ['tracking-events', trackingRef] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const persistWidth = useCallback((next: number) => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(next)));
    } catch {
      // storage may be unavailable (private mode, quota); width still applies in-session
    }
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      let latestWidth = width;
      const onMove = (e: PointerEvent) => {
        const next = clampWidth(window.innerWidth - e.clientX);
        latestWidth = next;
        setWidth(next);
      };
      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        setIsMaximized(false);
        setSavedWidth(latestWidth);
        persistWidth(latestWidth);
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [persistWidth, width],
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      let next = width;
      if (event.key === 'ArrowLeft') next = clampWidth(width + KEYBOARD_STEP);
      else if (event.key === 'ArrowRight') next = clampWidth(width - KEYBOARD_STEP);
      else if (event.key === 'Home') next = clampWidth(getMaxWidth());
      else if (event.key === 'End') next = MIN_WIDTH;
      setWidth(next);
      setSavedWidth(next);
      setIsMaximized(false);
      persistWidth(next);
    },
    [persistWidth, width],
  );

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setWidth(clampWidth(savedWidth));
      setIsMaximized(false);
    } else {
      setWidth(clampWidth(getMaximizedWidth()));
      setIsMaximized(true);
    }
  }, [isMaximized, savedWidth]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      setWidth((prev) => {
        if (isMaximized) return clampWidth(getMaximizedWidth());
        return clampWidth(prev);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, isMaximized]);

  useEffect(() => {
    if (!open) return;
    const el = panelRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    el?.focus();
  }, [open, row?.managerKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const sla = row.slaDueAt ? new Date(row.slaDueAt) : null;
  const slaText = sla ? sla.toLocaleString() : '—';

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escalation-panel-title"
        className="relative flex h-full w-full flex-col bg-white shadow-modal dark:bg-gray-950"
        style={{ width: `${width}px`, maxWidth: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={getMaxWidth()}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={toggleMaximize}
          className="absolute left-0 top-0 z-10 flex h-full w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center bg-transparent outline-none transition-colors hover:bg-brand/60 focus-visible:bg-brand"
          title="Drag to resize · Double-click to maximize"
        />
        <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 id="escalation-panel-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {row.managerName}
            </h2>
            <div className="text-sm text-gray-500">{managerEmail ?? '—'}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{row.stage ?? '—'}</span>
              <span className="text-gray-500">SLA: {slaText}</span>
              {awaitingVerification ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  Awaiting auditor verification
                </span>
              ) : null}
              {row.verifiedAt ? (
                <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-900 dark:bg-green-900/40 dark:text-green-100">
                  Verified {row.verifiedByName ? `by ${row.verifiedByName}` : ''}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={toggleMaximize}
              aria-label={isMaximized ? 'Restore panel width' : 'Maximize panel'}
              aria-pressed={isMaximized}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={onClose}
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex border-b border-gray-200 text-sm dark:border-gray-800">
          {(
            [
              ['findings', 'Findings'],
              ['compose', 'Compose'],
              ['activity', 'Activity'],
              ['attachments', 'Attachments'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 px-2 py-2 font-medium ${
                tab === id ? 'border-b-2 border-brand text-brand' : 'text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'findings' ? <FindingsTab processId={processId} row={row} /> : null}
          {tab === 'compose' ? <Composer processDisplayCode={processDisplayCode} row={row} onDone={onClose} /> : null}
          {tab === 'activity' ? (
            <ActivityFeed trackingIdOrCode={row.trackingId ?? row.trackingDisplayCode} row={row} />
          ) : null}
          {tab === 'attachments' ? (
            <AttachmentsTab trackingIdOrCode={row.trackingId ?? row.trackingDisplayCode} />
          ) : null}
        </div>
        {trackingRef && (canMarkResponded || canMarkResolved || canVerify) ? (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <span className="text-xs text-gray-500">
              {canMarkResolved
                ? 'Use Resolve when the manager has responded and the finding can be closed. Auditor verification is the final close-out step.'
                : canMarkResponded
                ? 'Use Manager responded when the manager has replied but the finding is not ready to close yet.'
                : awaitingVerification
                ? 'Manager marked resolved — review the evidence and verify to close the loop.'
                : 'Verifying closes the row to Resolved with your name stamped on it.'}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {canMarkResponded ? (
                <button
                  type="button"
                  onClick={() =>
                    transitionMut.mutate({
                      to: 'RESPONDED',
                      reason: 'manager_responded',
                      sourceAction: 'panel.mark_responded',
                    })
                  }
                  disabled={transitionMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  <MessageCircleReply size={14} /> Manager responded
                </button>
              ) : null}
              {canMarkResolved ? (
                <button
                  type="button"
                  onClick={() =>
                    transitionMut.mutate({
                      to: 'RESOLVED',
                      reason: 'manager_resolution_confirmed',
                      sourceAction: 'panel.mark_resolved',
                    })
                  }
                  disabled={transitionMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <CheckCircle2 size={14} /> Mark resolved
                </button>
              ) : null}
              {canVerify ? (
                <button
                  type="button"
                  onClick={() => verifyMut.mutate()}
                  disabled={verifyMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  <BadgeCheck size={14} /> Verified — Resolve
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
