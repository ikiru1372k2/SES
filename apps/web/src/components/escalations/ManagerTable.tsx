import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';
import { EnginePill } from './EnginePill';
import { Badge } from '../shared/Badge';
import { computePriority, effectiveManagerEmail, suggestNextAction } from './nextAction';

export type SortKey = 'priority' | 'issues' | 'stage' | 'lastContact' | 'sla';

function slaTone(row: ProcessEscalationManagerRow, now: number): 'green' | 'amber' | 'red' | 'grey' {
  if (row.resolved || !row.slaDueAt) return 'grey';
  const t = new Date(row.slaDueAt).getTime();
  if (t < now) return 'red';
  if (t < now + 48 * 3600000) return 'amber';
  return 'green';
}

function SlaDot({ tone }: { tone: 'green' | 'amber' | 'red' | 'grey' }) {
  const map = {
    green: 'bg-success-500',
    amber: 'bg-warning-500',
    red: 'bg-danger-500',
    grey: 'bg-gray-300 dark:bg-gray-600',
  } as const;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${map[tone]}`} title="SLA" />;
}

function slaCountdownLabel(row: ProcessEscalationManagerRow, now: number): string {
  if (row.resolved) return 'Resolved';
  if (!row.slaDueAt) return '—';
  const delta = new Date(row.slaDueAt).getTime() - now;
  const abs = Math.abs(delta);
  const hours = Math.round(abs / 3_600_000);
  if (hours < 1) return delta < 0 ? 'Overdue now' : 'Due < 1h';
  if (hours < 48) return delta < 0 ? `Overdue ${hours}h` : `Due in ${hours}h`;
  const days = Math.round(hours / 24);
  return delta < 0 ? `Overdue ${days}d` : `Due in ${days}d`;
}

const SLA_BADGE_TONE = {
  green: 'gray',
  amber: 'amber',
  red: 'red',
  grey: 'gray',
} as const;

export function ManagerTable({
  rows,
  now,
  selectedTrackingIds,
  onToggleTracking,
  onToggleAllVisible,
  selectedManagerKey,
  onSelectManagerKey,
  onOpenPanel,
  sortKey,
  onSortKey,
  selectedEngines,
  onEngineFromPill,
}: {
  rows: ProcessEscalationManagerRow[];
  /** Supplied by the page so the table doesn't call `Date.now()` in render. */
  now: number;
  selectedTrackingIds: Set<string>;
  onToggleTracking: (trackingId: string) => void;
  onToggleAllVisible: (trackingIds: string[]) => void;
  // L4: key-based selection — realtime re-sorts no longer jump the keyboard
  // cursor to the row that happens to be at the old index.
  selectedManagerKey: string | null;
  onSelectManagerKey: (key: string | null) => void;
  onOpenPanel: (row: ProcessEscalationManagerRow) => void;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  selectedEngines: Set<FunctionId>;
  onEngineFromPill: (engine: FunctionId) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menuRow, setMenuRow] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === 'priority') {
        // Default — the row a human should work on next is at the top.
        return computePriority(b, now) - computePriority(a, now);
      }
      if (sortKey === 'issues') return b.totalIssues - a.totalIssues;
      if (sortKey === 'stage') return String(a.stage ?? '').localeCompare(String(b.stage ?? ''));
      if (sortKey === 'lastContact') {
        const ta = a.lastContactAt ? new Date(a.lastContactAt).getTime() : 0;
        const tb = b.lastContactAt ? new Date(b.lastContactAt).getTime() : 0;
        return tb - ta;
      }
      const sa = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
      const sb = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
      return sa - sb;
    });
    return copy;
  }, [now, rows, sortKey]);

  // Resolve the keyboard cursor back to the current sorted position so
  // j/k navigate from wherever the selected manager currently lives.
  const selectedIndex = useMemo(() => {
    if (!selectedManagerKey) return -1;
    return sorted.findIndex((row) => row.managerKey === selectedManagerKey);
  }, [selectedManagerKey, sorted]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        const nextIdx = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, sorted.length - 1);
        const next = sorted[nextIdx];
        if (next) onSelectManagerKey(next.managerKey);
      } else if (e.key === 'k') {
        e.preventDefault();
        const nextIdx = selectedIndex < 0 ? 0 : Math.max(selectedIndex - 1, 0);
        const next = sorted[nextIdx];
        if (next) onSelectManagerKey(next.managerKey);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = sorted[Math.max(0, selectedIndex)];
        if (row) onOpenPanel(row);
      }
    },
    [onOpenPanel, onSelectManagerKey, selectedIndex, sorted],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Drop the selection when the row is no longer in the filtered set.
  useEffect(() => {
    if (selectedManagerKey && selectedIndex < 0) onSelectManagerKey(null);
  }, [onSelectManagerKey, selectedManagerKey, selectedIndex]);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`font-semibold uppercase tracking-wide hover:text-brand ${sortKey === key ? 'text-brand' : ''}`}
      onClick={() => onSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={wrapRef}
      className="min-h-0 flex-1 overflow-auto rounded-xl border border-rule bg-white shadow-soft dark:border-gray-700 dark:bg-gray-900"
    >
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-app text-[11px] text-ink-3 dark:bg-gray-800 dark:text-gray-400">
          <tr className="border-b border-rule dark:border-gray-700">
            <th scope="col" className="px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Select all rows"
                className="accent-brand"
                onChange={() => onToggleAllVisible(sorted.map((row) => row.trackingId).filter(Boolean) as string[])}
                checked={
                  sorted.length > 0 &&
                  sorted.every((row) => row.trackingId && selectedTrackingIds.has(row.trackingId))
                }
              />
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Manager</th>
            <th scope="col" className="px-3 py-2.5">{sortBtn('issues', 'Issues')}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold uppercase tracking-wide lg:table-cell">Engines</th>
            <th scope="col" className="hidden px-3 py-2.5 sm:table-cell">{sortBtn('stage', 'Stage')}</th>
            <th scope="col" className="hidden px-3 py-2.5 md:table-cell">{sortBtn('lastContact', 'Last contact')}</th>
            <th scope="col" className="px-3 py-2.5">{sortBtn('sla', 'SLA')}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold uppercase tracking-wide sm:table-cell">Next action</th>
            <th scope="col" className="w-10 px-2 py-2.5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const selected = idx === selectedIndex;
            const tone = slaTone(row, now);
            const managerEmail = effectiveManagerEmail(row);
            return (
              <tr
                key={row.managerKey}
                tabIndex={0}
                aria-selected={selected}
                className={`cursor-pointer border-t border-rule/70 transition-colors dark:border-gray-800 ${
                  row.resolved
                    ? 'bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-900/40'
                    : selected
                      ? 'bg-brand-subtle hover:bg-brand-subtle dark:bg-brand/10 dark:hover:bg-gray-800/80'
                      : 'hover:bg-surface-app dark:hover:bg-gray-800/80'
                } ${selected ? 'ring-1 ring-inset ring-brand/30' : ''}`}
                onClick={() => {
                  onSelectManagerKey(row.managerKey);
                  onOpenPanel(row);
                }}
              >
                <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="accent-brand"
                    disabled={!row.trackingId}
                    checked={row.trackingId ? selectedTrackingIds.has(row.trackingId) : false}
                    onChange={() => {
                      if (row.trackingId) onToggleTracking(row.trackingId);
                    }}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-ink dark:text-white">{row.managerName}</div>
                  {managerEmail ? (
                    <div className="font-mono text-[11px] text-ink-3">{managerEmail}</div>
                  ) : (
                    <div className="mt-0.5 inline-flex">
                      <Badge tone="amber">Missing email — add to directory</Badge>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink dark:text-gray-200">{row.totalIssues}</td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {FUNCTION_IDS.map((fid) => (
                      <EnginePill
                        key={fid}
                        engine={fid}
                        count={row.countsByEngine[fid] ?? 0}
                        active={selectedEngines.has(fid)}
                        onClick={() => onEngineFromPill(fid)}
                      />
                    ))}
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="gray">{row.stage ?? '—'}</Badge>
                    {row.stage === 'RESOLVED' && !row.verifiedAt ? (
                      <Badge tone="amber">Awaiting verification</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 text-xs text-ink-3 md:table-cell">
                  {row.lastContactAt ? new Date(row.lastContactAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <SlaDot tone={tone} />
                    <Badge tone={SLA_BADGE_TONE[tone]}>{slaCountdownLabel(row, now)}</Badge>
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <NextActionChip row={row} now={now} />
                </td>
                <td className="relative px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <span className="hidden items-center gap-0.5 text-xs font-medium text-ink-3 group-hover:text-brand lg:inline-flex">
                      Open <ChevronRight size={13} />
                    </span>
                    <button
                      type="button"
                      className="rounded-md p-1 text-ink-3 transition-colors hover:bg-gray-100 hover:text-ink dark:hover:bg-gray-800"
                      aria-label="Row menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuRow(menuRow === idx ? null : idx);
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                  {menuRow === idx ? (
                    <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-rule bg-white py-1 text-xs shadow-soft-lg dark:border-gray-700 dark:bg-gray-900">
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-surface-app dark:hover:bg-gray-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          const em = effectiveManagerEmail(row);
                          if (em) void navigator.clipboard.writeText(em).then(() => toast.success('Email copied')).catch(() => toast.error('Copy failed'));
                          else toast.error('No email');
                          setMenuRow(null);
                        }}
                      >
                        Copy email
                      </button>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-surface-app dark:hover:bg-gray-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPanel(row);
                          setMenuRow(null);
                        }}
                      >
                        Open panel
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const NEXT_ACTION_TONE: Record<'gray' | 'blue' | 'amber' | 'red' | 'emerald', string> = {
  gray:    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  blue:    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  amber:   'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  red:     'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

function NextActionChip({ row, now }: { row: ProcessEscalationManagerRow; now: number }) {
  const action = suggestNextAction(row, now);
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ${NEXT_ACTION_TONE[action.tone]}`}>
      {action.label}
    </span>
  );
}
