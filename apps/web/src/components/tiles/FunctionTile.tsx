import type { KeyboardEvent, ReactNode } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FunctionId } from '@ses/domain';
import type { ApiTileStats } from '../../lib/api/tilesApi';
import { FUNCTION_DESCRIPTIONS } from '../../lib/functionDescriptions';

interface Props {
  functionId: FunctionId;
  label: string;
  stats: ApiTileStats | undefined;
  openEscalationCount: number;
  onOpen: () => void;
  aiPilotLink?: ReactNode;
  escalationFooter?: ReactNode;
}

function openTone(count: number): 'plain' | 'warn' | 'bad' {
  if (count > 10) return 'bad';
  if (count > 0) return 'warn';
  return 'plain';
}

const openValueClass: Record<ReturnType<typeof openTone>, string> = {
  plain: 'text-ink dark:text-white',
  warn: 'text-warning-700 dark:text-amber-300',
  bad: 'text-danger-700 dark:text-red-300',
};

function TileStat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-md border border-rule-2 bg-surface-app px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-950/50">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div className={`mt-0.5 text-[15px] font-bold tabular-nums ${openValueClass[tone]}`}>{value}</div>
    </div>
  );
}

export function FunctionTile({
  functionId,
  label,
  stats,
  openEscalationCount,
  onOpen,
  aiPilotLink,
  escalationFooter,
}: Props) {
  const fileCount = stats?.fileCount ?? 0;
  const draftCount = stats?.hasDraft ? 1 : 0;
  const openToneKey = openTone(openEscalationCount);
  const description = FUNCTION_DESCRIPTIONS[functionId];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && (event.target as HTMLElement).closest('[data-tile-open]')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      const target = event.target as HTMLElement;
      if (target.closest('a')) return;
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      data-function-id={functionId}
      tabIndex={0}
      role="group"
      aria-label={`${label} function tile`}
      onKeyDown={onKeyDown}
      className="surface-card flex min-h-[170px] flex-col p-[18px] text-left transition-all ease-soft hover:-translate-y-0.5 hover:border-brand focus-within:outline focus-within:outline-2 focus-within:outline-brand dark:hover:border-brand"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight text-ink dark:text-white">{label}</h3>
          {description ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-3">{description}</p>
          ) : null}
        </div>
        {aiPilotLink ? <div className="shrink-0">{aiPilotLink}</div> : null}
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <TileStat label="Files" value={fileCount} />
        <TileStat label="Drafts" value={draftCount} />
        <TileStat label="Open" value={openEscalationCount} tone={openToneKey} />
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-rule-2 pt-3 dark:border-gray-800">
        {escalationFooter ?? (
          openEscalationCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-700 dark:bg-red-950/50 dark:text-red-300">
              {openEscalationCount} escalation{openEscalationCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-semibold text-success-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <Check size={10} aria-hidden />
              Clean
            </span>
          )
        )}
        <button
          type="button"
          data-tile-open
          onClick={onOpen}
          className="inline-flex items-center rounded-lg border border-rule bg-white px-3 py-1 text-xs font-medium text-ink shadow-soft transition-all ease-soft hover:border-brand hover:text-brand active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          Open
        </button>
      </div>
    </div>
  );
}

export function FunctionTileAiPilotLink({ functionId }: { functionId: FunctionId }) {
  return (
    <Link
      to={`/admin/ai-pilot/${functionId}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-subtle px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand hover:text-white dark:border-brand/40"
      title="Open AI Pilot for this function"
    >
      <Sparkles size={10} aria-hidden />
      AI Pilot
    </Link>
  );
}
