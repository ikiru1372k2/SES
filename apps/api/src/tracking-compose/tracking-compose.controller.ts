import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { AccessScopeService } from '../common/access-scope.service';
import { CurrentUser } from '../common/current-user';
import { PrismaService } from '../common/prisma.service';
import { TrackingComposeService, type ComposeDraftPayload } from './tracking-compose.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingComposeController {
  constructor(
    private readonly composeService: TrackingComposeService,
    private readonly accessScope: AccessScopeService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireEscalationAccess(
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

  @Get('tracking/:idOrCode/compose-status')
  async composeStatus(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    await this.requireEscalationAccess(idOrCode, user, 'view');
    return this.composeService.composeStatus(idOrCode, user);
  }

  @Post('tracking/:idOrCode/preview')
  async preview(
    @Param('idOrCode') idOrCode: string,
    @Body() body: Partial<ComposeDraftPayload>,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccess(idOrCode, user, 'edit');
    return this.composeService.preview(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/compose')
  async saveComposeDraft(
    @Param('idOrCode') idOrCode: string,
    @Body() body: ComposeDraftPayload,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccess(idOrCode, user, 'edit');
    return this.composeService.saveDraft(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/compose/discard')
  async discard(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    await this.requireEscalationAccess(idOrCode, user, 'edit');
    return this.composeService.discardDraft(idOrCode, user);
  }

  @Post('tracking/:idOrCode/send')
  async send(
    @Param('idOrCode') idOrCode: string,
    @Body() body: ComposeDraftPayload & { sources: string[] },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccess(idOrCode, user, 'edit');
    return this.composeService.send(idOrCode, user, body);
  }

  // Issue #75: admin-only cycle reset. Zeroes outlookCount / teamsCount
  // so the channel gate re-opens at Outlook #1.
  @Post('tracking/:idOrCode/force-reescalate')
  async forceReescalate(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationAccess(idOrCode, user, 'edit');
    return this.composeService.forceReescalate(idOrCode, user);
  }
}
