import { Module } from '@nestjs/common';
import { DirectoryBroadcastService } from './directory-broadcast.service';
import { DirectoryQueryService } from './directory-query.service';
import { DirectoryImportService } from './directory-import.service';
import { DirectoryMergeService } from './directory-merge.service';

@Module({
  providers: [
    DirectoryBroadcastService,
    DirectoryQueryService,
    DirectoryImportService,
    DirectoryMergeService,
  ],
  exports: [
    DirectoryBroadcastService,
    DirectoryQueryService,
    DirectoryImportService,
    DirectoryMergeService,
  ],
})
export class DirectoryModule {}
