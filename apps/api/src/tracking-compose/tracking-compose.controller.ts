import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { TrackingComposeService, type ComposeDraftPayload } from './tracking-compose.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingComposeController {
  constructor(private readonly composeService: TrackingComposeService) {}

  @Get('tracking/:idOrCode/compose-status')
  composeStatus(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.composeService.composeStatus(idOrCode, user);
  }

  @Post('tracking/:idOrCode/preview')
  preview(
    @Param('idOrCode') idOrCode: string,
    @Body() body: Partial<ComposeDraftPayload>,
    @CurrentUser() user: SessionUser,
  ) {
    return this.composeService.preview(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/compose')
  saveComposeDraft(
    @Param('idOrCode') idOrCode: string,
    @Body() body: ComposeDraftPayload,
    @CurrentUser() user: SessionUser,
  ) {
    return this.composeService.saveDraft(idOrCode, user, body);
  }

  @Post('tracking/:idOrCode/compose/discard')
  discard(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.composeService.discardDraft(idOrCode, user);
  }

  @Post('tracking/:idOrCode/send')
  send(
    @Param('idOrCode') idOrCode: string,
    @Body() body: ComposeDraftPayload & { sources: string[] },
    @CurrentUser() user: SessionUser,
  ) {
    return this.composeService.send(idOrCode, user, body);
  }
}
