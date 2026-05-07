import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../repositories/types';
import { createId } from '@ses/domain';
import type { FunctionId, SessionUser } from '@ses/domain';
import { PrismaService } from './prisma.service';
import type { ProcessPermission } from './process-access.service';

export type ScopeKind = 'all-functions' | 'function' | 'escalation-center';
export type ScopeAccessLevel = 'viewer' | 'editor';
export type ScopeAction = 'view' | 'edit';

export interface ScopeContext {
  kind: ScopeKind;
  /** Required when kind === 'function'. */
  functionId?: FunctionId;
  action: ScopeAction;
}

export interface ScopeRow {
  scopeType: ScopeKind;
  functionId: string | null;
  accessLevel: ScopeAccessLevel;
}

export interface ScopeWriteInput {
  scopeType: ScopeKind;
  functionId?: string | null;
  accessLevel: ScopeAccessLevel;
}

const baseRank: Record<ProcessPermission, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const accessRank: Record<ScopeAccessLevel, number> = {
  viewer: 1,
  editor: 2,
};

export type LoadedMemberContext = {
  member: { id: string; permission: ProcessPermission };
  scopes: ScopeRow[];
};

@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single round trip: returns the user's ProcessMember row plus their scope
   * permissions, or null if the user is not a member of the process.
   */
  async loadMemberContext(processId: string, userId: string): Promise<LoadedMemberContext | null> {
    const member = await this.prisma.processMember.findFirst({
      where: { processId, userId },
      include: {
        scopePermissions: {
          select: { scopeType: true, functionId: true, accessLevel: true },
        },
      },
    });
    if (!member) return null;
    if (
      member.permission !== 'viewer' &&
      member.permission !== 'editor' &&
      member.permission !== 'owner'
    ) {
      return null;
    }
    return {
      member: { id: member.id, permission: member.permission },
      scopes: member.scopePermissions.map((s: any) => ({
        scopeType: s.scopeType as ScopeKind,
        functionId: s.functionId,
        accessLevel: s.accessLevel as ScopeAccessLevel,
      })),
    };
  }

  /**
   * Pure resolver — no DB access. Given the loaded member + scope rows and a
   * request scope context, decides whether to allow.
   *
   * Resolution:
   *   1. owner => allow.
   *   2. zero scope rows => fall back to ProcessMember.permission (legacy).
   *   3. otherwise match by ctx.kind:
   *      - 'function': exact function row + any 'all-functions' row.
   *      - 'escalation-center': exact escalation row only.
   *      - 'all-functions' (process-wide non-function routes): view is allowed
   *        if any scope row exists; edit requires an 'all-functions' row.
   *      Choose the most permissive matching accessLevel.
   */
  resolve(args: {
    member: { permission: ProcessPermission };
    scopes: ScopeRow[];
    ctx: ScopeContext;
  }): { allowed: boolean; reason?: string } {
    const { member, scopes, ctx } = args;
    if (member.permission === 'owner') return { allowed: true };

    const required = ctx.action === 'view' ? 1 : 2;

    if (scopes.length === 0) {
      const ok = baseRank[member.permission] >= required;
      return { allowed: ok, reason: ok ? undefined : 'insufficient permission' };
    }

    const candidates: ScopeAccessLevel[] = [];

    if (ctx.kind === 'function') {
      if (!ctx.functionId) {
        return { allowed: false, reason: 'function scope requires functionId' };
      }
      const exact = scopes.find(
        (s) => s.scopeType === 'function' && s.functionId === ctx.functionId,
      );
      if (exact) candidates.push(exact.accessLevel);
      const all = scopes.find((s) => s.scopeType === 'all-functions');
      if (all) candidates.push(all.accessLevel);
    } else if (ctx.kind === 'escalation-center') {
      const esc = scopes.find((s) => s.scopeType === 'escalation-center');
      if (esc) candidates.push(esc.accessLevel);
    } else {
      // 'all-functions' = process-wide non-function route.
      if (ctx.action === 'view') return { allowed: true };
      const all = scopes.find((s) => s.scopeType === 'all-functions');
      if (all) candidates.push(all.accessLevel);
    }

    if (candidates.length === 0) {
      return { allowed: false, reason: 'no scope grants this access' };
    }
    const best = Math.max(...candidates.map((c) => accessRank[c]));
    return best >= required
      ? { allowed: true }
      : { allowed: false, reason: 'scope grant below required level' };
  }

  /** Convenience wrapper used by the guard. Throws ForbiddenException on deny. */
  async require(processId: string, user: SessionUser, ctx: ScopeContext): Promise<void> {
    const ctxLoaded = await this.loadMemberContext(processId, user.id);
    if (!ctxLoaded) {
      throw new ForbiddenException('Not a member of this process');
    }
    const { allowed, reason } = this.resolve({
      member: ctxLoaded.member,
      scopes: ctxLoaded.scopes,
      ctx,
    });
    if (!allowed) {
      throw new ForbiddenException(reason ?? 'Insufficient scope permission');
    }
  }

  /** Used by GET /processes/:id/members to attach scopes per member. */
  async listScopesForProcess(processId: string): Promise<Map<string, ScopeRow[]>> {
    const rows = await this.prisma.processMemberScopePermission.findMany({
      where: { processId },
      select: { memberId: true, scopeType: true, functionId: true, accessLevel: true },
    });
    const out = new Map<string, ScopeRow[]>();
    for (const r of rows) {
      const list = out.get(r.memberId) ?? [];
      list.push({
        scopeType: r.scopeType as ScopeKind,
        functionId: r.functionId,
        accessLevel: r.accessLevel as ScopeAccessLevel,
      });
      out.set(r.memberId, list);
    }
    return out;
  }

  /**
   * Replace-all writer used by add/update endpoints. Runs inside the caller's
   * existing prisma transaction. An empty `scopes` list deletes any existing
   * rows for the member (i.e., reverts to legacy "unrestricted" behavior).
   */
  async replaceMemberScopes(
    tx: Prisma.TransactionClient,
    args: { processId: string; memberId: string; scopes: ScopeWriteInput[] },
  ): Promise<void> {
    const { processId, memberId, scopes } = args;
    // Defensive dedup: collapse by (scopeType, functionId|null), last write wins.
    const seen = new Map<string, ScopeWriteInput>();
    for (const s of scopes) {
      const key = `${s.scopeType}::${s.functionId ?? ''}`;
      seen.set(key, s);
    }
    await tx.processMemberScopePermission.deleteMany({ where: { memberId } });
    if (seen.size === 0) return;
    await tx.processMemberScopePermission.createMany({
      data: [...seen.values()].map((s) => ({
        id: createId(),
        processId,
        memberId,
        scopeType: s.scopeType,
        functionId: s.scopeType === 'function' ? s.functionId ?? null : null,
        accessLevel: s.accessLevel,
      })),
    });
  }
}
