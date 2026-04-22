import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { TrackingStageService } from './tracking-stage.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingStageController {
  constructor(private readonly stage: TrackingStageService) {}

  @Get('tracking/:idOrCode/stage-comments')
  list(
    @Param('idOrCode') idOrCode: string,
    @Query('stage') stage: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.stage.listComments(idOrCode, user, stage?.trim() || undefined);
  }

  @Post('tracking/:idOrCode/stage-comments')
  add(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { stage: string; body: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.stage.addComment(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/verify')
  verify(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.stage.verify(idOrCode, user);
  }

  @Delete('tracking/:idOrCode/verify')
  revert(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.stage.revertVerification(idOrCode, user);
  }
}
