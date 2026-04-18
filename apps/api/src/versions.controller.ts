import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { CreateVersionDto } from './dto/versions.dto';
import { VersionsService } from './versions.service';

@Controller()
@UseGuards(AuthGuard)
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Post('processes/:idOrCode/versions')
  create(
    @Param('idOrCode') idOrCode: string,
    @Body() body: CreateVersionDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.versionsService.create(idOrCode, body, user);
  }

  @Get('processes/:idOrCode/versions')
  list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.versionsService.list(idOrCode, user);
  }

  @Get('versions/:idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.versionsService.get(idOrCode, user);
  }

  @Get('versions/:a/compare/:b')
  compare(@Param('a') a: string, @Param('b') b: string, @CurrentUser() user: SessionUser) {
    return this.versionsService.compare(a, b, user);
  }
}
