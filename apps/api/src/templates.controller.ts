import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { TemplatesService } from './templates.service';

@Controller()
@UseGuards(AuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get('templates')
  list(@Query('processId') processId: string | undefined, @CurrentUser() user: SessionUser) {
    return this.templatesService.list(processId, user);
  }

  @Post('templates')
  create(
    @Body()
    body: {
      processId?: string | null;
      name: string;
      theme: string;
      template: Record<string, unknown>;
    },
    @CurrentUser() user: SessionUser,
  ) {
    return this.templatesService.create(body, user);
  }

  @Delete('templates/:idOrCode')
  delete(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.templatesService.delete(idOrCode, user);
  }
}
