import { UserPlus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { addMember, listMembers, removeMember, type ProcessMemberRow } from '../../lib/api/membersApi';
import { Button } from '../shared/Button';
import { Skeleton } from '../shared/Skeleton';

type Permission = 'viewer' | 'editor' | 'owner';
const PERMISSIONS: Permission[] = ['viewer', 'editor', 'owner'];

/**
 * Drawer-style panel for managing the members of a single process.
 *
 * - Owners and admins see everyone + add/remove controls.
 * - Editors/viewers see the list but no controls (server enforces auth so UI
 *   is just cosmetic; a malicious client can't bypass).
 *
 * Note: the permission dropdown submits a re-add with the new permission, which
 * the backend treats as idempotent upsert.
 */
export function MembersPanel({
  processIdOrCode,
  currentUserCode,
  canManage,
  onClose,
}: {
  processIdOrCode: string;
  currentUserCode: string | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ProcessMemberRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<Permission>('editor');

  async function refresh() {
    try {
      const rows = await listMembers(processIdOrCode);
      setMembers(rows);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processIdOrCode]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const result = await addMember(processIdOrCode, { email: email.trim(), permission });
      toast.success(result.changed ? `Added ${email.trim()}` : `${email.trim()} already a member (unchanged)`);
      setEmail('');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function kick(row: ProcessMemberRow) {
    if (!window.confirm(`Remove ${row.displayName} from this process?`)) return;
    setBusy(true);
    try {
      await removeMember(processIdOrCode, row.displayCode);
      toast.success(`Removed ${row.displayName}`);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changePermission(row: ProcessMemberRow, nextPerm: Permission) {
    if (row.permission === nextPerm) return;
    setBusy(true);
    try {
      await addMember(processIdOrCode, { email: row.email, permission: nextPerm });
      toast.success(`${row.displayName} is now ${nextPerm}`);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Members</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {canManage ? (
          <form onSubmit={invite} className="mb-5 rounded-lg border border-dashed border-gray-300 p-3 text-sm dark:border-gray-700">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Invite</div>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.com"
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
                autoComplete="email"
              />
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as Permission)}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={busy || !email.trim()} leading={<UserPlus size={14} />}>
                Add
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              The user must already have an account. For this dev environment the seeded users are{' '}
              <code>admin@ses.local</code> and <code>auditor@ses.local</code>.
            </p>
          </form>
        ) : (
          <p className="mb-5 rounded bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            You can see who's on this process. To invite or remove someone you need the <strong>owner</strong> permission
            (or the admin role).
          </p>
        )}

        {members === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ul className="space-y-2">
            {members.map((row) => {
              const isSelf = row.userCode === currentUserCode;
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {row.displayName} {isSelf ? <span className="text-xs text-gray-400">(you)</span> : null}
                    </div>
                    <div className="truncate text-xs text-gray-500">{row.email}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                      {row.userCode} · {row.globalRole}
                    </div>
                  </div>
                  {canManage ? (
                    <select
                      value={row.permission}
                      onChange={(e) => void changePermission(row, e.target.value as Permission)}
                      disabled={busy || isSelf}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                      title={isSelf ? 'You cannot change your own permission' : ''}
                    >
                      {PERMISSIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {row.permission}
                    </span>
                  )}
                  {canManage && !isSelf ? (
                    <button
                      type="button"
                      onClick={() => void kick(row)}
                      disabled={busy}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/30"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </li>
              );
            })}
            {!members.length ? (
              <li className="rounded border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400 dark:border-gray-700">
                No members yet.
              </li>
            ) : null}
          </ul>
        )}
      </aside>
    </div>
  );
}
