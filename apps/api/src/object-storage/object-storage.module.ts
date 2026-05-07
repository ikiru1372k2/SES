import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PgService } from '../db/pg.service';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { WorkbookStorageRepository } from '../repositories/workbook-storage.repository';
import { ObjectStorageService } from './object-storage.service';

@Global()
@Module({
  providers: [
    ObjectStorageService,
    PrismaService,
    PgService,
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
