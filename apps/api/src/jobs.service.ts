import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from './repositories/types';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ProcessAccessService } from './common/process-access.service';

const jobPublicSelect = {
  id: true,
  displayCode: true,
  kind: true,
  processId: true,
  requestId: true,
  state: true,
  attempts: true,
  result: true,
  error: true,
  createdById: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.JobSelect;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async get(idOrCode: string, user: SessionUser) {
    const row = await this.prisma.job.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      select: jobPublicSelect,
    });
    if (!row) {
      throw new NotFoundException(`Job ${idOrCode} not found`);
    }
    if (row.processId) {
      await this.processAccess.assertCanAccessProcess(user, row.processId);
    } else if (row.createdById !== user.id && user.role !== 'admin') {
      throw new ForbiddenException();
    }
    return row;
  }
}
