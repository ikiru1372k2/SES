import { Module } from '@nestjs/common';
        import { FilesController } from './files.controller';
import { FileVersionsController } from './file-versions.controller';
import { FileDraftsController } from './file-drafts.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { FileVersionsService } from './file-versions.service';
import { FileDraftsService } from './file-drafts.service';
        @Module({
  controllers: [FilesController, FileVersionsController, FileDraftsController],
  providers: [FilesRepository, FilesService, FileVersionsService, FileDraftsService],
  exports: [FilesRepository],
        })
        export class FilesModule {}

