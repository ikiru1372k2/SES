import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth.guard';
import { AuthService } from '../auth.service';
import { PrismaService } from '../common/prisma.service';
import { PgService } from '../db/pg.service';
import { ObjectStorageModule } from '../object-storage';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { PdfProcessingJobsRepository } from '../repositories/pdf-processing-jobs.repository';
import { AiGrpcClient } from '../ai-pilot/ai-grpc.client';
import { PdfProcessingController } from './pdf-processing.controller';
import { PdfProcessingService } from './pdf-processing.service';

@Module({
  imports: [ObjectStorageModule],
  controllers: [PdfProcessingController],
  providers: [
    PgService,
    PrismaService,
    AuthService,
    AuthGuard,
    UploadedObjectsRepository,
    PdfProcessingJobsRepository,
    AiGrpcClient,
    PdfProcessingService,
  ],
  exports: [PdfProcessingService, AiGrpcClient],
})
export class PdfProcessingModule {}
