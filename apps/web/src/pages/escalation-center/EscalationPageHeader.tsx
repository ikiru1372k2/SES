import { Megaphone, RefreshCw } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ProcessEscalationManagerRow, ProcessEscalationsPayload } from '@ses/domain';
import { AnalyticsStrip } from '../../components/escalations/AnalyticsStrip';
import { EscalationSummaryBar } from '../../components/escalations/EscalationSummaryBar';

interface EscalationPageHeaderProps {
  needsVerification: boolean;
  onToggleNeedsVerification: () => void;
  q: UseQueryResult<ProcessEscalationsPayload, Error>;
  onRefresh: () => void;
  onBroadcast: () => void;
  unmapped: number;
  onResolveUnmapped: () => void;
  currentTime: number;
  rows: ProcessEscalationManagerRow[];
}

export function EscalationPageHeader({
  needsVerification,
  onToggleNeedsVerification,
  q,
  onRefresh,
  onBroadcast,
  unmapped,
  onResolveUnmapped,
  currentTime,
  rows,
}: EscalationPageHeaderProps) {
  const summary = q.data?.summary;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white">Escalation Center</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleNeedsVerification}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
            needsVerification
              ? 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
              : 'border border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300'
          }`}
          title="Show only rows marked RESOLVED that still need auditor verification"
        >
          Needs verification
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
          title="Force a refresh — only needed if the live feed has dropped"
        >
          <RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          type="button"
          onClick={onBroadcast}
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
            onClick={onResolveUnmapped}
          >
            Resolve
          </button>
        </div>
      ) : null}

      <AnalyticsStrip rows={rows} now={currentTime} />

      {summary ? <EscalationSummaryBar summary={summary} /> : null}
    </>
  );
}
