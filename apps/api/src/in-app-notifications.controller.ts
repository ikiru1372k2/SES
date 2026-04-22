import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { InAppNotificationsService } from './in-app-notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class InAppNotificationsController {
  constructor(private readonly notifications: InAppNotificationsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.notifications.list(user);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: SessionUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  readOne(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.notifications.markRead(user, id);
  }
}
