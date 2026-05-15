import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AiPilotCronService {
  private readonly logger = new Logger(AiPilotCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const { count } = await this.prisma.aiPilotSandboxSession.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) this.logger.log(`Reaped ${count} expired AI Pilot sandbox sessions`);
    } catch (err) {
      this.logger.error(
        `Sandbox cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
