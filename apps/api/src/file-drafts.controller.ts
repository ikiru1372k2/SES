import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { FunctionId, SessionUser } from '@ses/domain';
import { isFunctionId, MAX_WORKBOOK_FILE_SIZE_BYTES } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { attachmentContentDisposition } from './common/http';
import { FileDraftsService } from './file-drafts.service';

function requireFunctionId(raw: string): FunctionId {
  if (!isFunctionId(raw)) throw new BadRequestException(`Unknown function ${raw}`);
  return raw;
}

@Controller()
@UseGuards(AuthGuard)
export class FileDraftsController {
  constructor(private readonly drafts: FileDraftsService) {}

  @Put('processes/:idOrCode/functions/:functionId/draft')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_WORKBOOK_FILE_SIZE_BYTES } }))
  upsert(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: SessionUser,
  ) {
    return this.drafts.upsert(idOrCode, requireFunctionId(functionId), file, user);
  }

  @Post('processes/:idOrCode/functions/:functionId/draft/beacon')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_WORKBOOK_FILE_SIZE_BYTES } }))
  beacon(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: SessionUser,
  ) {
    return this.drafts.upsert(idOrCode, requireFunctionId(functionId), file, user);
  }

  @Get('processes/:idOrCode/functions/:functionId/draft')
  async get(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @Query('download') download: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const draft = await this.drafts.get(idOrCode, requireFunctionId(functionId), user, download === '1' || download === 'true');
    if (draft && 'content' in draft) {
      response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.setHeader('Content-Disposition', attachmentContentDisposition(draft.fileName));
      return draft.content;
    }
    return draft;
  }

  @Post('processes/:idOrCode/functions/:functionId/draft/promote')
  promote(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @Body() body: { note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    return this.drafts.promote(idOrCode, requireFunctionId(functionId), body, user);
  }

  @Delete('processes/:idOrCode/functions/:functionId/draft')
  delete(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.drafts.delete(idOrCode, requireFunctionId(functionId), user);
  }
}
