import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BadgeCheck } from 'lucide-react';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { verifyTracking } from '../../lib/api/trackingStageApi';
import { ActivityFeed } from './ActivityFeed';
import { Composer } from './Composer';
import { FindingsTab } from './FindingsTab';

type TabId = 'findings' | 'compose' | 'activity' | 'attachments';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const trackingRef = row?.trackingId ?? row?.trackingDisplayCode ?? null;
  const awaitingVerification = Boolean(row && row.stage === 'RESOLVED' && !row.verifiedAt);
  const canVerify = Boolean(row && !row.verifiedAt);

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
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-gray-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 id="escalation-panel-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {row.managerName}
            </h2>
            <div className="text-sm text-gray-500">{row.resolvedEmail ?? '—'}</div>
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
          <button
            type="button"
            className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
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
              disabled={id === 'attachments'}
              onClick={() => setTab(id)}
              className={`flex-1 px-2 py-2 font-medium ${
                tab === id ? 'border-b-2 border-brand text-brand' : 'text-gray-500'
              } disabled:cursor-not-allowed disabled:opacity-50`}
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
            <p className="text-sm text-gray-500">Attachments will be available in a later release.</p>
          ) : null}
        </div>
        {canVerify && trackingRef ? (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <span className="text-xs text-gray-500">
              {awaitingVerification
                ? 'Manager marked resolved — review the evidence and verify to close the loop.'
                : 'Verifying closes the row to Resolved with your name stamped on it.'}
            </span>
            <button
              type="button"
              onClick={() => verifyMut.mutate()}
              disabled={verifyMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <BadgeCheck size={14} /> Verified — Resolve
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
