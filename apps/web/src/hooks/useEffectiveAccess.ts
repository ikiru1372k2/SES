import { useQuery } from '@tanstack/react-query';
import type { FunctionId } from '@ses/domain';
import { getMyAccess, type EffectiveAccess, type ProcessPermission } from '../lib/api/processAccessApi';
import type { MemberScopeRow, ScopeAccessLevel } from '../lib/api/membersApi';

/**
 * Pure resolver that mirrors `AccessScopeService.resolve` on the API. It
 * MUST stay in lock-step with that file — see access-scope.service.ts:96.
 *
 * Resolution:
 *   1. owner => allow.
 *   2. zero scope rows => fall back to ProcessMember.permission (legacy).
 *   3. otherwise match by kind:
 *      - 'function': exact function row + any 'all-functions' row.
 *      - 'escalation-center': exact escalation row only.
 *      - 'all-functions' (process-wide non-function routes): view if any
 *        scope row exists; edit requires an 'all-functions' row.
 */
const accessRank: Record<ScopeAccessLevel, number> = { viewer: 1, editor: 2 };
const baseRank: Record<ProcessPermission, number> = { viewer: 1, editor: 2, owner: 3 };

type Kind = 'all-functions' | 'function' | 'escalation-center';
type Action = 'view' | 'edit';

export function computeAccess(
  access: EffectiveAccess,
  ctx: { kind: Kind; functionId?: string; action: Action },
): boolean {
  if (access.permission === 'owner') return true;
  const required = ctx.action === 'view' ? 1 : 2;

  if (access.scopes.length === 0) {
    return baseRank[access.permission] >= required;
  }

  const candidates: ScopeAccessLevel[] = [];

  if (ctx.kind === 'function') {
    if (!ctx.functionId) return false;
    const exact = access.scopes.find(
      (s) => s.scopeType === 'function' && s.functionId === ctx.functionId,
    );
    if (exact) candidates.push(exact.accessLevel);
    const all = access.scopes.find((s) => s.scopeType === 'all-functions');
    if (all) candidates.push(all.accessLevel);
  } else if (ctx.kind === 'escalation-center') {
    const esc = access.scopes.find((s) => s.scopeType === 'escalation-center');
    if (esc) candidates.push(esc.accessLevel);
  } else {
    if (ctx.action === 'view') return true;
    const all = access.scopes.find((s) => s.scopeType === 'all-functions');
    if (all) candidates.push(all.accessLevel);
  }

  if (candidates.length === 0) return false;
  const best = Math.max(...candidates.map((c) => accessRank[c]));
  return best >= required;
}

export interface AccessGate {
  loading: boolean;
  /** True when we couldn't load access (e.g., not a member, or network) — caller should treat as no access. */
  error: boolean;
  permission: ProcessPermission | null;
  scopes: MemberScopeRow[];
  isOwner: boolean;
  canViewFunction(fid: FunctionId | string | null | undefined): boolean;
  canEditFunction(fid: FunctionId | string | null | undefined): boolean;
  canViewEscalations: boolean;
  canEditEscalations: boolean;
  canEditAllFunctions: boolean;
}

/**
 * Hook returning the current user's effective access for a process plus
 * predicates the workspace UI uses to disable mutating controls. Falls back
 * to a deny-all gate while loading or when not a member.
 */
export function useEffectiveAccess(processIdOrCode: string | null | undefined): AccessGate {
  const enabled = Boolean(processIdOrCode);
  const q = useQuery({
    queryKey: ['process-access', processIdOrCode],
    queryFn: () => getMyAccess(processIdOrCode as string),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  const access = q.data ?? null;

  if (!access) {
    const isLoading = enabled && q.isLoading;
    return {
      loading: isLoading,
      error: enabled && !q.isLoading && !q.isFetching,
      permission: null,
      scopes: [],
      isOwner: false,
      canViewFunction: () => false,
      canEditFunction: () => false,
      canViewEscalations: false,
      canEditEscalations: false,
      canEditAllFunctions: false,
    };
  }

  const fnGate = (action: Action) => (fid: FunctionId | string | null | undefined) => {
    if (!fid) return false;
    return computeAccess(access, { kind: 'function', functionId: String(fid), action });
  };

  return {
    loading: false,
    error: false,
    permission: access.permission,
    scopes: access.scopes,
    isOwner: access.permission === 'owner',
    canViewFunction: fnGate('view'),
    canEditFunction: fnGate('edit'),
    canViewEscalations: computeAccess(access, { kind: 'escalation-center', action: 'view' }),
    canEditEscalations: computeAccess(access, { kind: 'escalation-center', action: 'edit' }),
    canEditAllFunctions: computeAccess(access, { kind: 'all-functions', action: 'edit' }),
  };
}
