import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId, FUNCTION_REGISTRY } from '@ses/domain';
import { createDefaultAuditPolicy } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { requestContext } from '../../common/request-context';
import { fromDateOnly, toDateOnly } from '../../common/http';

export function serializeProcess(process: {
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
export class ProcessCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
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
          tenantId: user.tenantId,
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
}
