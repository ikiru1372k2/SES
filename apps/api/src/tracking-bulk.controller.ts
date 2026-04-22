import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { TrackingBulkService } from './tracking-bulk.service';
import type { ComposeDraftPayload } from './tracking-compose/tracking-compose.service';

@Controller('tracking/bulk')
@UseGuards(AuthGuard)
export class TrackingBulkController {
  constructor(private readonly trackingBulk: TrackingBulkService) {}

  @Post('compose')
  compose(
    @Body() body: { trackingIds: string[]; payload?: Partial<ComposeDraftPayload> },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingBulk.composeBulk(body, user);
  }

  @Post('send')
  send(
    @Body() body: { trackingIds: string[]; payload: ComposeDraftPayload & { sources: string[] } },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingBulk.sendBulk(body, user);
  }

  @Post('resolve')
  resolve(@Body() body: { trackingIds: string[] }, @CurrentUser() user: SessionUser) {
    return this.trackingBulk.markResolved(body.trackingIds, user);
  }

  @Post('acknowledge')
  acknowledge(@Body() body: { trackingIds: string[]; note?: string }, @CurrentUser() user: SessionUser) {
    return this.trackingBulk.markAcknowledged(body.trackingIds, body.note ?? '', user);
  }

  @Post('snooze')
  snooze(
    @Body() body: { trackingIds: string[]; days: number; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingBulk.snooze(body.trackingIds, body.days, body.note ?? '', user);
  }

  @Post('reescalate')
  reescalate(
    @Body() body: { trackingIds: string[]; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingBulk.reescalate(body.trackingIds, body.note ?? '', user);
  }
}
