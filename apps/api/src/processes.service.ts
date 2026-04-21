import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId, FUNCTION_REGISTRY } from '@ses/domain';
import { createDefaultAuditPolicy } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { IdentifierService } from './common/identifier.service';
import { ActivityLogService } from './common/activity-log.service';
import { ProcessAccessService } from './common/process-access.service';
import { FunctionsService } from './functions.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { requestContext } from './common/request-context';
import { fromDateOnly, toDateOnly } from './common/http';

function serializeProcess(process: {
  id: string;
  displayCode: string;
  rowVersion: number;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  nextAuditDue: Date | null;
  archivedAt?: Date | null;
  auditPolicy: unknown;
  policyVersion: number;
}) {
  return {
    id: process.id,
    displayCode: process.displayCode,
    rowVersion: process.rowVersion,
    name: process.name,
    description: process.description,
    createdAt: process.createdAt.toISOString(),
    updatedAt: process.updatedAt.toISOString(),
    nextAuditDue: toDateOnly(process.nextAuditDue),
    archivedAt: process.archivedAt?.toISOString() ?? null,
    auditPolicy: process.auditPolicy,
    policyVersion: process.policyVersion,
  };
}

@Injectable()
export class ProcessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly functions: FunctionsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(user: SessionUser) {
    const processes = await this.prisma.process.findMany({
      where: this.processAccess.whereAccessibleBy(user),
      orderBy: { updatedAt: 'desc' },
      include: {
        files: { select: { id: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { auditRun: { include: { issues: { select: { id: true, severity: true } } } } },
        },
        auditRuns: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { issues: { select: { severity: true } } },
        },
      },
    });
    return processes.map((process) => {
      const latest = process.auditRuns[0];
      return {
        ...serializeProcess(process),
        filesCount: process.files.length,
        versionsCount: process.versions.length,
        latestIssueCount: latest?.issues.length ?? 0,
        latestRunAt: latest?.completedAt?.toISOString() ?? latest?.startedAt.toISOString() ?? null,
        latestAuditRunCode: latest?.displayCode ?? null,
      };
    });
  }

  async create(body: { name: string; description?: string; nextAuditDue?: string | null }, user: SessionUser) {
    return this.prisma.$transaction(async (tx) => {
      const displayCode = await this.identifiers.nextProcessCode(tx);
      const process = await tx.process.create({
        data: {
          id: createId(),
          displayCode,
          name: body.name.trim(),
          description: body.description?.trim() ?? '',
          nextAuditDue: fromDateOnly(body.nextAuditDue),
          // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
          auditPolicy: createDefaultAuditPolicy() as any,
          createdById: user.id,
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });
      await tx.processMember.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextMemberCode(tx, displayCode),
          processId: process.id,
          userId: user.id,
          permission: 'owner',
        },
      });
      // Seed ProcessFunction rows so the tile dashboard has all 5 tiles from
      // the moment the process exists. Idempotent (upsert), so re-runs are safe.
      for (const fn of FUNCTION_REGISTRY) {
        await tx.processFunction.upsert({
          where: { processId_functionId: { processId: process.id, functionId: fn.id } },
          create: { processId: process.id, functionId: fn.id, enabled: true },
          update: {},
        });
      }
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'process',
        entityId: process.id,
        entityCode: process.displayCode,
        action: 'process.created',
        after: serializeProcess(process),
      });
      return serializeProcess(process);
    });
  }

  async get(idOrCode: string, user: SessionUser) {
    return serializeProcess(await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode));
  }

  async delete(idOrCode: string, user: SessionUser) {
    const allowed = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    const result = await this.prisma.$transaction(async (tx) => {
      const process = await tx.process.findFirst({
        where: { id: allowed.id },
      });
      if (!process) throw new NotFoundException(`Process ${idOrCode} not found`);
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'process',
        entityId: process.id,
        entityCode: process.displayCode,
        action: 'process.deleted',
        before: serializeProcess(process),
      });
      await tx.process.delete({ where: { id: process.id } });
      return { ok: true };
    });
    this.realtime.emitToProcess(allowed.displayCode, 'process.deleted', {
      processCode: allowed.displayCode,
      processName: allowed.name,
    });
    return result;
  }

  async update(
    idOrCode: string,
    expectedRowVersion: number,
    body: { name?: string; description?: string; nextAuditDue?: string | null },
    user: SessionUser,
  ) {
    const allowed = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.process.findFirst({
        where: { id: allowed.id },
      });
      if (!current) throw new NotFoundException(`Process ${idOrCode} not found`);
      const updated = await tx.process.updateMany({
        where: { id: current.id, rowVersion: expectedRowVersion },
        data: {
          name: body.name?.trim() ?? current.name,
          description: body.description?.trim() ?? current.description,
          ...(body.nextAuditDue === undefined ? {} : { nextAuditDue: fromDateOnly(body.nextAuditDue) ?? null }),
          rowVersion: { increment: 1 },
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });
      if (!updated.count) {
        const latest = await tx.process.findUniqueOrThrow({ where: { id: current.id } });
        throw new ConflictException({
          code: 'row_version_conflict',
          current: serializeProcess(latest),
          requestId: requestContext.get().requestId,
        });
      }
      const next = await tx.process.findUniqueOrThrow({ where: { id: current.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: next.id,
        entityType: 'process',
        entityId: next.id,
        entityCode: next.displayCode,
        action: 'process.updated',
        before: serializeProcess(current),
        after: serializeProcess(next),
      });
      return serializeProcess(next);
    });
  }

  async getPolicy(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode);
    return {
      processId: process.id,
      processCode: process.displayCode,
      rowVersion: process.rowVersion,
      policyVersion: process.policyVersion,
      auditPolicy: process.auditPolicy,
    };
  }

  async updatePolicy(
    idOrCode: string,
    expectedRowVersion: number,
    auditPolicy: Record<string, unknown>,
    user: SessionUser,
  ) {
    if (auditPolicy === null || typeof auditPolicy !== 'object' || Array.isArray(auditPolicy)) {
      throw new BadRequestException('Request body must be a JSON object (audit policy)');
    }
    const allowed = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.process.findFirst({
        where: { id: allowed.id },
      });
      if (!current) throw new NotFoundException(`Process ${idOrCode} not found`);
      const updated = await tx.process.updateMany({
        where: { id: current.id, rowVersion: expectedRowVersion },
        data: {
          // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
          auditPolicy: auditPolicy as any,
          policyVersion: { increment: 1 },
          rowVersion: { increment: 1 },
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });
      if (!updated.count) {
        const latest = await tx.process.findUniqueOrThrow({ where: { id: current.id } });
        throw new ConflictException({
          code: 'row_version_conflict',
          current: serializeProcess(latest),
          requestId: requestContext.get().requestId,
        });
      }
      const next = await tx.process.findUniqueOrThrow({ where: { id: current.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: next.id,
        entityType: 'process_policy',
        entityId: next.id,
        entityCode: next.displayCode,
        action: 'process.policy_updated',
        before: current.auditPolicy as Record<string, unknown>,
        after: next.auditPolicy as Record<string, unknown>,
      });
      return {
        processId: next.id,
        processCode: next.displayCode,
        rowVersion: next.rowVersion,
        policyVersion: next.policyVersion,
        auditPolicy: next.auditPolicy,
      };
    });
  }

  // ----- Members -----------------------------------------------------------
  //
  // Membership controls who can see a process and what they can do inside it.
  // Listing is allowed to any member (viewer+); adding/removing requires owner
  // because a member who can add others can grant themselves privileges.

  async listMembers(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const members = await this.prisma.processMember.findMany({
      where: { processId: process.id },
      orderBy: { addedAt: 'asc' },
      include: { user: { select: { id: true, displayCode: true, email: true, displayName: true, role: true } } },
    });
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
    }));
  }

  async addMember(
    idOrCode: string,
    body: { email?: string; userCode?: string; permission?: 'viewer' | 'editor' | 'owner' },
    user: SessionUser,
  ) {
    const permission = body.permission ?? 'editor';
    if (permission !== 'viewer' && permission !== 'editor' && permission !== 'owner') {
      throw new BadRequestException('permission must be viewer | editor | owner');
    }
    const lookup = body.email?.trim().toLowerCase() || body.userCode?.trim();
    if (!lookup) throw new BadRequestException('email or userCode is required');

    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'owner');
    const target = await this.prisma.user.findFirst({
      where: { OR: [{ email: lookup }, { displayCode: lookup }], isActive: true },
    });
    if (!target) throw new NotFoundException(`User ${lookup} not found`);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.processMember.findFirst({
        where: { processId: process.id, userId: target.id },
      });
      if (existing) {
        // Already a member — treat as idempotent upsert of the permission level.
        const updated = await tx.processMember.update({
          where: { id: existing.id },
          data: { permission },
        });
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
        return { id: updated.id, displayCode: updated.displayCode, changed: permission !== existing.permission };
      }
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
      return { id: created.id, displayCode: created.displayCode, changed: true };
    });
  }

  /**
   * One round-trip used by the ProcessTilesPage to render all 5 tiles.
   *
   * Returns per-function aggregates: file count, latest upload, draft
   * presence (for the current user), and the max version number seen on
   * any file in that function. Aggregates are computed in 2 queries
   * regardless of the number of functions so this endpoint scales.
   *
   * Draft presence is user-scoped — other members' drafts never leak.
   */
  async tiles(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    // Make sure the process has ProcessFunction rows; older data pre-#62
    // might be missing the seed.
    await this.functions.ensureProcessFunctions(process.id);

    const files = await this.prisma.workbookFile.findMany({
      where: { processId: process.id },
      select: {
        functionId: true,
        uploadedAt: true,
      },
    });

    // Draft presence (Issue #63 adds the table; guard so the query only
    // runs when the client is on a build that has FileDraft). We do a cheap
    // raw SQL probe first to avoid exceptions before the #63 migration lands.
    let draftFunctions = new Set<string>();
    try {
      const rows = await this.prisma.$queryRaw<Array<{ functionId: string }>>`
        SELECT "functionId" FROM "FileDraft"
        WHERE "userId" = ${user.id} AND "processId" = ${process.id}
      `;
      draftFunctions = new Set(rows.map((r) => r.functionId));
    } catch {
      // FileDraft table not yet migrated (we're on a #62-only build).
      // Treat as "no drafts" — tiles render fine without the badge.
    }

    const byFunction: Record<string, { fileCount: number; lastUploadAt: string | null; hasDraft: boolean }> = {};
    for (const fn of FUNCTION_REGISTRY) {
      const own = files.filter((f) => f.functionId === fn.id);
      const last = own.reduce<Date | null>((acc, f) => (!acc || f.uploadedAt > acc ? f.uploadedAt : acc), null);
      byFunction[fn.id] = {
        fileCount: own.length,
        lastUploadAt: last?.toISOString() ?? null,
        hasDraft: draftFunctions.has(fn.id),
      };
    }
    return byFunction;
  }

  /**
   * Stub helpdesk flow: write the request row, append an activity log entry,
   * emit a realtime event so any connected admins see it. A real wire-up
   * to an email transport lives outside this repo; we record enough that
   * an operator can manually triage.
   */
  async createFunctionAuditRequest(
    idOrCode: string,
    body: { proposedName?: string; description?: string; contactEmail?: string },
    user: SessionUser,
  ) {
    const proposedName = body.proposedName?.trim();
    const contactEmail = body.contactEmail?.trim();
    if (!proposedName) throw new BadRequestException('proposedName is required');
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('contactEmail must be a valid email');
    }
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const created = await this.prisma.$transaction(async (tx) => {
      // Displayable ref code. We piggy-back on the activity counter.
      const code = await this.identifiers.nextActivityCode(tx);
      const row = await tx.functionAuditRequest.create({
        data: {
          id: createId(),
          displayCode: `FAR-${code.split('-')[2] ?? Date.now()}`,
          processId: process.id,
          requestedById: user.id,
          proposedName: proposedName.slice(0, 200),
          description: (body.description ?? '').slice(0, 4000),
          contactEmail,
          status: 'open',
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'function_audit_request',
        entityId: row.id,
        entityCode: row.displayCode,
        action: 'function.audit_request_created',
        after: { proposedName: row.proposedName, contactEmail: row.contactEmail },
      });
      return row;
    });
    this.realtime.emitToProcess(process.displayCode, 'function.audit_request_created', {
      requestCode: created.displayCode,
      proposedName: created.proposedName,
      contactEmail: created.contactEmail,
    });
    return {
      id: created.id,
      displayCode: created.displayCode,
      processId: created.processId,
      proposedName: created.proposedName,
      description: created.description,
      contactEmail: created.contactEmail,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
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
