import { X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import {
  addMember,
  listMembers,
  removeMember,
  updateMember,
  type AccessMode,
  type AddMemberInput,
  type MemberScopeRow,
  type ProcessMemberRow,
  type UpdateMemberInput,
} from '../../lib/api/membersApi';
import { useConfirm } from '../shared/ConfirmProvider';
import { Skeleton } from '../shared/Skeleton';
import { emptyScopeState, ALL_FUNCTIONS_KEY, ESCALATION_KEY, type ScopeEditorState } from './ScopeEditor';
import { MemberRow, type Permission } from './MemberRow';
import { AddMemberForm } from './AddMemberForm';

function stateFromRows(rows: MemberScopeRow[]): ScopeEditorState {
  const out = emptyScopeState();
  for (const row of rows) {
    if (row.scopeType === 'all-functions') {
      out.selected[ALL_FUNCTIONS_KEY] = row.accessLevel;
    } else if (row.scopeType === 'escalation-center') {
      out.selected[ESCALATION_KEY] = row.accessLevel;
    } else if (row.scopeType === 'function' && row.functionId) {
      out.selected[row.functionId] = row.accessLevel;
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
          <AddMemberForm
            email={email}
            onEmailChange={setEmail}
            permission={permission}
            onPermissionChange={setPermission}
            accessMode={accessMode}
            onAccessModeChange={setAccessMode}
            inviteScopes={inviteScopes}
            onInviteScopesChange={setInviteScopes}
            showInviteScopes={showInviteScopes}
            busy={busy}
            onSubmit={invite}
          />
        ) : (
          <p className="mb-5 rounded bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            You can see who&apos;s on this process. To invite or remove someone you need the <strong>owner</strong> permission
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
                <MemberRow
                  key={row.id}
                  row={row}
                  isSelf={isSelf}
                  isEditing={isEditing}
                  canManage={canManage}
                  busy={busy}
                  editAccessMode={editAccessMode}
                  editScopes={editScopes}
                  onStartEdit={startEdit}
                  onCancelEdit={() => setEditingMemberId(null)}
                  onSaveEdit={saveEditScopes}
                  onChangePermission={(r, perm) => void changePermission(r, perm)}
                  onKick={(r) => void kick(r)}
                  onEditAccessModeChange={setEditAccessMode}
                  onEditScopesChange={setEditScopes}
                />
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
