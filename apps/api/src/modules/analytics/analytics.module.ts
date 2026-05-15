import { Module } from '@nestjs/common';
        import { HttpModule } from '@nestjs/axios';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ChatCacheService } from './chat-cache.service';
import { ChatAuditService } from './chat-audit.service';
        @Module({
  imports: [HttpModule.register({ timeout: 120_000, maxRedirects: 0 })],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ChatCacheService, ChatAuditService],
  exports: [AnalyticsService, ChatCacheService],
        })
        export class AnalyticsModule {}

