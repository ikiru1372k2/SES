import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createSavedView, fetchSavedViews } from '../../lib/api/savedViewsApi';

export function SavedViewsRail({
  current,
  onApply,
}: {
  current: Record<string, string>;
  onApply: (filters: Record<string, string>) => void;
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

  return (
    <aside className="rounded-xl border border-rule bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
      <div className="eyebrow mb-2">Saved views</div>
      <div className="space-y-0.5">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-xs text-ink-3">No saved views yet.</p>
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
      <div className="mt-4 space-y-2 border-t border-rule pt-3 dark:border-gray-700">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this view…"
          className="w-full rounded-md border border-rule bg-white px-2.5 py-1.5 text-xs text-ink outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          disabled={!name.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-xs font-medium text-white shadow-soft transition-all duration-150 ease-soft hover:bg-brand-hover hover:shadow-soft-md disabled:opacity-60 disabled:shadow-none"
        >
          <Plus size={13} /> Save current view
        </button>
      </div>
    </aside>
  );
}
