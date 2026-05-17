import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AddManagerForm } from './AddManagerForm';
import { DeleteManagerButton } from './DeleteManagerButton';
import { useConfirm } from '../shared/ConfirmProvider';
import {
  directoryArchiveBulk,
  directoryList,
  directoryMerge,
  directoryMergeImpact,
  type DirectoryEntry,
} from '../../lib/api/directoryApi';

export function DirectoryTable({ refreshKey }: { refreshKey: number }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<DirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (currentFilter: typeof filter, currentSearch: string) => {
    setLoading(true);
    try {
      const q: { filter: 'active' | 'archived' | 'all'; limit: number; offset: number; search?: string } = {
        filter: currentFilter,
        limit: 100,
        offset: 0,
      };
      const needle = currentSearch.trim();
      if (needle) q.search = needle;
      const r = await directoryList(q);
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  function matchesFilters(row: DirectoryEntry, currentFilter: 'active' | 'archived' | 'all', currentSearch: string) {
    const activeMatch =
      currentFilter === 'all' ||
      (currentFilter === 'active' && row.active) ||
      (currentFilter === 'archived' && !row.active);
    if (!activeMatch) return false;
    const needle = currentSearch.trim().toLowerCase();
    if (!needle) return true;
    const fullName = `${row.firstName} ${row.lastName}`.trim().toLowerCase();
    return (
      row.displayCode.toLowerCase().includes(needle) ||
      fullName.includes(needle) ||
      row.email.toLowerCase().includes(needle)
    );
  }

  function prependCreatedManager(row: DirectoryEntry) {
    if (matchesFilters(row, filter, search)) {
      setItems((prev) => [row, ...prev]);
      return;
    }
    toast.success('Manager added (not visible under current filter).');
  }

  function removeManager(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    const delay = search.trim() ? 300 : 0;
    const t = window.setTimeout(() => void load(filter, search), delay);
    return () => window.clearTimeout(t);
  }, [filter, load, refreshKey, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function archiveSelected() {
    if (!selected.size) return;
    try {
      await directoryArchiveBulk([...selected]);
      toast.success('Archived');
      setSelected(new Set());
      await load(filter, search);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Archive failed');
    }
  }

  async function mergeSelected() {
    const ids = [...selected];
    if (ids.length !== 2) {
      toast.error('Select exactly two rows to merge (source then target).');
      return;
    }
    const [sourceId, targetId] = ids;
    if (!sourceId || !targetId) return;
    try {
      const impact = await directoryMergeImpact(sourceId, targetId);
      const proceed = await confirm({
        title: 'Merge managers',
        description: `This repoints ${impact.trackingRowsToRepoint} tracking row${impact.trackingRowsToRepoint === 1 ? '' : 's'} from the source manager onto the target. The source entry is archived afterward.`,
        confirmLabel: 'Merge',
      });
      if (!proceed) return;
      await directoryMerge(sourceId, targetId);
      toast.success('Merged');
      setSelected(new Set());
      await load(filter, search);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded-lg border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button type="button" onClick={() => void load(filter, search)} className="rounded-lg border px-3 py-2 text-sm">
          Refresh
        </button>
        <button type="button" onClick={() => void archiveSelected()} className="rounded-lg border px-3 py-2 text-sm">
          Archive selected
        </button>
        <button type="button" onClick={() => void mergeSelected()} className="rounded-lg border px-3 py-2 text-sm">
          Merge two selected
        </button>
      </div>
      {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th scope="col" className="p-2 w-8" />
              <th scope="col" className="p-2">Code</th>
              <th scope="col" className="p-2">Name</th>
              <th scope="col" className="p-2">Email</th>
              <th scope="col" className="p-2">Teams username</th>
              <th scope="col" className="p-2">Active</th>
              <th scope="col" className="p-2 w-12">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td className="p-2 font-mono text-xs">{row.displayCode}</td>
                <td className="p-2 truncate max-w-56" title={`${row.firstName} ${row.lastName}`.trim()}>
                  {row.firstName} {row.lastName}
                </td>
                <td className="p-2 truncate max-w-64" title={row.email}>{row.email}</td>
                <td
                  className="p-2 truncate max-w-56 text-gray-600 dark:text-gray-300"
                  title={row.teamsUsername ?? ''}
                >
                  {row.teamsUsername ? (
                    row.teamsUsername
                  ) : (
                    <span className="text-xs italic text-gray-400">—</span>
                  )}
                </td>
                <td className="p-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.active
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {row.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-2">
                  <DeleteManagerButton manager={row} onDeleted={removeManager} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddManagerForm items={items} onCreated={prependCreatedManager} />
    </div>
  );
}
