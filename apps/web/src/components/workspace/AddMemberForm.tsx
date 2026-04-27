import { UserPlus } from 'lucide-react';
import type { FormEvent } from 'react';
import type { AccessMode } from '../../lib/api/membersApi';
import { Button } from '../shared/Button';
import { ScopeEditor, type ScopeEditorState } from './ScopeEditor';

type Permission = 'viewer' | 'editor' | 'owner';
const PERMISSIONS: Permission[] = ['viewer', 'editor', 'owner'];

interface AddMemberFormProps {
  email: string;
  onEmailChange: (value: string) => void;
  permission: Permission;
  onPermissionChange: (value: Permission) => void;
  accessMode: AccessMode;
  onAccessModeChange: (value: AccessMode) => void;
  inviteScopes: ScopeEditorState;
  onInviteScopesChange: (state: ScopeEditorState) => void;
  showInviteScopes: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
}

export function AddMemberForm({
  email,
  onEmailChange,
  permission,
  onPermissionChange,
  accessMode,
  onAccessModeChange,
  inviteScopes,
  onInviteScopesChange,
  showInviteScopes,
  busy,
  onSubmit,
}: AddMemberFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-5 rounded-lg border border-dashed border-gray-300 p-3 text-sm dark:border-gray-700"
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Invite</div>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="email@company.com"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          autoComplete="email"
        />
        <select
          value={permission}
          onChange={(e) => onPermissionChange(e.target.value as Permission)}
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
                onChange={() => onAccessModeChange('unrestricted')}
              />
              All access
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="invite-access-mode"
                checked={accessMode === 'scoped'}
                onChange={() => onAccessModeChange('scoped')}
              />
              Scoped
            </label>
          </div>
          {showInviteScopes ? (
            <ScopeEditor state={inviteScopes} onChange={onInviteScopesChange} />
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-gray-500">
        The user must already have an account. For this dev environment the seeded users are{' '}
        <code>admin@ses.local</code> and <code>auditor@ses.local</code>.
      </p>
    </form>
  );
}

export type { Permission };
