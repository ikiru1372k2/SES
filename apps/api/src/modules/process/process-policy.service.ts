import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { requestContext } from '../../common/request-context';
import { serializeProcess } from './process-crud.service';

@Injectable()
export class ProcessPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
  ) {}

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
}
