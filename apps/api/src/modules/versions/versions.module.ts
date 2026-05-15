import { Module } from '@nestjs/common';
        import { AnalyticsModule } from '../analytics/analytics.module';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';
        @Module({
  imports: [AnalyticsModule],
  controllers: [VersionsController],
  providers: [VersionsService],
        })
        export class VersionsModule {}

