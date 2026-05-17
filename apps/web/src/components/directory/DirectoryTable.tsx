import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { AddManagerForm } from './AddManagerForm';
import { DeleteManagerButton } from './DeleteManagerButton';
import { Button } from '../shared/Button';
import { useConfirm } from '../shared/ConfirmProvider';
import {
  directoryArchiveBulk,
  directoryList,
  directoryMerge,
  directoryMergeImpact,
  directoryPatch,
  type DirectoryEntry,
} from '../../lib/api/directoryApi';

// Mirrors AddManagerForm's private email check (kept local to avoid an
// out-of-scope export from that component).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Draft = {
  firstName: string;
  lastName: string;
  email: string;
  teamsUsername: string;
  active: boolean;
};

export function DirectoryTable({ refreshKey }: { refreshKey: number }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<DirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Inline row edit — one row at a time (other Edit buttons are disabled
  // while a row is open, so there is no dirty-prompt / data-loss path).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ email?: string; firstName?: string }>({});

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

  function startEdit(row: DirectoryEntry) {
    setEditingId(row.id);
    setDraft({
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      teamsUsername: row.teamsUsername ?? '',
      active: row.active,
    });
    setFieldError({});
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setFieldError({});
  }

  async function saveEdit(row: DirectoryEntry) {
    if (!draft || savingId) return;

    const firstName = draft.firstName.trim();
    const lastName = draft.lastName.trim();
    const email = draft.email.trim().toLowerCase();
    const teamsUsername = draft.teamsUsername.trim();

    const nextErrors: { email?: string; firstName?: string } = {};
    if (!firstName) nextErrors.firstName = 'First name is required.';
    if (!email || !EMAIL_PATTERN.test(email)) nextErrors.email = 'Email is not valid.';
    if (nextErrors.firstName || nextErrors.email) {
      setFieldError(nextErrors);
      return;
    }
    setFieldError({});

    // Only send changed fields (email stored lowercased server-side).
    const body: Partial<{
      firstName: string;
      lastName: string;
      email: string;
      teamsUsername: string;
      active: boolean;
      applyEmailChange: boolean;
    }> = {};
    if (firstName !== row.firstName) body.firstName = firstName;
    if (lastName !== row.lastName) body.lastName = lastName;
    if (email !== row.email) body.email = email;
    if (teamsUsername !== (row.teamsUsername ?? '')) body.teamsUsername = teamsUsername;
    if (draft.active !== row.active) body.active = draft.active;

    if (Object.keys(body).length === 0) {
      cancelEdit();
      return;
    }

    setSavingId(row.id);
    try {
      let result = await directoryPatch(row.id, body);
      if (result && typeof result === 'object' && 'requiresConfirmation' in result) {
        const n = result.trackingRowsToRepoint;
        const proceed = await confirm({
          title: 'Update email',
          description: `Changing this email will repoint ${n} tracking row${
            n === 1 ? '' : 's'
          } onto the updated manager. Continue?`,
          confirmLabel: 'Update email',
        });
        if (!proceed) {
          setSavingId(null);
          return;
        }
        result = await directoryPatch(row.id, { ...body, applyEmailChange: true });
      }
      const updated = result as DirectoryEntry;
      toast.success('Manager updated');
      if (matchesFilters(updated, filter, search)) {
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      } else {
        removeManager(updated.id);
        toast.success('Manager updated (no longer visible under current filter).');
      }
      cancelEdit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
      // Keep the row in edit mode so the user can fix and retry.
    } finally {
      setSavingId(null);
    }
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

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900';

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
              <th scope="col" className="p-2 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const isEditing = editingId === row.id;
              const isSaving = savingId === row.id;
              const otherRowEditing = editingId !== null && editingId !== row.id;
              return (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      disabled={isEditing}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.firstName} ${row.lastName}`.trim()}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{row.displayCode}</td>
                  {isEditing && draft ? (
                    <>
                      <td className="p-2 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-1">
                            <input
                              className={inputClass}
                              aria-label="First name"
                              value={draft.firstName}
                              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                            />
                            <input
                              className={inputClass}
                              aria-label="Last name"
                              value={draft.lastName}
                              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                            />
                          </div>
                          {fieldError.firstName ? (
                            <span className="text-xs text-red-600">{fieldError.firstName}</span>
                          ) : null}
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              aria-label="Active"
                              checked={draft.active}
                              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                            />
                            <span>Active</span>
                          </label>
                        </div>
                      </td>
                      <td className="p-2 align-top">
                        <input
                          className={`${inputClass} ${fieldError.email ? 'border-red-500' : ''}`}
                          type="email"
                          aria-label="Email"
                          aria-describedby={fieldError.email ? `edit-email-error-${row.id}` : undefined}
                          value={draft.email}
                          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                        />
                        {fieldError.email ? (
                          <span
                            id={`edit-email-error-${row.id}`}
                            className="mt-1 block text-xs text-red-600"
                          >
                            {fieldError.email}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 align-top">
                        <input
                          className={inputClass}
                          aria-label="Teams username"
                          placeholder="Teams sign-in / UPN (optional)"
                          value={draft.teamsUsername}
                          onChange={(e) => setDraft({ ...draft, teamsUsername: e.target.value })}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-2 truncate max-w-56" title={`${row.firstName} ${row.lastName}`.trim()}>
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="p-2 truncate max-w-64" title={row.email}>
                        {row.email}
                      </td>
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
                    </>
                  )}
                  <td className="p-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" loading={isSaving} onClick={() => void saveEdit(row)}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isSaving}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </Button>
                        <button
                          type="button"
                          disabled
                          aria-label="Delete (finish editing first)"
                          className="rounded p-1 text-gray-400 opacity-40 cursor-not-allowed"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          disabled={otherRowEditing}
                          title={otherRowEditing ? 'Finish editing the open row first' : undefined}
                          aria-label={`Edit manager ${row.firstName} ${row.lastName}`.trim()}
                          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-800"
                        >
                          Edit
                        </button>
                        <DeleteManagerButton manager={row} onDeleted={removeManager} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AddManagerForm items={items} onCreated={prependCreatedManager} />
    </div>
  );
}
