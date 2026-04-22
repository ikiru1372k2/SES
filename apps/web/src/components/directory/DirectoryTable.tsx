import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  directoryArchiveBulk,
  directoryList,
  directoryMerge,
  directoryMergeImpact,
  type DirectoryEntry,
} from '../../lib/api/directoryApi';

export function DirectoryTable({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<DirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const q: { filter: 'active' | 'archived' | 'all'; limit: number; offset: number; search?: string } = {
        filter,
        limit: 100,
        offset: 0,
      };
      const needle = search.trim();
      if (needle) q.search = needle;
      const r = await directoryList(q);
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, filter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
      await load();
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
      if (!window.confirm(`Repoint ${impact.trackingRowsToRepoint} tracking rows and merge?`)) return;
      await directoryMerge(sourceId, targetId);
      toast.success('Merged');
      setSelected(new Set());
      await load();
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
        <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm">
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
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="p-2 w-8" />
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td className="p-2 font-mono text-xs">{row.displayCode}</td>
                <td className="p-2">
                  {row.firstName} {row.lastName}
                </td>
                <td className="p-2">{row.email}</td>
                <td className="p-2">{row.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
