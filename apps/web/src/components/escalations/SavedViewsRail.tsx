import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saved views</div>
      <div className="mt-2 space-y-1">
        {(viewsQ.data?.items ?? []).map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => onApply(view.filters)}
            className="block w-full rounded border border-gray-200 px-2 py-1 text-left text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {view.name}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Save current filter..."
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
        />
        <button
          type="button"
          disabled={!name.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="w-full rounded bg-brand px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          Save view
        </button>
      </div>
    </aside>
  );
}
