import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS, getFunctionLabel } from '@ses/domain';
import { Badge } from '../shared/Badge';
import { computePriority, effectiveManagerEmail } from './nextAction';

export type SortKey = 'priority' | 'manager' | 'issues' | 'stage' | 'lastContact' | 'sla';

function slaTone(row: ProcessEscalationManagerRow, now: number): 'green' | 'amber' | 'red' | 'grey' {
  if (row.resolved || !row.slaDueAt) return 'grey';
  const t = new Date(row.slaDueAt).getTime();
  if (t < now) return 'red';
  if (t < now + 48 * 3600000) return 'amber';
  return 'green';
}

function slaCountdownLabel(row: ProcessEscalationManagerRow, now: number): string {
  if (row.resolved) return 'Resolved';
  if (!row.slaDueAt) return '—';
  const delta = new Date(row.slaDueAt).getTime() - now;
  const abs = Math.abs(delta);
  const hours = Math.round(abs / 3_600_000);
  if (hours < 1) return delta < 0 ? '< 1 h breached' : 'due < 1 h';
  if (hours < 48)
    return delta < 0 ? `${hours} h breached` : `due ${hours} h`;
  const days = Math.round(hours / 24);
  return delta < 0 ? `${days} d breached` : `due ${days} d`;
}

/**
 * UI-only label for the canonical escalation stage enum. The domain enum
 * (NEW/DRAFTED/SENT/AWAITING_RESPONSE/RESPONDED/NO_RESPONSE/ESCALATED_L1/
 * ESCALATED_L2/RESOLVED) drives the backend state machine and must NOT be
 * renamed — this only changes how it reads in the table. "DRAFTED" was
 * surfacing raw; auditors expect a clean escalation-ladder label.
 */
const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  DRAFTED: 'Draft prepared',
  SENT: 'Sent',
  AWAITING_RESPONSE: 'Awaiting reply',
  RESPONDED: 'Responded',
  NO_RESPONSE: 'No response',
  ESCALATED_L1: 'Escalated · L1',
  ESCALATED_L2: 'Escalated · L2',
  RESOLVED: 'Resolved',
};

function stageDisplayLabel(stage: string | null): string {
  if (!stage) return '—';
  return STAGE_LABELS[stage.toUpperCase()] ?? stage;
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
      if (sortKey === 'manager') return String(a.managerName ?? '').localeCompare(String(b.managerName ?? ''));
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
      className="min-h-0 flex-1 overflow-auto rounded-xl border border-rule bg-white shadow-soft dark:border-gray-800 dark:bg-gray-900"
    >
      <table className="min-w-full text-left text-sm">
        <thead className="table-head">
          <tr className="border-b border-rule-2 dark:border-gray-800">
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
            <th scope="col" className="px-3 py-2.5">{sortBtn('manager', 'Manager')}</th>
            <th scope="col" className="px-3 py-2.5">{sortBtn('sla', 'SLA')}</th>
            <th scope="col" className="px-3 py-2.5">{sortBtn('stage', 'Stage')}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold uppercase tracking-wide sm:table-cell">
              Engine
            </th>
            <th scope="col" className="hidden px-3 py-2.5 sm:table-cell text-right">{sortBtn('issues', '#')}</th>
            <th scope="col" className="w-28 px-2 py-2.5 text-right" aria-label="Open row">
              <span />
            </th>
            <th scope="col" className="w-10 px-2 py-2.5" aria-label="Row menu" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const keyboardHere = idx === selectedIndex;
            const bulkSel = Boolean(row.trackingId && selectedTrackingIds.has(row.trackingId));
            const rowFocus = bulkSel || keyboardHere;
            const tone = slaTone(row, now);
            const managerEmail = effectiveManagerEmail(row);
            const stageUpper = String(row.stage ?? '').toUpperCase();
            const stageTone: 'gray' | 'blue' | 'amber' | 'red' =
              stageUpper.startsWith('ESC') ? 'red' : stageUpper === 'BLOCKED' ? 'amber' : stageUpper === 'ACK' ? 'blue' : 'gray';
            const stageLabel = stageDisplayLabel(row.stage);
            const rowEngines = enginesForRow(row);

            return (
              <tr
                key={row.managerKey}
                tabIndex={0}
                aria-selected={keyboardHere}
                className={`cursor-pointer border-t border-rule/70 transition-colors dark:border-gray-800 ${
                  row.resolved
                    ? 'bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-900/40'
                    : rowFocus
                      ? 'bg-brand-subtle hover:bg-brand-subtle dark:bg-brand/15 dark:hover:bg-brand/25'
                      : 'hover:bg-surface-app dark:hover:bg-gray-800/80'
                } ${keyboardHere ? 'ring-1 ring-inset ring-brand/30' : ''}`}
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
                <td className="px-3 py-2.5">
                  <Badge tone={SLA_BADGE_TONE[tone]}>{slaCountdownLabel(row, now)}</Badge>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={stageTone}>{stageLabel}</Badge>
                    {row.stage === 'RESOLVED' && !row.verifiedAt ? (
                      <Badge tone="amber">Needs verification</Badge>
                    ) : null}
                    {row.stage === 'RESOLVED' && row.verifiedAt ? (
                      <Badge tone="green">Verified</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  {rowEngines.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {rowEngines.map(({ id, count }) => (
                        <button
                          key={id}
                          type="button"
                          className="rounded-md transition-opacity hover:opacity-90"
                          title={`${getFunctionLabel(id)}: ${count} finding${count === 1 ? '' : 's'} — click to filter`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEngineFromPill(id);
                          }}
                        >
                          <Badge tone="gray">
                            {shortenEngine(getFunctionLabel(id))}
                            <span className="ml-1 tabular-nums opacity-70">{count}</span>
                          </Badge>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink dark:text-gray-200 sm:table-cell">{row.totalIssues}</td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-3 hover:text-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenPanel(row);
                    }}
                  >
                    Open <ChevronRight size={13} />
                  </button>
                </td>
                <td className="relative px-2 py-2.5">
                  <div className="flex items-center justify-end">
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

/**
 * Every engine this manager has findings in, in FUNCTION_REGISTRY order.
 * Previously the table collapsed to a single "primary" engine, which hid
 * the fact a manager spans multiple engines (e.g. internal-cost-rate +
 * master-data) — now all detected engines render as individual pills.
 */
function enginesForRow(
  row: ProcessEscalationManagerRow,
): Array<{ id: FunctionId; count: number }> {
  const out: Array<{ id: FunctionId; count: number }> = [];
  for (const id of FUNCTION_IDS) {
    const c = row.countsByEngine[id] ?? 0;
    if (c > 0) out.push({ id, count: c });
  }
  return out;
}

function shortenEngine(full: string): string {
  if (full === 'Master Data') return 'Master';
  const first = full.split(/\s+/)[0];
  return first ?? full;
}
