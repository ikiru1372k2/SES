import type { FunctionId } from '@ses/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createSavedView, fetchSavedViews } from '../../lib/api/savedViewsApi';

const PLANNING_ENGINES: FunctionId[] = ['missing-plan', 'over-planning'];
const PLANNING_ENGINE_PARAM = [...PLANNING_ENGINES].sort().join(',');

export type SavedRailCounts = {
  breached: number;
  assignedToMe: number;
  needsVerification: number;
  effortPlanning: number;
};

type CuratedKey = 'breached' | 'assigned' | 'needsVerification' | 'planning';

const CURATED: { key: CuratedKey; name: string; filters: Record<string, string> }[] = [
  { key: 'breached', name: 'Breached SLA', filters: { sla: 'breached' } },
  { key: 'assigned', name: 'Assigned to me', filters: { mine: '1' } },
  { key: 'needsVerification', name: 'Needs verification', filters: { needsVerification: '1' } },
  { key: 'planning', name: 'Planning · workload', filters: { engine: PLANNING_ENGINE_PARAM } },
];

function activeCuratedKey(current: Record<string, string>): CuratedKey | null {
  if (current.needsVerification === '1') return 'needsVerification';
  if (current.mine === '1') return 'assigned';
  if (current.sla === 'breached') return 'breached';
  const eg = [...(current.engine?.split(',').filter(Boolean) ?? [])].sort().join(',');
  if (eg === PLANNING_ENGINE_PARAM) return 'planning';
  return null;
}

function curatedCount(counts: SavedRailCounts | undefined, key: CuratedKey): number | undefined {
  if (!counts) return undefined;
  if (key === 'breached') return counts.breached;
  if (key === 'assigned') return counts.assignedToMe;
  if (key === 'needsVerification') return counts.needsVerification;
  return counts.effortPlanning;
}

export function SavedViewsRail({
  current,
  onApply,
  curatorCounts,
}: {
  current: Record<string, string>;
  onApply: (filters: Record<string, string>) => void;
  curatorCounts?: SavedRailCounts | undefined;
}) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const viewsQ = useQuery({
    queryKey: ['saved-views'],
    queryFn: fetchSavedViews,
  });
  const createMut = useMutation({
    mutationFn: () => createSavedView(name, current),
    onSuccess: async () => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['saved-views'] });
    },
  });

  const items = viewsQ.data?.items ?? [];
  const activeKey = activeCuratedKey(current);

  return (
    <aside className="h-full rounded-xl border border-rule bg-white p-4 shadow-soft dark:border-gray-800 dark:bg-gray-900">
      <div className="eyebrow mb-2">Saved views</div>
      <div className="space-y-0.5">
        {CURATED.map((row) => {
          const cnt = curatedCount(curatorCounts, row.key);
          const on = activeKey === row.key;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onApply(row.filters)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                on ? 'bg-brand-subtle font-semibold text-brand dark:bg-brand/20' : 'text-ink-2 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              <span className="min-w-0 truncate">{row.name}</span>
              {cnt !== undefined ? (
                <span className="shrink-0 font-mono text-[11px] text-ink-3">{cnt}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="my-3 border-t border-rule dark:border-gray-800" />

      <div className="space-y-0.5">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-ink-3">Saved views sync to your profile.</p>
        ) : (
          items.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => onApply(view.filters)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-brand-subtle hover:text-brand dark:text-gray-300 dark:hover:bg-brand/10"
            >
              <span className="truncate">{view.name}</span>
            </button>
          ))
        )}
      </div>
      <div className="mt-4 border-t border-rule pt-3 dark:border-gray-800">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this view…"
          className="mb-2 w-full rounded-md border border-rule bg-white px-2.5 py-1.5 text-xs text-ink outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          disabled={!name.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] font-medium text-brand hover:bg-brand-subtle dark:text-brand dark:hover:bg-brand/15"
        >
          <Plus size={14} />
          Save current view
        </button>
      </div>
    </aside>
  );
}
