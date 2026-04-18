import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { attachmentContentDisposition } from './common/http';
import { RunAuditDto } from './dto/audits.dto';
import { AuditsService } from './audits.service';

@Controller()
@UseGuards(AuthGuard)
export class AuditsController {
  constructor(private readonly auditsService: AuditsService) {}

  @Post('processes/:idOrCode/audit/run')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  run(@Param('idOrCode') idOrCode: string, @Body() body: RunAuditDto, @CurrentUser() user: SessionUser) {
    return this.auditsService.run(idOrCode, body, user);
  }

  @Get('audit-runs/:idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.auditsService.get(idOrCode, user);
  }

  @Get('audit-runs/:idOrCode/issues')
  issues(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.auditsService.issues(idOrCode, user);
  }

  @Get('audit-runs/:idOrCode/export')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async export(
    @Param('idOrCode') idOrCode: string,
    @Query('format') format: string | undefined,
    @Query('corrected') corrected: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res() response: Response,
  ) {
    const file = await this.auditsService.buildExport(idOrCode, format || 'csv', user, corrected === '1' || corrected === 'true');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', attachmentContentDisposition(file.fileName));
    response.send(file.content);
  }
}
