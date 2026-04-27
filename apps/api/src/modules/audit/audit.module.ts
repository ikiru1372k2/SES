import { Module } from '@nestjs/common';
import { AuditRunnerService } from './audit-runner.service';
import { AuditResultsService } from './audit-results.service';
import { AuditAnalyticsService } from './audit-analytics.service';

@Module({
  providers: [AuditRunnerService, AuditResultsService, AuditAnalyticsService],
  exports: [AuditRunnerService, AuditResultsService, AuditAnalyticsService],
})
export class AuditModule {}
