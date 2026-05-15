import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { attachmentContentDisposition } from '../../common/http';
import { ExportsService } from './exports.service';

@Controller('exports')
@UseGuards(AuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get(':idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.exportsService.get(idOrCode, user);
  }

  @Get(':idOrCode/download')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async download(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser, @Res() response: Response) {
    const exportRecord = await this.exportsService.download(idOrCode, user);
    response.setHeader('Content-Type', exportRecord.contentType ?? 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      attachmentContentDisposition(`${exportRecord.displayCode}.${exportRecord.format}`),
    );
    response.send(exportRecord.content);
  }
}
