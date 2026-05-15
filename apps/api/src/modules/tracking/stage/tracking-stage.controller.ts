import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../../auth/auth.guard';
import { AccessScopeService } from '../../../common/access-scope.service';
import { CurrentUser } from '../../../common/current-user';
import { PrismaService } from '../../../common/prisma.service';
import { TrackingStageService } from './tracking-stage.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingStageController {
  constructor(
    private readonly stage: TrackingStageService,
    private readonly accessScope: AccessScopeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Tracking entries are escalation-center artifacts. An escalation-viewer
   * (or a function-only scoped user) must not be able to comment, verify, or
   * unverify. The legacy service-layer check only consults base permission;
   * this resolves the entry → process and requires escalation-center:edit.
   */
  private async requireEscalationEdit(idOrCode: string, user: SessionUser): Promise<string> {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      select: { processId: true },
    });
    if (!entry) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.accessScope.require(entry.processId, user, {
      kind: 'escalation-center',
      action: 'edit',
    });
    return entry.processId;
  }

  @Get('tracking/:idOrCode/stage-comments')
  list(
    @Param('idOrCode') idOrCode: string,
    @Query('stage') stage: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.stage.listComments(idOrCode, user, stage?.trim() || undefined);
  }

  @Post('tracking/:idOrCode/stage-comments')
  async add(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { stage: string; body: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationEdit(idOrCode, user);
    return this.stage.addComment(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/verify')
  async verify(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationEdit(idOrCode, user);
    return this.stage.verify(idOrCode, user);
  }

  @Delete('tracking/:idOrCode/verify')
  async revert(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEscalationEdit(idOrCode, user);
    return this.stage.revertVerification(idOrCode, user);
  }
}
