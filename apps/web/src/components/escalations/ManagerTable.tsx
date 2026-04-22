import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';
import { EnginePill } from './EnginePill';
import { computePriority, suggestNextAction } from './nextAction';

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
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
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

export function ManagerTable({
  processId,
  rows,
  selectedTrackingIds,
  onToggleTracking,
  onToggleAllVisible,
  selectedIndex,
  onSelectIndex,
  onOpenPanel,
  sortKey,
  onSortKey,
  engineFilter,
  onEngineFromPill,
}: {
  processId: string;
  rows: ProcessEscalationManagerRow[];
  selectedTrackingIds: Set<string>;
  onToggleTracking: (trackingId: string) => void;
  onToggleAllVisible: (trackingIds: string[]) => void;
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
  onOpenPanel: (row: ProcessEscalationManagerRow) => void;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  engineFilter: FunctionId | '';
  onEngineFromPill: (engine: FunctionId) => void;
}) {
  const now = Date.now();
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

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        onSelectIndex(Math.min(selectedIndex + 1, Math.max(sorted.length - 1, 0)));
      } else if (e.key === 'k') {
        e.preventDefault();
        onSelectIndex(Math.max(selectedIndex - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = sorted[selectedIndex];
        if (row) onOpenPanel(row);
      }
    },
    [onOpenPanel, onSelectIndex, selectedIndex, sorted],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  useEffect(() => {
    if (selectedIndex >= sorted.length) onSelectIndex(Math.max(0, sorted.length - 1));
  }, [onSelectIndex, selectedIndex, sorted.length]);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`font-medium hover:text-brand ${sortKey === key ? 'text-brand' : ''}`}
      onClick={() => onSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-800">
          <tr>
            <th className="px-2 py-2">
              <input
                type="checkbox"
                aria-label="Select all rows"
                onChange={() => onToggleAllVisible(sorted.map((row) => row.trackingId).filter(Boolean) as string[])}
                checked={
                  sorted.length > 0 &&
                  sorted.every((row) => row.trackingId && selectedTrackingIds.has(row.trackingId))
                }
              />
            </th>
            <th className="px-3 py-2">Manager</th>
            <th className="px-3 py-2">{sortBtn('issues', 'Issues')}</th>
            <th className="px-3 py-2">Engines</th>
            <th className="px-3 py-2">{sortBtn('stage', 'Stage')}</th>
            <th className="px-3 py-2">{sortBtn('lastContact', 'Last contact')}</th>
            <th className="px-3 py-2">{sortBtn('sla', 'SLA')}</th>
            <th className="px-3 py-2">Next action</th>
            <th className="w-10 px-2 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const selected = idx === selectedIndex;
            const tone = slaTone(row, now);
            return (
              <tr
                key={row.managerKey}
                tabIndex={0}
                aria-selected={selected}
                className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/80 ${
                  selected ? 'bg-brand/5 ring-1 ring-inset ring-brand/30' : ''
                }`}
                onClick={() => {
                  onSelectIndex(idx);
                  onOpenPanel(row);
                }}
              >
                <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    disabled={!row.trackingId}
                    checked={row.trackingId ? selectedTrackingIds.has(row.trackingId) : false}
                    onChange={() => {
                      if (row.trackingId) onToggleTracking(row.trackingId);
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900 dark:text-white">{row.managerName}</div>
                  {row.resolvedEmail ? (
                    <div className="text-xs text-gray-500">{row.resolvedEmail}</div>
                  ) : (
                    <div className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Missing email — add to directory
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">{row.totalIssues}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {FUNCTION_IDS.map((fid) => (
                      <EnginePill
                        key={fid}
                        engine={fid}
                        count={row.countsByEngine[fid] ?? 0}
                        active={engineFilter === fid}
                        onClick={() => onEngineFromPill(fid)}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">{row.stage ?? '—'}</span>
                    {row.stage === 'RESOLVED' && !row.verifiedAt ? (
                      <span
                        className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                        title="Manager marked resolved — needs auditor verification"
                      >
                        Awaiting verification
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {row.lastContactAt ? new Date(row.lastContactAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <SlaDot tone={tone} />
                    <span className="text-xs text-gray-600 dark:text-gray-300">{slaCountdownLabel(row, now)}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <NextActionChip row={row} now={now} />
                </td>
                <td className="relative px-2 py-2">
                  <button
                    type="button"
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    aria-label="Row menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuRow(menuRow === idx ? null : idx);
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {menuRow === idx ? (
                    <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          const em = row.resolvedEmail;
                          if (em) void navigator.clipboard.writeText(em).then(() => toast.success('Email copied')).catch(() => toast.error('Copy failed'));
                          else toast.error('No email');
                          setMenuRow(null);
                        }}
                      >
                        Copy email
                      </button>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
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
