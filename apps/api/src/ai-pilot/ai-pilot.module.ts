import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminGuard } from '../common/admin.guard';
import { AuthGuard } from '../auth.guard';
import { AuthService } from '../auth.service';
import { PrismaService } from '../common/prisma.service';
import { PgService } from '../db/pg.service';
import { ObjectStorageModule } from '../object-storage';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { AiPilotController } from './ai-pilot.controller';
import { AiPilotCronService } from './ai-pilot.cron';
import { AiPilotService } from './ai-pilot.service';
import { AiClientService } from './ai-client.service';
import { AiGrpcClient } from './ai-grpc.client';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ObjectStorageModule,
    HttpModule.register({
      baseURL: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
      timeout: Number(process.env.AI_PILOT_REQUEST_TIMEOUT_MS ?? 60000),
    }),
  ],
  controllers: [AiPilotController],
  providers: [
    PrismaService,
    PgService,
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
