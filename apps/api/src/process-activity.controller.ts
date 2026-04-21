import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { FunctionAccessGuard } from './common/function-access.guard';
import { CurrentUser } from './common/current-user';
import { ProcessAccessService } from './common/process-access.service';
import { PrismaService } from './common/prisma.service';

@Controller('processes')
@UseGuards(AuthGuard, FunctionAccessGuard)
export class ProcessActivityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  @Get(':idOrCode/activity')
  async list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode);
    return this.prisma.activityLog.findMany({
      where: { processId: process.id },
      orderBy: { occurredAt: 'desc' },
      take: 250,
    });
  }
}
