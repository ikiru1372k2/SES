import type { KeyboardEvent, ReactNode } from 'react';
import { FileSpreadsheet, Clock3, AlertCircle } from 'lucide-react';
import type { FunctionId } from '@ses/domain';
import type { ApiTileStats } from '../../lib/api/tilesApi';

interface Props {
  functionId: FunctionId;
  label: string;
  stats: ApiTileStats | undefined;
  onOpen: () => void;
  footer?: ReactNode;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'No uploads yet';
  const when = new Date(iso);
  const delta = Date.now() - when.getTime();
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return when.toLocaleDateString();
}

/**
 * Presentational tile. Pure — no data fetching inside. The parent page
 * (`ProcessTiles`) is responsible for sourcing `stats` in a single round-trip.
 * That separation lets us reuse the same tile under admin dashboards without
 * duplicating network logic.
 */
export function FunctionTile({ functionId, label, stats, onOpen, footer }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  }

  const fileCount = stats?.fileCount ?? 0;
  const hasDraft = Boolean(stats?.hasDraft);

  return (
    <button
      type="button"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      data-function-id={functionId}
      className="group flex min-h-[132px] flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 text-left transition hover:border-brand hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-brand" />
          <h3 className="text-base font-semibold">{label}</h3>
        </div>
        {hasDraft ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertCircle size={10} /> Unsaved draft
          </span>
        ) : null}
      </div>
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">{fileCount}</span>{' '}
          {fileCount === 1 ? 'file' : 'files'}
        </div>
        <div className="flex items-center gap-1">
          <Clock3 size={12} />
          {formatRelative(stats?.lastUploadAt ?? null)}
        </div>
        {footer ? <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">{footer}</div> : null}
      </div>
    </button>
  );
}
