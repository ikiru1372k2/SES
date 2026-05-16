import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { parsePositiveIntEnv } from '../../common/env';
import { ChatAuditService } from './chat-audit.service';

/**
 * F11: enforce the ai_chat_audit retention policy that migration 0007
 * deferred. Runs daily and deletes rows past the retention window.
 * Window is configurable via ANALYTICS_AUDIT_RETENTION_DAYS (default 90).
 */
@Injectable()
export class AnalyticsRetentionCron {
  private readonly logger = new Logger(AnalyticsRetentionCron.name);

  constructor(private readonly audit: ChatAuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeChatAudit(): Promise<void> {
    const days = parsePositiveIntEnv('ANALYTICS_AUDIT_RETENTION_DAYS', 90);
    try {
      const deleted = await this.audit.purgeOlderThan(days);
      if (deleted > 0) {
        this.logger.log(`ai_chat_audit retention: purged ${deleted} row(s) older than ${days}d`);
      }
    } catch (err) {
      this.logger.error(`ai_chat_audit retention purge failed: ${(err as Error).message}`);
    }
  }
}
