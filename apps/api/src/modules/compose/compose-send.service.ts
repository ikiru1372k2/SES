import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscalationStage, Prisma } from '@prisma/client';
import { createId, type SessionUser } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ComposeRenderService } from './compose-render.service';
import type { ComposeDraftPayload } from './compose.types';
import type { EscalationSendChannel } from '../../outbound/outbound-delivery.service';

/**
 * Issue #75: escalation cycle is outlook → outlook → teams, then the cycle
 * is complete. The server is the source of truth for the gate; the UI
 * mirrors it from outlookCount / teamsCount on the tracking entry.
 * Admin-only forceReescalate zeroes the counters to start a new cycle.
 */
function assertChannelAllowed(
  entry: { outlookCount: number; teamsCount: number },
  channel: EscalationSendChannel,
): void {
  const effective: 'outlook' | 'teams' = channel === 'teams' ? 'teams' : 'outlook';
  if (effective === 'outlook') {
    if (entry.outlookCount >= 2) {
      throw new ConflictException('Outlook limit reached for this cycle — escalate via Teams next.');
    }
    return;
  }
  if (entry.outlookCount < 2) {
    throw new ConflictException('Send two Outlook reminders before escalating to Teams.');
  }
  if (entry.teamsCount >= 1) {
    throw new ConflictException('Cycle complete — resolve or force re-escalate before sending again.');
  }
}

@Injectable()
export class ComposeSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimeGateway,
    private readonly renderer: ComposeRenderService,
  ) {}

  private async loadEntry(idOrCode: string, user: SessionUser) {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      include: {
        process: true,
        draftLockUser: { select: { id: true, displayName: true, email: true } },
      },
    });
    if (!entry) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(entry.processId, user, 'editor');
    return entry;
  }

  async send(idOrCode: string, user: SessionUser, body: ComposeDraftPayload & { sources: string[] }) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = new Date();
    if (
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id
    ) {
      throw new ForbiddenException('Another user holds the compose lock.');
    }
    // The ladder may be at any stage the cycle allows: NEW/DRAFTED for the
    // first Outlook, AWAITING_RESPONSE for the second, and
    // AWAITING_RESPONSE / ESCALATED_L1 / NO_RESPONSE for the Teams leg.
    if (
      entry.stage !== EscalationStage.NEW &&
      entry.stage !== EscalationStage.DRAFTED &&
      entry.stage !== EscalationStage.AWAITING_RESPONSE &&
      entry.stage !== EscalationStage.ESCALATED_L1 &&
      entry.stage !== EscalationStage.NO_RESPONSE
    ) {
      throw new BadRequestException(`Send is not allowed from stage ${entry.stage}.`);
    }

    const { subject, text, html, channel, managerEmail } = await this.renderer.resolveContent(entry, user, body);
    const sendChannel: EscalationSendChannel = channel ?? 'email';
    assertChannelAllowed({ outlookCount: entry.outlookCount, teamsCount: entry.teamsCount }, sendChannel);
    if (sendChannel === 'both') {
      throw new BadRequestException('Channel "both" is no longer supported — pick Outlook or Teams.');
    }

    const to = (managerEmail ?? '').trim();
    if (!to) throw new BadRequestException('Manager email is required before send.');

    const slaHours = entry.process.slaInitialHours ?? 120;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    const issueCount = body.sources?.length ?? 0;
    const deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : null;
    const authorNote = (body.authorNote ?? '').slice(0, 2000);

    // Teams leg transitions to ESCALATED_L1 so the timeline clearly
    // distinguishes an Outlook reminder from a Teams escalation.
    const nextStage: EscalationStage =
      sendChannel === 'teams' ? EscalationStage.ESCALATED_L1 : EscalationStage.AWAITING_RESPONSE;

    // Issue #75: no SMTP, no Teams webhook. The web client opens mailto: /
    // teams deep-link with the prefilled content after this endpoint returns.
    // We only RECORD the handoff here so the ladder advances.
    const logRow = await this.prisma.$transaction(async (tx) => {
      const log = await tx.notificationLog.create({
        data: {
          displayCode: await this.identifiers.nextNotificationLogCode(tx, entry.process.displayCode),
          processId: entry.processId,
          actorUserId: user.id,
          trackingEntryId: entry.id,
          managerEmail: to.toLowerCase(),
          managerName: entry.managerName,
          channel: sendChannel,
          subject,
          bodyPreview: text.slice(0, 2000),
          resolvedBody: text,
          sources: body.sources as object,
          issueCount,
          authorNote,
          deadlineAt,
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'escalation_sent',
          channel: sendChannel === 'teams' ? 'teams' : 'outlook',
          note: subject.slice(0, 200),
          reason: 'escalation_send',
          payload: {
            sources: body.sources,
            notificationLogId: log.id,
            deadlineAt: deadlineAt?.toISOString() ?? null,
            authorNote,
          } as object,
          triggeredById: user.id,
        },
      });
      const outlookInc = sendChannel === 'email' ? 1 : 0;
      const teamsInc = sendChannel === 'teams' ? 1 : 0;
      await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          stage: nextStage,
          outlookCount: outlookInc ? { increment: outlookInc } : undefined,
          teamsCount: teamsInc ? { increment: teamsInc } : undefined,
          lastContactAt: new Date(),
          slaDueAt,
          composeDraft: Prisma.JsonNull,
          draftLockUserId: null,
          draftLockExpiresAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: entry.processId,
        entityType: 'notification_log',
        entityId: log.id,
        entityCode: log.displayCode,
        action: 'notification.sent',
      });
      return log;
    });

    this.realtime.emitToProcess(
      entry.process.displayCode,
      'notification.sent',
      { managerEmail: logRow.managerEmail, subject: logRow.subject, issueCount: logRow.issueCount },
      { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } },
    );

    // Return resolved content so the client can hand it to mailto / Teams app immediately.
    return {
      ok: true,
      notificationLogId: logRow.id,
      channel: sendChannel,
      subject,
      body: text,
      bodyHtml: html,
      to: to.toLowerCase(),
      cc: (body.cc ?? []).map((c) => c.trim()).filter(Boolean),
    };
  }
}
