import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { TrackingService } from './tracking.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('processes/:idOrCode/tracking')
  list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.trackingService.list(idOrCode, user);
  }

  @Post('processes/:idOrCode/tracking')
  upsert(
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
    return this.trackingService.upsert(idOrCode, body, user);
  }

  @Patch('tracking/:idOrCode')
  patch(
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
    return this.trackingService.patchEntry(idOrCode, body, user);
  }

  @Get('tracking/:idOrCode/events')
  listEvents(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.trackingService.listEvents(idOrCode, user);
  }

  @Post('tracking/:idOrCode/events')
  addEvent(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { channel: string; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingService.addEvent(idOrCode, body, user);
  }

  @Post('tracking/:idOrCode/transition')
  transition(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { to: string; reason: string; sourceAction: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.trackingService.transition(idOrCode, body, user);
  }
}
