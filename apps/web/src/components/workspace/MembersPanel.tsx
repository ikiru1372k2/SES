import { Pencil, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { FUNCTION_REGISTRY, getFunctionLabel, type FunctionId } from '@ses/domain';
import {
  addMember,
  listMembers,
  removeMember,
  updateMember,
  type AccessMode,
  type AddMemberInput,
  type MemberScopeRow,
  type ProcessMemberRow,
  type ScopeAccessLevel,
  type UpdateMemberInput,
} from '../../lib/api/membersApi';
import { Button } from '../shared/Button';
import { useConfirm } from '../shared/ConfirmProvider';
import { Skeleton } from '../shared/Skeleton';

type Permission = 'viewer' | 'editor' | 'owner';
const PERMISSIONS: Permission[] = ['viewer', 'editor', 'owner'];
const ACCESS_LEVELS: ScopeAccessLevel[] = ['viewer', 'editor'];
const ESCALATION_KEY = '__escalation-center__';
const ALL_FUNCTIONS_KEY = '__all-functions__';

type ScopeKey = FunctionId | typeof ESCALATION_KEY | typeof ALL_FUNCTIONS_KEY;

interface ScopeEditorState {
  selected: Record<ScopeKey, ScopeAccessLevel | undefined>;
}

function emptyScopeState(): ScopeEditorState {
  return { selected: {} as Record<ScopeKey, ScopeAccessLevel | undefined> };
}

function stateFromRows(rows: MemberScopeRow[]): ScopeEditorState {
  const out = emptyScopeState();
  for (const row of rows) {
    if (row.scopeType === 'all-functions') {
      out.selected[ALL_FUNCTIONS_KEY] = row.accessLevel;
    } else if (row.scopeType === 'escalation-center') {
      out.selected[ESCALATION_KEY] = row.accessLevel;
    } else if (row.scopeType === 'function' && row.functionId) {
      out.selected[row.functionId as FunctionId] = row.accessLevel;
    }
  }
  return out;
}

function stateToRows(state: ScopeEditorState): MemberScopeRow[] {
  const rows: MemberScopeRow[] = [];
  for (const [key, level] of Object.entries(state.selected)) {
    if (!level) continue;
    if (key === ALL_FUNCTIONS_KEY) {
      rows.push({ scopeType: 'all-functions', functionId: null, accessLevel: level });
    } else if (key === ESCALATION_KEY) {
      rows.push({ scopeType: 'escalation-center', functionId: null, accessLevel: level });
    } else {
      rows.push({ scopeType: 'function', functionId: key, accessLevel: level });
    }
  }
  return rows;
}

function ScopeEditor({
  state,
  onChange,
  disabled = false,
}: {
  state: ScopeEditorState;
  onChange: (next: ScopeEditorState) => void;
  disabled?: boolean;
}) {
  const allOn = !!state.selected[ALL_FUNCTIONS_KEY];

  function toggle(key: ScopeKey, level: ScopeAccessLevel | undefined) {
    const next: ScopeEditorState = { selected: { ...state.selected } };
    if (level === undefined) {
      delete next.selected[key];
    } else {
      next.selected[key] = level;
    }
    onChange(next);
  }

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/40">
      <ScopeRow
        label="All functions"
        checked={allOn}
        level={state.selected[ALL_FUNCTIONS_KEY]}
        onChange={(lvl) => toggle(ALL_FUNCTIONS_KEY, lvl)}
        disabled={disabled}
      />
      <div className="ml-2 border-l border-dashed border-gray-300 pl-2 dark:border-gray-700">
        {allOn ? (
          <p className="py-1 text-[11px] italic text-gray-500">
            "All functions" supersedes the per-function selections below.
          </p>
        ) : null}
        {FUNCTION_REGISTRY.map((fn) => (
          <ScopeRow
            key={fn.id}
            label={fn.label}
            checked={!!state.selected[fn.id as FunctionId]}
            level={state.selected[fn.id as FunctionId]}
            onChange={(lvl) => toggle(fn.id as FunctionId, lvl)}
            disabled={disabled || allOn}
          />
        ))}
      </div>
      <ScopeRow
        label="Escalation Center"
        checked={!!state.selected[ESCALATION_KEY]}
        level={state.selected[ESCALATION_KEY]}
        onChange={(lvl) => toggle(ESCALATION_KEY, lvl)}
        disabled={disabled}
      />
    </div>
  );
}

function ScopeRow({
  label,
  checked,
  level,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  level: ScopeAccessLevel | undefined;
  onChange: (next: ScopeAccessLevel | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 py-0.5 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? level ?? 'viewer' : undefined)}
      />
      <span className="flex-1">{label}</span>
      <select
        value={level ?? 'viewer'}
        disabled={disabled || !checked}
        onChange={(e) => onChange(e.target.value as ScopeAccessLevel)}
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] dark:border-gray-700 dark:bg-gray-900"
      >
        {ACCESS_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScopeBadges({ scopes }: { scopes: MemberScopeRow[] }) {
  if (!scopes.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {scopes.map((s, i) => {
        let label: string;
        if (s.scopeType === 'all-functions') label = 'All functions';
        else if (s.scopeType === 'escalation-center') label = 'Escalation Center';
        else label = s.functionId ? getFunctionLabel(s.functionId as FunctionId) : 'function';
        return (
          <span
            key={`${s.scopeType}:${s.functionId ?? ''}:${i}`}
            className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
          >
            {label} · {s.accessLevel}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Drawer-style panel for managing the members of a single process.
 *
 * Members can be invited unrestricted (legacy behavior, gets the global
 * permission process-wide) or scoped (per-function and/or escalation-center
 * access levels). Server enforces both layers; UI just collects the intent.
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
  const confirm = useConfirm();
  const [members, setMembers] = useState<ProcessMemberRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<Permission>('editor');
  const [accessMode, setAccessMode] = useState<AccessMode>('unrestricted');
  const [inviteScopes, setInviteScopes] = useState<ScopeEditorState>(emptyScopeState());
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<ScopeEditorState>(emptyScopeState());
  const [editAccessMode, setEditAccessMode] = useState<AccessMode>('unrestricted');

  const showInviteScopes = canManage && permission !== 'owner' && accessMode === 'scoped';

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
      const isOwner = permission === 'owner';
      const scoped = !isOwner && accessMode === 'scoped';
      const scopes = scoped ? stateToRows(inviteScopes) : undefined;
      if (scoped && (!scopes || scopes.length === 0)) {
        throw new Error('Pick at least one scope or switch to "All access".');
      }
      const payload: AddMemberInput = {
        email: email.trim(),
        permission,
        accessMode: isOwner ? 'unrestricted' : accessMode,
      };
      if (scopes) payload.scopes = scopes;
      const result = await addMember(processIdOrCode, payload);
      toast.success(result.changed ? `Added ${email.trim()}` : `${email.trim()} already a member (unchanged)`);
      setEmail('');
      setAccessMode('unrestricted');
      setInviteScopes(emptyScopeState());
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function kick(row: ProcessMemberRow) {
    const ok = await confirm({
      title: `Remove ${row.displayName}?`,
      description: 'They will lose access to this process immediately.',
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (!ok) return;
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
      await updateMember(processIdOrCode, row.displayCode, { permission: nextPerm });
      toast.success(`${row.displayName} is now ${nextPerm}`);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row: ProcessMemberRow) {
    setEditingMemberId(row.id);
    setEditScopes(stateFromRows(row.scopes));
    setEditAccessMode(row.scopes.length > 0 ? 'scoped' : 'unrestricted');
  }

  async function saveEditScopes(row: ProcessMemberRow) {
    setBusy(true);
    try {
      const scoped = editAccessMode === 'scoped';
      const scopes = scoped ? stateToRows(editScopes) : [];
      if (scoped && scopes.length === 0) {
        throw new Error('Pick at least one scope or switch to "All access".');
      }
      const payload: UpdateMemberInput = { accessMode: editAccessMode };
      if (scoped) payload.scopes = scopes;
      await updateMember(processIdOrCode, row.displayCode, payload);
      toast.success(`Updated access for ${row.displayName}`);
      setEditingMemberId(null);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const memberList = useMemo(() => members ?? [], [members]);

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
            {permission !== 'owner' ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-gray-500">Access</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="invite-access-mode"
                      checked={accessMode === 'unrestricted'}
                      onChange={() => setAccessMode('unrestricted')}
                    />
                    All access
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="invite-access-mode"
                      checked={accessMode === 'scoped'}
                      onChange={() => setAccessMode('scoped')}
                    />
                    Scoped
                  </label>
                </div>
                {showInviteScopes ? (
                  <ScopeEditor state={inviteScopes} onChange={setInviteScopes} />
                ) : null}
              </div>
            ) : null}
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
            {memberList.map((row) => {
              const isSelf = row.userCode === currentUserCode;
              const isEditing = editingMemberId === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {row.displayName} {isSelf ? <span className="text-xs text-gray-400">(you)</span> : null}
                      </div>
                      <div className="truncate text-xs text-gray-500">{row.email}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                        {row.userCode} · {row.globalRole}
                      </div>
                      <ScopeBadges scopes={row.scopes} />
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
                    {canManage && row.permission !== 'owner' ? (
                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditingMemberId(null) : startEdit(row))}
                        disabled={busy}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800"
                        title="Edit access"
                        aria-label="Edit access"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
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
                  </div>
                  {isEditing ? (
                    <div className="mt-3 space-y-2 border-t border-dashed border-gray-200 pt-3 dark:border-gray-700">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-gray-500">Access</span>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`edit-access-${row.id}`}
                            checked={editAccessMode === 'unrestricted'}
                            onChange={() => setEditAccessMode('unrestricted')}
                          />
                          All access
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`edit-access-${row.id}`}
                            checked={editAccessMode === 'scoped'}
                            onChange={() => setEditAccessMode('scoped')}
                          />
                          Scoped
                        </label>
                      </div>
                      {editAccessMode === 'scoped' ? (
                        <ScopeEditor state={editScopes} onChange={setEditScopes} />
                      ) : null}
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setEditingMemberId(null)} disabled={busy}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={() => void saveEditScopes(row)} disabled={busy}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {!memberList.length ? (
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
