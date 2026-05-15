import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { SavedViewsService } from './saved-views.service';

@Controller('views')
@UseGuards(AuthGuard)
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.views.list(user);
  }

  @Post()
  create(
    @Body() body: { name: string; filters: Record<string, string> },
    @CurrentUser() user: SessionUser,
  ) {
    return this.views.create(user, body);
  }
}
