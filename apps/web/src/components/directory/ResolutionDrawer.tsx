import { useEffect, useMemo, useState } from 'react';
import type { DirectoryRowInput } from '@ses/domain';
import toast from 'react-hot-toast';
import { directoryResolve, directoryResolveBatch, directorySuggestions } from '../../lib/api/directoryApi';

type SuggestionMap = Awaited<ReturnType<typeof directorySuggestions>>['results'];

export function ResolutionDrawer({
  open,
  onClose,
  rawNames,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  rawNames: string[];
  onResolved: () => void;
}) {
  const [results, setResults] = useState<SuggestionMap>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [inline, setInline] = useState<Record<string, DirectoryRowInput>>({});
  const [loading, setLoading] = useState(false);
  const namesKey = useMemo(() => rawNames.slice().sort().join('|'), [rawNames]);

  useEffect(() => {
    if (!open || rawNames.length === 0) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const r = await directorySuggestions(rawNames);
        if (!cancelled) {
          setResults(r.results);
          const initial: Record<string, string> = {};
          for (const n of rawNames) {
            const auto = r.results[n]?.autoMatch;
            if (auto) initial[n] = auto.id;
          }
          setPicks(initial);
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Suggestions failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, namesKey]);

  async function applyBulkHighConfidence() {
    const items: Array<{ rawName: string; directoryEntryId: string }> = [];
    for (const name of rawNames) {
      const block = results[name];
      const auto = block?.autoMatch;
      if (auto && !block.collision) items.push({ rawName: name, directoryEntryId: auto.id });
    }
    if (!items.length) {
      toast.error('No high-confidence matches to apply.');
      return;
    }
    try {
      await directoryResolveBatch(items);
      toast.success(`Applied ${items.length} resolutions`);
      onResolved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk resolve failed');
    }
  }

  async function acceptOne(name: string) {
    const id = picks[name];
    if (!id) {
      toast.error('Pick a directory row first.');
      return;
    }
    try {
      await directoryResolve({ rawName: name, directoryEntryId: id });
      toast.success(`Resolved ${name}`);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resolve failed');
    }
  }

  async function inlineAdd(name: string) {
    const row = inline[name];
    if (!row?.email) {
      toast.error('Enter first, last, and email for inline add.');
      return;
    }
    try {
      await directoryResolve({ rawName: name, inline: row });
      toast.success('Added');
      onResolved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Inline add failed');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold">Resolve managers</h2>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
          Close
        </button>
      </div>
      <div className="flex gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <button type="button" onClick={() => void applyBulkHighConfidence()} className="rounded border px-2 py-1 text-xs">
          Apply all high-confidence
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {loading ? <div className="text-gray-500">Loading suggestions…</div> : null}
        {rawNames.map((name) => {
          const r = results[name];
          return (
            <div key={name} className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="font-medium">{name}</div>
              {r?.collision ? <div className="mt-1 text-xs text-amber-700">Collision — pick manually.</div> : null}
              <div className="mt-2">
                <label className="text-xs text-gray-500">Match</label>
                <select
                  value={picks[name] ?? ''}
                  onChange={(e) => setPicks((p) => ({ ...p, [name]: e.target.value }))}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
                >
                  <option value="">—</option>
                  {(r?.candidates ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email} ({Math.round(c.score)}%)
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void acceptOne(name)} className="rounded border px-2 py-1 text-xs">
                  Accept
                </button>
              </div>
              <div className="mt-3 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">
                <div className="text-xs text-gray-500">Inline add (admin)</div>
                <input
                  placeholder="First"
                  className="w-full rounded border px-2 py-1 text-xs dark:bg-gray-900"
                  value={inline[name]?.firstName ?? ''}
                  onChange={(e) =>
                    setInline((p) => ({
                      ...p,
                      [name]: { firstName: e.target.value, lastName: p[name]?.lastName ?? '', email: p[name]?.email ?? '' },
                    }))
                  }
                />
                <input
                  placeholder="Last"
                  className="w-full rounded border px-2 py-1 text-xs dark:bg-gray-900"
                  value={inline[name]?.lastName ?? ''}
                  onChange={(e) =>
                    setInline((p) => ({
                      ...p,
                      [name]: { firstName: p[name]?.firstName ?? '', lastName: e.target.value, email: p[name]?.email ?? '' },
                    }))
                  }
                />
                <input
                  placeholder="Email"
                  className="w-full rounded border px-2 py-1 text-xs dark:bg-gray-900"
                  value={inline[name]?.email ?? ''}
                  onChange={(e) =>
                    setInline((p) => ({
                      ...p,
                      [name]: { firstName: p[name]?.firstName ?? '', lastName: p[name]?.lastName ?? '', email: e.target.value },
                    }))
                  }
                />
                <button type="button" onClick={() => void inlineAdd(name)} className="rounded border px-2 py-1 text-xs">
                  Save inline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
