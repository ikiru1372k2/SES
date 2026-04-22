import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { attachmentContentDisposition } from '../common/http';
import {
  MAX_ATTACHMENT_BYTES,
  TrackingAttachmentsService,
} from './tracking-attachments.service';

@Controller()
@UseGuards(AuthGuard)
export class TrackingAttachmentsController {
  constructor(private readonly svc: TrackingAttachmentsService) {}

  @Get('tracking/:idOrCode/attachments')
  list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.svc.list(idOrCode, user);
  }

  @Post('tracking/:idOrCode/attachments')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  upload(
    @Param('idOrCode') idOrCode: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('comment') comment: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.svc.create(idOrCode, user, file, comment ?? '');
  }

  @Get('tracking/:idOrCode/attachments/:attIdOrCode/download')
  async download(
    @Param('idOrCode') idOrCode: string,
    @Param('attIdOrCode') attIdOrCode: string,
    @CurrentUser() user: SessionUser,
    @Res() res: Response,
  ) {
    const { fileName, mimeType, content } = await this.svc.download(idOrCode, attIdOrCode, user);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', attachmentContentDisposition(fileName));
    res.setHeader('Content-Length', String(content.length));
    // Buffer straight out — no streaming needed at 10 MB cap.
    res.send(content);
  }

  @Patch('tracking/:idOrCode/attachments/:attIdOrCode')
  patch(
    @Param('idOrCode') idOrCode: string,
    @Param('attIdOrCode') attIdOrCode: string,
    @Body() body: { comment: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.svc.patch(idOrCode, attIdOrCode, user, body);
  }

  @Delete('tracking/:idOrCode/attachments/:attIdOrCode')
  remove(
    @Param('idOrCode') idOrCode: string,
    @Param('attIdOrCode') attIdOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.svc.remove(idOrCode, attIdOrCode, user);
  }
}
