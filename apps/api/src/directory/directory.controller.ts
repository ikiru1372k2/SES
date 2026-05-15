import { Body, Controller, Delete, Get, Patch, Post, Query, Param, UseGuards, HttpCode } from '@nestjs/common';
import type { SessionUser, DirectoryRowInput } from '@ses/domain';
import { AuthGuard } from '../modules/auth/auth.guard';
import { CurrentUser } from '../common/current-user';
import { DirectoryService } from './directory.service';

@Controller('directory')
@UseGuards(AuthGuard)
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Post('upload')
  upload(@CurrentUser() user: SessionUser, @Body() body: { rows: DirectoryRowInput[] }) {
    return this.directory.uploadPreview(user, body);
  }

  @Post('commit')
  commit(
    @CurrentUser() user: SessionUser,
    @Body() body: { rows: DirectoryRowInput[]; strategy: 'skip_duplicates' | 'update_existing' },
  ) {
    return this.directory.commit(user, body);
  }

  @Post('resolve')
  resolve(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      rawName: string;
      directoryEntryId?: string;
      inline?: DirectoryRowInput;
    },
  ) {
    return this.directory.resolve(user, body);
  }

  @Post('resolve-batch')
  resolveBatch(
    @CurrentUser() user: SessionUser,
    @Body() body: { items: Array<{ rawName: string; directoryEntryId: string }> },
  ) {
    return this.directory.resolveBatch(user, body);
  }

  @Post('entries')
  createEntry(@CurrentUser() user: SessionUser, @Body() body: DirectoryRowInput) {
    return this.directory.createManualEntry(user, body);
  }

  @Post('managers')
  createManager(
    @CurrentUser() user: SessionUser,
    @Body() body: { code: string; name: string; email: string; active?: boolean },
  ) {
    return this.directory.createManager(user, body);
  }

  @Post('archive-bulk')
  archiveBulk(@CurrentUser() user: SessionUser, @Body() body: { ids: string[] }) {
    return this.directory.archiveBulk(user, body);
  }

  @Post('merge')
  merge(@CurrentUser() user: SessionUser, @Body() body: { sourceId: string; targetId: string }) {
    return this.directory.merge(user, body);
  }

  @Post('suggestions')
  suggestions(@CurrentUser() user: SessionUser, @Body() body: { rawNames: string[] }) {
    return this.directory.suggestions(user, body);
  }

  @Get('merge-impact')
  mergeImpact(
    @CurrentUser() user: SessionUser,
    @Query('sourceId') sourceId: string,
    @Query('targetId') targetId: string,
  ) {
    return this.directory.mergeImpact(user, sourceId, targetId);
  }

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query('search') search?: string,
    @Query('filter') filter?: 'active' | 'archived' | 'all',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.directory.list(user, {
      search,
      filter,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  }

  @Get(':id/history')
  history(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.directory.history(user, id);
  }

  @Get(':id/tracking-impact')
  trackingImpact(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.directory.trackingImpact(user, id);
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      active?: boolean;
      applyEmailChange?: boolean;
    },
  ) {
    return this.directory.patchEntry(user, id, body);
  }

  @Delete('managers/:id')
  @HttpCode(204)
  async deleteManager(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.directory.deleteManager(user, id);
  }
}
