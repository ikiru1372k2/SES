import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { attachmentContentDisposition } from './common/http';
import { FileVersionsService } from './file-versions.service';

@Controller()
@UseGuards(AuthGuard)
export class FileVersionsController {
  constructor(private readonly fileVersions: FileVersionsService) {}

  @Get('files/:fileIdOrCode/versions')
  list(@Param('fileIdOrCode') fileIdOrCode: string, @CurrentUser() user: SessionUser) {
    return this.fileVersions.list(fileIdOrCode, user);
  }

  @Post('files/:fileIdOrCode/versions')
  create(
    @Param('fileIdOrCode') fileIdOrCode: string,
    @Body() body: { note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.fileVersions.create(fileIdOrCode, body, user);
  }

  @Get('files/:fileIdOrCode/versions/:versionNumber/download')
  async download(
    @Param('fileIdOrCode') fileIdOrCode: string,
    @Param('versionNumber') versionNumber: string,
    @Query('downloadName') _downloadName: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res() response: Response,
  ) {
    const file = await this.fileVersions.download(fileIdOrCode, Number(versionNumber), user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', attachmentContentDisposition(file.fileName));
    response.send(file.content);
  }
}
