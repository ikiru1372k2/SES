import { Pencil, X } from 'lucide-react';
import { getFunctionLabel, type FunctionId } from '@ses/domain';
import type { AccessMode, MemberScopeRow, ProcessMemberRow } from '../../lib/api/membersApi';
import { Button } from '../shared/Button';
import { ScopeEditor, type ScopeEditorState } from './ScopeEditor';

type Permission = 'viewer' | 'editor' | 'owner';
const PERMISSIONS: Permission[] = ['viewer', 'editor', 'owner'];

interface MemberRowProps {
  row: ProcessMemberRow;
  isSelf: boolean;
  isEditing: boolean;
  canManage: boolean;
  busy: boolean;
  editAccessMode: AccessMode;
  editScopes: ScopeEditorState;
  onStartEdit: (row: ProcessMemberRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (row: ProcessMemberRow) => void;
  onChangePermission: (row: ProcessMemberRow, perm: Permission) => void;
  onKick: (row: ProcessMemberRow) => void;
  onEditAccessModeChange: (mode: AccessMode) => void;
  onEditScopesChange: (state: ScopeEditorState) => void;
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

export function MemberRow({
  row,
  isSelf,
  isEditing,
  canManage,
  busy,
  editAccessMode,
  editScopes,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onChangePermission,
  onKick,
  onEditAccessModeChange,
  onEditScopesChange,
}: MemberRowProps) {
  return (
    <li className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
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
            onChange={(e) => onChangePermission(row, e.target.value as Permission)}
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
            onClick={() => (isEditing ? onCancelEdit() : onStartEdit(row))}
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
            onClick={() => onKick(row)}
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
                onChange={() => onEditAccessModeChange('unrestricted')}
              />
              All access
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`edit-access-${row.id}`}
                checked={editAccessMode === 'scoped'}
                onChange={() => onEditAccessModeChange('scoped')}
              />
              Scoped
            </label>
          </div>
          {editAccessMode === 'scoped' ? (
            <ScopeEditor state={editScopes} onChange={onEditScopesChange} />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancelEdit} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => onSaveEdit(row)} disabled={busy}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export type { Permission };
