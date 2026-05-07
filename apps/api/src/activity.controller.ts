import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { Prisma } from './repositories/types';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { ProcessAccessService } from './common/process-access.service';
import { PrismaService } from './common/prisma.service';

@Controller('activity')
@UseGuards(AuthGuard)
export class ActivityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  private async scopeWhere(user: SessionUser): Promise<Prisma.ActivityLogWhereInput | undefined> {
    if (user.role === 'admin') {
      return undefined;
    }
    const processIds = await this.processAccess.listProcessIdsForUser(user.id);
    return {
      OR: [
        { processId: { in: processIds } },
        { AND: [{ processId: null }, { actorId: user.id }] },
      ],
    };
  }

  @Get('search')
  async search(@CurrentUser() user: SessionUser, @Query('code') code: string) {
    const trimmed = code?.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.length > 200) {
      throw new BadRequestException('code query must be at most 200 characters');
    }
    const match: Prisma.ActivityLogWhereInput = {
      OR: [{ entityCode: trimmed }, { displayCode: trimmed }, { requestId: trimmed }],
    };
    const scope = await this.scopeWhere(user);
    const where: Prisma.ActivityLogWhereInput = scope ? { AND: [match, scope] } : match;
    return this.prisma.activityLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  }

  @Get('by-request/:requestId')
  async byRequest(@CurrentUser() user: SessionUser, @Param('requestId') requestId: string) {
    if (requestId.length > 128) {
      throw new BadRequestException('requestId must be at most 128 characters');
    }
    const scope = await this.scopeWhere(user);
    const where: Prisma.ActivityLogWhereInput = scope
      ? { AND: [{ requestId }, scope] }
      : { requestId };
    return this.prisma.activityLog.findMany({
      where,
      orderBy: { occurredAt: 'asc' },
    });
  }
}
