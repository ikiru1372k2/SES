import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminGuard } from '../../common/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { DatabaseModule } from '../../db/database.module';
import { ObjectStorageModule } from '../object-storage';
import { UploadedObjectsRepository } from '../../repositories/uploaded-objects.repository';
import { parsePositiveIntEnv } from '../../common/env';
import { AiPilotController } from './ai-pilot.controller';
import { AiPilotCronService } from './ai-pilot.cron';
import { AiPilotService } from './ai-pilot.service';
import { AiClientService } from './ai-client.service';
import { AiGrpcClient } from './ai-grpc.client';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    ObjectStorageModule,
    HttpModule.register({
      baseURL: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
      timeout: parsePositiveIntEnv('AI_PILOT_REQUEST_TIMEOUT_MS', 60_000),
    }),
  ],
  controllers: [AiPilotController],
  providers: [
    UploadedObjectsRepository,
    AuthService,
    AuthGuard,
    AdminGuard,
    AiGrpcClient,
    AiPilotService,
    AiClientService,
    AiPilotCronService,
  ],
  exports: [AiPilotService],
})
export class AiPilotModule {}
