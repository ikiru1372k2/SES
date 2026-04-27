import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscalationStage, Prisma } from '@prisma/client';
import {
  assertTransition,
  createId,
  type EscalationStage as DomainEscalationStage,
  type SessionUser,
} from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { EscalationsService } from '../../escalations.service';
import { DEFAULT_TENANT_ID } from '../../common/default-tenant';
import { ComposeRenderService } from './compose-render.service';
import type { ComposeDraftPayload } from './compose.types';

const LOCK_MS = 10 * 60 * 1000;

@Injectable()
export class ComposeDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimeGateway,
    private readonly escalations: EscalationsService,
    private readonly renderer: ComposeRenderService,
  ) {}

  private tenantId(user: SessionUser): string {
    return user.tenantId ?? DEFAULT_TENANT_ID;
  }

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

  async composeStatus(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = Date.now();
    const locked =
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt.getTime() > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id;
    return {
      trackingId: entry.id,
      locked: Boolean(locked),
      lockedBy: locked ? (entry.draftLockUser?.displayName ?? null) : null,
      lockedUntil: locked ? entry.draftLockExpiresAt!.toISOString() : null,
    };
  }

  async preview(idOrCode: string, user: SessionUser, body: Partial<ComposeDraftPayload>) {
    const entry = await this.loadEntry(idOrCode, user);
    const { subject, text, html } = await this.renderer.resolveContent(entry, user, body);
    return { subject, body: text, bodyHtml: html };
  }

  async saveDraft(idOrCode: string, user: SessionUser, body: ComposeDraftPayload) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = new Date();
    if (
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id
    ) {
      throw new ConflictException('Another user is editing this draft.');
    }
    const expires = new Date(Date.now() + LOCK_MS);
    const from = entry.stage as DomainEscalationStage;
    if (from === EscalationStage.NEW) {
      assertTransition(from, EscalationStage.DRAFTED);
    }
    const nextStage = from === EscalationStage.NEW ? EscalationStage.DRAFTED : from;
    const draft = { ...body, savedAt: now.toISOString() };
    const updated = await this.prisma.trackingEntry.update({
      where: { id: entry.id },
      data: {
        composeDraft: draft as object,
        draftLockUserId: user.id,
        draftLockExpiresAt: expires,
        stage: nextStage,
        rowVersion: { increment: 1 },
      },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.compose_draft',
      after: { stage: updated.stage },
    });
    this.realtime.emitToProcess(
      entry.process.displayCode,
      'tracking.updated',
      { trackingId: entry.id, stage: updated.stage },
      { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } },
    );
    return { ok: true, stage: updated.stage, lockExpiresAt: expires.toISOString() };
  }

  async discardDraft(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user);
    if (entry.stage === EscalationStage.DRAFTED) {
      assertTransition(EscalationStage.DRAFTED, EscalationStage.NEW);
    }
    const updated = await this.prisma.trackingEntry.update({
      where: { id: entry.id },
      data: {
        composeDraft: Prisma.JsonNull,
        draftLockUserId: null,
        draftLockExpiresAt: null,
        stage: entry.stage === EscalationStage.DRAFTED ? EscalationStage.NEW : entry.stage,
        rowVersion: { increment: 1 },
      },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.compose_discard',
      after: { stage: updated.stage },
    });
    return { ok: true, stage: updated.stage };
  }

  async forceReescalate(idOrCode: string, user: SessionUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required to force a new cycle.');
    }
    const entry = await this.loadEntry(idOrCode, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          outlookCount: 0,
          teamsCount: 0,
          stage: EscalationStage.NEW,
          slaDueAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'cycle_reset',
          channel: 'manual',
          note: 'Cycle reset — Outlook and Teams counters zeroed.',
          reason: 'force_reescalate',
          triggeredById: user.id,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: entry.processId,
        entityType: 'tracking_entry',
        entityId: entry.id,
        entityCode: entry.displayCode,
        action: 'tracking.cycle_reset',
      });
      return row;
    });
    this.realtime.emitToProcess(
      entry.process.displayCode,
      'tracking.updated',
      { trackingId: entry.id, stage: updated.stage },
      { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } },
    );
    return { ok: true, stage: updated.stage };
  }
}
