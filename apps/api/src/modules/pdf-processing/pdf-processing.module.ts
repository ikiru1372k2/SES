import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { DatabaseModule } from '../../db/database.module';
import { ObjectStorageModule } from '../object-storage';
import { UploadedObjectsRepository } from '../../repositories/uploaded-objects.repository';
import { PdfProcessingJobsRepository } from '../../repositories/pdf-processing-jobs.repository';
import { AiGrpcClient } from '../ai-pilot/ai-grpc.client';
import { PdfProcessingController } from './pdf-processing.controller';
import { PdfProcessingService } from './pdf-processing.service';

@Module({
  imports: [DatabaseModule, ObjectStorageModule],
  controllers: [PdfProcessingController],
  providers: [
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
