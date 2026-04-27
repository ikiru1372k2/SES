import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import {
  AccessScopeService,
  type ScopeWriteInput,
} from '../../common/access-scope.service';
import type {
  AccessMode,
  ScopeEntryDto,
  UpdateProcessMemberDto,
  AddProcessMemberDto,
} from '../../dto/process-members.dto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { isFunctionId } from '@ses/domain';

/**
 * Validate the optional scope payload from add/update DTOs and return the
 * normalized list to write. Returns:
 *   - undefined when the body neither sets `accessMode` nor sends `scopes`
 *     (i.e., the caller is not touching scopes at all),
 *   - [] when accessMode='unrestricted' (or owner): existing scopes will be
 *     wiped, restoring legacy behavior,
 *   - normalized ScopeWriteInput[] when accessMode='scoped'.
 */
function resolveDesiredScopes(
  body: { accessMode?: AccessMode; scopes?: ScopeEntryDto[] },
  permission: 'viewer' | 'editor' | 'owner',
): ScopeWriteInput[] | undefined {
  const hasMode = body.accessMode !== undefined;
  const hasScopes = body.scopes !== undefined;
  if (!hasMode && !hasScopes) return undefined;

  if (permission === 'owner') {
    if ((body.scopes?.length ?? 0) > 0 || body.accessMode === 'scoped') {
      throw new BadRequestException('Owners cannot have scoped permissions');
    }
    return [];
  }

  const mode: AccessMode = body.accessMode ?? (hasScopes && body.scopes!.length > 0 ? 'scoped' : 'unrestricted');

  if (mode === 'unrestricted') {
    if (body.scopes && body.scopes.length > 0) {
      throw new BadRequestException('scopes must be empty when accessMode=unrestricted');
    }
    return [];
  }

  // mode === 'scoped'
  const list = body.scopes ?? [];
  if (list.length === 0) {
    throw new BadRequestException('scopes must include at least one entry when accessMode=scoped');
  }

  const seen = new Set<string>();
  const out: ScopeWriteInput[] = [];
  for (const entry of list) {
    if (entry.scopeType === 'function') {
      if (!entry.functionId || !isFunctionId(entry.functionId)) {
        throw new BadRequestException('function scope requires a valid functionId');
      }
    } else if (entry.functionId) {
      throw new BadRequestException(`${entry.scopeType} scope must not include functionId`);
    }
    const key = `${entry.scopeType}::${entry.functionId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      scopeType: entry.scopeType,
      functionId: entry.scopeType === 'function' ? entry.functionId! : null,
      accessLevel: entry.accessLevel,
    });
  }
  return out;
}

@Injectable()
export class ProcessMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly accessScope: AccessScopeService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ----- Members -----------------------------------------------------------
  //
  // Membership controls who can see a process and what they can do inside it.
  // Listing is allowed to any member (viewer+); adding/removing requires owner
  // because a member who can add others can grant themselves privileges.

  /**
   * Returns the current user's effective permission + scope rows for a process.
   * Drives the workspace UI's disable-state for mutating controls. Mirrors
   * exactly what AccessScopeService.resolve will use server-side, so the UI
   * stays in lock-step with enforcement.
   */
  async getMyAccess(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const ctx = await this.accessScope.loadMemberContext(process.id, user.id);
    if (!ctx) {
      // findAccessibleProcessOrThrow already enforces membership; this is a
      // defensive belt-and-suspenders branch.
      return { permission: 'viewer' as const, scopes: [] };
    }
    return { permission: ctx.member.permission, scopes: ctx.scopes };
  }

  async listMembers(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const [members, scopesByMember] = await Promise.all([
      this.prisma.processMember.findMany({
        where: { processId: process.id },
        orderBy: { addedAt: 'asc' },
        include: { user: { select: { id: true, displayCode: true, email: true, displayName: true, role: true } } },
      }),
      this.accessScope.listScopesForProcess(process.id),
    ]);
    return members.map((m) => ({
      id: m.id,
      displayCode: m.displayCode,
      userId: m.user.id,
      userCode: m.user.displayCode,
      email: m.user.email,
      displayName: m.user.displayName,
      globalRole: m.user.role,
      permission: m.permission,
      addedAt: m.addedAt.toISOString(),
      scopes: scopesByMember.get(m.id) ?? [],
    }));
  }

  async addMember(
    idOrCode: string,
    body: AddProcessMemberDto,
    user: SessionUser,
  ) {
    const permission = body.permission ?? 'editor';
    if (permission !== 'viewer' && permission !== 'editor' && permission !== 'owner') {
      throw new BadRequestException('permission must be viewer | editor | owner');
    }
    const lookup = body.email?.trim().toLowerCase() || body.userCode?.trim();
    if (!lookup) throw new BadRequestException('email or userCode is required');

    const desiredScopes = resolveDesiredScopes(body, permission);

    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    const target = await this.prisma.user.findFirst({
      where: { OR: [{ email: lookup }, { displayCode: lookup }], isActive: true },
    });
    if (!target) throw new NotFoundException(`User ${lookup} not found`);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.processMember.findFirst({
        where: { processId: process.id, userId: target.id },
      });
      let memberId: string;
      let memberCode: string;
      let permissionChanged: boolean;
      if (existing) {
        const updated = await tx.processMember.update({
          where: { id: existing.id },
          data: { permission },
        });
        memberId = updated.id;
        memberCode = updated.displayCode;
        permissionChanged = permission !== existing.permission;
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: process.id,
          entityType: 'process_member',
          entityId: updated.id,
          entityCode: updated.displayCode,
          action: 'process.member_updated',
          after: { userCode: target.displayCode, permission },
        });
      } else {
        const created = await tx.processMember.create({
          data: {
            id: createId(),
            displayCode: await this.identifiers.nextMemberCode(tx, process.displayCode),
            processId: process.id,
            userId: target.id,
            permission,
            addedById: user.id,
          },
        });
        memberId = created.id;
        memberCode = created.displayCode;
        permissionChanged = true;
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: process.id,
          entityType: 'process_member',
          entityId: created.id,
          entityCode: created.displayCode,
          action: 'process.member_added',
          after: { userCode: target.displayCode, email: target.email, permission },
        });
      }

      if (desiredScopes !== undefined) {
        await this.accessScope.replaceMemberScopes(tx, {
          processId: process.id,
          memberId,
          scopes: desiredScopes,
        });
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: process.id,
          entityType: 'process_member',
          entityId: memberId,
          entityCode: memberCode,
          action: 'process.member_scopes_set',
          after: { scopes: desiredScopes },
        });
      }

      return { id: memberId, displayCode: memberCode, changed: permissionChanged || desiredScopes !== undefined };
    });
  }

  async updateMember(
    idOrCode: string,
    memberIdOrCode: string,
    body: UpdateProcessMemberDto,
    user: SessionUser,
  ) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    const member = await this.prisma.processMember.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: memberIdOrCode }, { displayCode: memberIdOrCode }],
      },
      include: { user: { select: { displayCode: true } } },
    });
    if (!member) throw new NotFoundException(`Member ${memberIdOrCode} not found`);

    const nextPermission = body.permission ?? member.permission;
    if (
      nextPermission !== 'viewer' &&
      nextPermission !== 'editor' &&
      nextPermission !== 'owner'
    ) {
      throw new BadRequestException('permission must be viewer | editor | owner');
    }
    if (member.permission === 'owner' && nextPermission !== 'owner') {
      const ownerCount = await this.prisma.processMember.count({
        where: { processId: process.id, permission: 'owner' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot demote the last owner');
      }
    }

    // Promotion to owner clears any scope rows; otherwise honor body intent.
    let desiredScopes: ScopeWriteInput[] | undefined;
    if (nextPermission === 'owner') {
      desiredScopes = [];
    } else {
      desiredScopes = resolveDesiredScopes(body, nextPermission);
    }

    return this.prisma.$transaction(async (tx) => {
      let permissionChanged = false;
      if (body.permission && body.permission !== member.permission) {
        await tx.processMember.update({
          where: { id: member.id },
          data: { permission: nextPermission },
        });
        permissionChanged = true;
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: process.id,
          entityType: 'process_member',
          entityId: member.id,
          entityCode: member.displayCode,
          action: 'process.member_updated',
          before: { permission: member.permission },
          after: { permission: nextPermission },
        });
      }

      if (desiredScopes !== undefined) {
        await this.accessScope.replaceMemberScopes(tx, {
          processId: process.id,
          memberId: member.id,
          scopes: desiredScopes,
        });
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: process.id,
          entityType: 'process_member',
          entityId: member.id,
          entityCode: member.displayCode,
          action: 'process.member_scopes_set',
          after: { scopes: desiredScopes },
        });
      }

      return {
        id: member.id,
        displayCode: member.displayCode,
        changed: permissionChanged || desiredScopes !== undefined,
      };
    });
  }

  async removeMember(idOrCode: string, memberIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    const member = await this.prisma.processMember.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: memberIdOrCode }, { displayCode: memberIdOrCode }],
      },
      include: { user: { select: { displayCode: true } } },
    });
    if (!member) throw new NotFoundException(`Member ${memberIdOrCode} not found`);
    if (member.permission === 'owner') {
      const ownerCount = await this.prisma.processMember.count({
        where: { processId: process.id, permission: 'owner' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot remove the last owner');
      }
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.processMember.delete({ where: { id: member.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'process_member',
        entityId: member.id,
        entityCode: member.displayCode,
        action: 'process.member_removed',
        before: { userId: member.userId },
      });
      return { ok: true };
    });
    this.realtime.emitToProcess(process.displayCode, 'process.member_removed', {
      processCode: process.displayCode,
      processName: process.name,
      removedUserCode: member.user.displayCode,
    });
    return result;
  }
}
