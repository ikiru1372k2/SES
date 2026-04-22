import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EscalationStage, Prisma } from '@prisma/client';
import { createId } from '@ses/domain';
import { IdentifierService } from './common/identifier.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { PrismaService } from './common/prisma.service';

const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_L1_DELAY_HOURS = 24;
const DEFAULT_L2_DELAY_HOURS = 24;

type EscalationPolicy = {
  initialSlaHours: number;
  l1DelayHours: number;
  l2DelayHours: number;
};

@Injectable()
export class SlaEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaEngineService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly notifications: InAppNotificationsService,
  ) {}

  onModuleInit() {
    const intervalMinutes = Number.parseInt(process.env.SLA_ENFORCER_INTERVAL_MINUTES ?? '', 10);
    const minutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : DEFAULT_INTERVAL_MINUTES;
    this.timer = setInterval(() => {
      void this.enforce().catch((error) => {
        this.logger.error(`SLA enforce failed: ${(error as Error).message}`);
      });
    }, minutes * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async enforce() {
    const now = new Date();
    const entries = await this.prisma.trackingEntry.findMany({
      where: {
        OR: [
          { stage: EscalationStage.SENT, slaDueAt: { lte: now } },
          { stage: EscalationStage.AWAITING_RESPONSE, slaDueAt: { lte: now } },
          { stage: EscalationStage.ESCALATED_L1, slaDueAt: { lte: now } },
        ],
      },
      include: { process: true },
      take: 500,
      orderBy: { slaDueAt: 'asc' },
    });

    for (const entry of entries) {
      await this.handleEntry(entry.id, now);
    }
  }

  private policyFromProcessAuditPolicy(auditPolicy: unknown, initialSlaHours: number): EscalationPolicy {
    if (!auditPolicy || typeof auditPolicy !== 'object') {
      return {
        initialSlaHours,
        l1DelayHours: DEFAULT_L1_DELAY_HOURS,
        l2DelayHours: DEFAULT_L2_DELAY_HOURS,
      };
    }
    const policy = auditPolicy as Record<string, unknown>;
    const escalation = (policy.escalation ?? {}) as Record<string, unknown>;
    const l1Delay = Number.parseInt(String(escalation.l1DelayHours ?? ''), 10);
    const l2Delay = Number.parseInt(String(escalation.l2DelayHours ?? ''), 10);
    return {
      initialSlaHours,
      l1DelayHours: Number.isFinite(l1Delay) && l1Delay > 0 ? l1Delay : DEFAULT_L1_DELAY_HOURS,
      l2DelayHours: Number.isFinite(l2Delay) && l2Delay > 0 ? l2Delay : DEFAULT_L2_DELAY_HOURS,
    };
  }

  private async handleEntry(entryId: string, now: Date) {
    let publishMessage: { message: string; link: string; processId: string } | undefined;
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.trackingEntry.findFirst({
        where: { id: entryId },
        include: { process: true },
      });
      if (!entry || !entry.slaDueAt) return;

      const policy = this.policyFromProcessAuditPolicy(entry.process.auditPolicy, entry.process.slaInitialHours ?? 120);

      const stageToQueue =
        entry.stage === EscalationStage.SENT || entry.stage === EscalationStage.AWAITING_RESPONSE
          ? 'L1'
          : entry.stage === EscalationStage.ESCALATED_L1
            ? 'L2'
            : null;
      if (!stageToQueue) return;

      if (stageToQueue === 'L2') {
        const l2DueAt = new Date(entry.slaDueAt.getTime() + policy.l2DelayHours * 60 * 60 * 1000);
        if (l2DueAt > now) return;
      }

      const existingQueued = await tx.trackingEvent.findMany({
        where: {
          trackingId: entry.id,
          kind: 'sla_draft_queued',
        },
        select: { payload: true },
        take: 20,
      });
      const alreadyQueued = existingQueued.some((event) => {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        return String(payload.stage ?? '') === stageToQueue;
      });
      if (alreadyQueued) return;

      await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          stage: EscalationStage.NO_RESPONSE,
          escalationLevel: stageToQueue === 'L2' ? 2 : 1,
          rowVersion: { increment: 1 },
        },
      });

      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'sla_draft_queued',
          channel: 'system',
          reason: 'sla_breach',
          payload: {
            stage: stageToQueue,
            queuedAt: now.toISOString(),
            draftOnly: true,
          } as Prisma.InputJsonValue,
        },
      });

      publishMessage = {
        message: `${entry.managerName} breached SLA - ${stageToQueue} draft queued`,
        link: `/processes/${entry.process.displayCode}/escalations`,
        processId: entry.processId,
      };
    });
    if (publishMessage !== undefined) {
      await this.notifications.publish(publishMessage.message, {
        link: publishMessage.link,
        kind: 'sla_breach',
        processId: publishMessage.processId,
      });
    }
  }
}
