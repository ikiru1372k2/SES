import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../../auth.guard';
import { AccessScopeService } from '../../common/access-scope.service';
import { CurrentUser } from '../../common/current-user';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { TrackingService } from './tracking.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly processAccess: ProcessAccessService,
    private readonly accessScope: AccessScopeService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireEscalationAccessForProcess(
    processIdOrCode: string,
    user: SessionUser,
    action: 'view' | 'edit',
  ) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    await this.accessScope.require(process.id, user, { kind: 'escalation-center', action });
  }

  private async requireEscalationAccessForEntry(
    idOrCode: string,
    user: SessionUser,
    action: 'view' | 'edit',
  ) {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      select: { processId: true },
    });
    if (!entry) return;
    await this.accessScope.require(entry.processId, user, { kind: 'escalation-center', action });
  }

  @Get('processes/:idOrCode/tracking')
  async list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    await this.requireEscalationAccessForProcess(idOrCode, user, 'view');
    return this.trackingService.list(idOrCode, user);
  }

  @Post('processes/:idOrCode/tracking')
  async upsert(
    @Param('idOrCode') idOrCode: string,
    @Body() body: {
      managerKey: string;
      managerName: string;
      managerEmail?: string;
      stage?: string;
      resolved?: boolean;
      projectStatuses?: Record<string, unknown>;
    },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccessForProcess(idOrCode, user, 'edit');
    return this.trackingService.upsert(idOrCode, body, user);
  }

  @Patch('tracking/:idOrCode')
  async patch(
    @Param('idOrCode') idOrCode: string,
    @Body() body: {
      managerKey?: string;
      managerName?: string;
      managerEmail?: string;
      stage?: string;
      resolved?: boolean;
      projectStatuses?: Record<string, unknown>;
    },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccessForEntry(idOrCode, user, 'edit');
    return this.trackingService.patchEntry(idOrCode, body, user);
  }

  @Get('tracking/:idOrCode/events')
  async listEvents(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    await this.requireEscalationAccessForEntry(idOrCode, user, 'view');
    return this.trackingService.listEvents(idOrCode, user);
  }

  @Post('tracking/:idOrCode/events')
  async addEvent(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { channel: string; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccessForEntry(idOrCode, user, 'edit');
    return this.trackingService.addEvent(idOrCode, body, user);
  }

  @Post('tracking/:idOrCode/transition')
  async transition(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { to: string; reason: string; sourceAction: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccessForEntry(idOrCode, user, 'edit');
    return this.trackingService.transition(idOrCode, body, user);
  }
}
