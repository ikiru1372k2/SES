import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { SessionUser } from '@ses/domain';
import { MAX_WORKBOOK_FILE_SIZE_BYTES } from '@ses/domain';
import { memoryStorage } from 'multer';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { attachmentContentDisposition, parseIfMatch } from './common/http';
import { UpdateSheetSelectionDto } from './dto/processes.dto';
import { FilesService } from './files.service';

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get('processes/:idOrCode/files')
  list(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.filesService.list(idOrCode, user);
  }

  @Post('processes/:idOrCode/files')
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_WORKBOOK_FILE_SIZE_BYTES },
    }),
  )
  upload(
    @Param('idOrCode') idOrCode: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: SessionUser,
  ) {
    return this.filesService.upload(idOrCode, file, user);
  }

  @Get('files/:idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.filesService.get(idOrCode, user);
  }

  @Patch('files/:idOrCode/sheets/:sheetCode')
  updateSheet(
    @Param('idOrCode') idOrCode: string,
    @Param('sheetCode') sheetCode: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateSheetSelectionDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.filesService.updateSheet(idOrCode, sheetCode, parseIfMatch(ifMatch), body, user);
  }

  @Get('files/:idOrCode/sheets/:sheetCode/preview')
  preview(
    @Param('idOrCode') idOrCode: string,
    @Param('sheetCode') sheetCode: string,
    @CurrentUser() user: SessionUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('run') run?: string,
  ) {
    return this.filesService.preview(
      idOrCode,
      sheetCode,
      user,
      Number(page || 1),
      Number(pageSize || 100),
      run,
    );
  }

  @Get('files/:idOrCode/download')
  async download(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser, @Res() response: Response) {
    const file = await this.filesService.download(idOrCode, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', attachmentContentDisposition(file.fileName));
    response.send(file.content);
  }

  @Delete('files/:idOrCode')
  delete(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.filesService.delete(idOrCode, user);
  }
}
