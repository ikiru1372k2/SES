import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ChatCacheService } from './chat-cache.service';
import { ChatAuditService } from './chat-audit.service';
import { AnalyticsRetentionCron } from './analytics-retention.cron';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule.register({
      timeout: 120_000,
      maxRedirects: 0,
      // F2: authenticate every call to the AI sidecar.
      headers: { 'X-Internal-Token': process.env.SIDECAR_SHARED_SECRET ?? '' },
    }),
  ],
  controllers: [AnalyticsController],
  // F11: AnalyticsRetentionCron enforces ai_chat_audit retention.
  providers: [AnalyticsService, ChatCacheService, ChatAuditService, AnalyticsRetentionCron],
  exports: [AnalyticsService, ChatCacheService],
})
export class AnalyticsModule {}

