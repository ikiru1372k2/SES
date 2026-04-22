import { Injectable } from '@nestjs/common';
import { EscalationStage } from '@prisma/client';
import type { SessionUser } from '@ses/domain';
import { ActivityLogService } from '../common/activity-log.service';
import { IdentifierService } from '../common/identifier.service';
import { ProcessAccessService } from '../common/process-access.service';
import { PrismaService } from '../common/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackingService } from '../tracking.service';
import type { RecordSendDto } from './dto/record-send.dto';

/** Maps legacy send-count heuristics to `EscalationStage`. */
function contactStage(outlookCount: number, teamsCount: number, resolved: boolean): EscalationStage {
  if (resolved) return EscalationStage.RESOLVED;
  if (teamsCount > 0) return EscalationStage.ESCALATED_L1;
  if (outlookCount >= 2) return EscalationStage.AWAITING_RESPONSE;
  if (outlookCount >= 1) return EscalationStage.SENT;
  return EscalationStage.NEW;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly tracking: TrackingService,
  ) {}

  async recordSend(processIdOrCode: string, body: RecordSendDto, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const managerKey = body.managerEmail.toLowerCase().trim();

    // Ensure tracking entry exists.
    const trackingEntry = await this.tracking.upsert(
      process.displayCode,
      { managerKey, managerName: body.managerName ?? managerKey, managerEmail: body.managerEmail },
      user,
    );

    // Increment send count and log the event.
    const updatedEntry = await this.tracking.addEvent(
      trackingEntry.displayCode,
      { channel: body.channel, note: body.subject.slice(0, 200) },
      user,
    );

    // Advance stage if it changed.
    const newStage = contactStage(updatedEntry.outlookCount, updatedEntry.teamsCount, updatedEntry.resolved);
    if (newStage !== (updatedEntry.stage as EscalationStage)) {
      await this.tracking.upsert(
        process.displayCode,
        { managerKey, managerName: body.managerName ?? managerKey, managerEmail: body.managerEmail, stage: newStage },
        user,
      );
    }

    // Insert the notification log row.
    const logRow = await this.prisma.notificationLog.create({
      data: {
        displayCode: await this.identifiers.nextNotificationLogCode(this.prisma, process.displayCode),
        processId: process.id,
        actorUserId: user.id,
        managerEmail: body.managerEmail.toLowerCase().trim(),
        managerName: body.managerName ?? null,
        channel: body.channel,
        subject: body.subject,
        bodyPreview: body.bodyPreview,
        severity: body.severity ?? null,
        issueCount: body.issueCount,
      },
    });

    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: process.id,
      entityType: 'notification_log',
      entityId: logRow.id,
      entityCode: logRow.displayCode,
      action: 'notification.sent',
    });

    this.realtime.emitToProcess(
      process.displayCode,
      'notification.sent',
      {
        managerEmail: logRow.managerEmail,
        managerName: logRow.managerName,
        channel: logRow.channel,
        subject: logRow.subject,
        issueCount: logRow.issueCount,
      },
      { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } },
    );

    return logRow;
  }

  async list(processIdOrCode: string, user: SessionUser, query: { managerEmail?: string; limit?: number }) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    return this.prisma.notificationLog.findMany({
      where: {
        processId: process.id,
        ...(query.managerEmail ? { managerEmail: query.managerEmail.toLowerCase().trim() } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: query.limit ?? 50,
    });
  }
}
