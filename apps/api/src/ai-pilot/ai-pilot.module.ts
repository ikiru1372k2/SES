import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminGuard } from '../common/admin.guard';
import { AuthGuard } from '../auth.guard';
import { AuthService } from '../auth.service';
import { PrismaService } from '../common/prisma.service';
import { AiPilotController } from './ai-pilot.controller';
import { AiPilotCronService } from './ai-pilot.cron';
import { AiPilotService } from './ai-pilot.service';
import { AiPilotRulesService } from './ai-pilot-rules.service';
import { AiPilotSandboxService } from './ai-pilot-sandbox.service';
import { AiClientService } from './ai-client.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule.register({
      baseURL: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
      timeout: Number(process.env.AI_PILOT_REQUEST_TIMEOUT_MS ?? 60000),
    }),
  ],
  controllers: [AiPilotController],
  providers: [
    PrismaService,
    AuthService,
    AuthGuard,
    AdminGuard,
    AiPilotService,
    AiPilotRulesService,
    AiPilotSandboxService,
    AiClientService,
    AiPilotCronService,
  ],
  exports: [AiPilotService],
})
export class AiPilotModule {}
