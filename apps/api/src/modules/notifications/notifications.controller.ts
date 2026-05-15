import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { RecordSendDto } from './dto/record-send.dto';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('processes/:idOrCode/notifications/sent')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  recordSend(
    @Param('idOrCode') idOrCode: string,
    @Body() body: RecordSendDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.notificationsService.recordSend(idOrCode, body, user);
  }

  @Get('processes/:idOrCode/notifications')
  list(
    @Param('idOrCode') idOrCode: string,
    @Query('managerEmail') managerEmail: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.notificationsService.list(idOrCode, user, {
      managerEmail,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
