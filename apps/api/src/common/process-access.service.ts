import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../repositories/types';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from './prisma.service';

export type ProcessPermission = 'viewer' | 'editor' | 'owner';

const rank: Record<ProcessPermission, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function permissionRank(value: string | undefined): number {
  if (value === 'viewer' || value === 'editor' || value === 'owner') {
    return rank[value];
  }
  return 0;
}

@Injectable()
export class ProcessAccessService {
  constructor(private readonly prisma: PrismaService) {}

  whereAccessibleBy(user: SessionUser): Prisma.ProcessWhereInput {
    return { members: { some: { userId: user.id } } };
  }

  async listProcessIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.processMember.findMany({
      where: { userId },
      select: { processId: true },
    });
    return rows.map((row) => row.processId);
  }

  async require(processId: string, user: SessionUser, min: ProcessPermission): Promise<void> {
    const member = await this.prisma.processMember.findFirst({
      where: { processId, userId: user.id },
    });
    const pr = permissionRank(member?.permission);
    if (pr < rank[min]) {
      throw new ForbiddenException('Insufficient permission for this process');
    }
  }

  async assertCanAccessProcess(user: SessionUser, processId: string): Promise<void> {
    await this.require(processId, user, 'viewer');
  }

  async findAccessibleProcessOrThrow(
    user: SessionUser,
    idOrCode: string,
    min: ProcessPermission = 'viewer',
  ) {
    const process = await this.prisma.process.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
    });
    if (!process) {
      throw new NotFoundException(`Process ${idOrCode} not found`);
    }
    await this.require(process.id, user, min);
    return process;
  }

  whereProcessReadableBy(user: SessionUser): Prisma.ProcessWhereInput {
    return { members: { some: { userId: user.id } } };
  }
}
