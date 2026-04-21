import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { FunctionId, SessionUser } from '@ses/domain';
import { DEFAULT_FUNCTION_ID, isFunctionId, MAX_WORKBOOK_FILE_SIZE_BYTES } from '@ses/domain';
import { memoryStorage } from 'multer';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { FunctionAccessGuard } from './common/function-access.guard';
import { attachmentContentDisposition, parseIfMatch } from './common/http';
import { UpdateSheetSelectionDto } from './dto/processes.dto';
import { FilesService } from './files.service';

function requireFunctionId(raw: string): FunctionId {
  if (!isFunctionId(raw)) throw new BadRequestException(`Unknown function ${raw}`);
  return raw;
}

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // ----- Function-scoped routes (new in #62). These are the preferred surface
  // for the tile workspace; every read/write is scoped by (processId, functionId).

  @Get('processes/:idOrCode/functions/:functionId/files')
  @UseGuards(FunctionAccessGuard)
  listScoped(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.filesService.list(idOrCode, user, requireFunctionId(functionId));
  }

  @Post('processes/:idOrCode/functions/:functionId/files')
  @UseGuards(FunctionAccessGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_WORKBOOK_FILE_SIZE_BYTES },
    }),
  )
  uploadScoped(
    @Param('idOrCode') idOrCode: string,
    @Param('functionId') functionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('clientTempId') clientTempId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.filesService.upload(idOrCode, file, user, {
      functionId: requireFunctionId(functionId),
      clientTempId,
    });
  }

  // ----- Legacy flat routes (pre-#62). Kept for one release; default to
  // master-data when functionId is not supplied in the body (deprecation shim).

  @Get('processes/:idOrCode/files')
  list(
    @Param('idOrCode') idOrCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    const fid = functionId ? requireFunctionId(functionId) : undefined;
    return this.filesService.list(idOrCode, user, fid);
  }

  @Post('processes/:idOrCode/files')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_WORKBOOK_FILE_SIZE_BYTES },
    }),
  )
  upload(
    @Param('idOrCode') idOrCode: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('functionId') functionId: string | undefined,
    @Body('clientTempId') clientTempId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    const fid = functionId ? requireFunctionId(functionId) : DEFAULT_FUNCTION_ID;
    return this.filesService.upload(idOrCode, file, user, { functionId: fid, clientTempId });
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
  async download(
    @Param('idOrCode') idOrCode: string,
    @Query('version') version: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res() response: Response,
  ) {
    const parsedVersion = version === undefined ? undefined : Number(version);
    const file = await this.filesService.download(idOrCode, user, Number.isFinite(parsedVersion) ? parsedVersion : undefined);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', attachmentContentDisposition(file.fileName));
    response.send(file.content);
  }

  @Delete('files/:idOrCode')
  delete(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.filesService.delete(idOrCode, user);
  }
}
