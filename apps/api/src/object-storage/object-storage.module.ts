import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { WorkbookStorageRepository } from '../repositories/workbook-storage.repository';
import { ObjectStorageService } from './object-storage.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    ObjectStorageService,
    UploadedObjectsRepository,
    WorkbookStorageRepository,
  ],
  exports: [
    ObjectStorageService,
    UploadedObjectsRepository,
    WorkbookStorageRepository,
  ],
})
export class ObjectStorageModule {}
