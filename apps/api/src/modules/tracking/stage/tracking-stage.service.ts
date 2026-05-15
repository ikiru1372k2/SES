import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscalationStage } from '../../../repositories/types';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../../../common/prisma.service';
import { IdentifierService } from '../../../common/identifier.service';
import { ActivityLogService } from '../../../common/activity-log.service';
import { ProcessAccessService } from '../../../common/process-access.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';

export interface StageCommentDto {
  id: string;
  displayCode: string;
  stage: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

@Injectable()
export class TrackingStageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async loadEntry(idOrCode: string, user: SessionUser, permission: 'viewer' | 'editor' = 'viewer') {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      include: { process: { select: { id: true, displayCode: true, tenantId: true } } },
    });
    if (!entry) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(entry.processId, user, permission);
    return entry;
  }

  private serializeComment(row: {
    id: string;
    displayCode: string;
    stage: string;
    authorId: string;
    authorName: string;
    body: string;
    createdAt: Date;
  }): StageCommentDto {
    return {
      id: row.id,
      displayCode: row.displayCode,
      stage: row.stage,
      authorId: row.authorId,
      authorName: row.authorName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listComments(idOrCode: string, user: SessionUser, stage?: string) {
    const entry = await this.loadEntry(idOrCode, user, 'viewer');
    const rows = await this.prisma.trackingStageComment.findMany({
      where: { trackingEntryId: entry.id, ...(stage ? { stage } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return { comments: rows.map((r) => this.serializeComment(r)) };
  }

  async addComment(
    idOrCode: string,
    user: SessionUser,
    body: { stage: string; body: string },
  ) {
    const entry = await this.loadEntry(idOrCode, user, 'editor');
    const stage = (body.stage ?? '').trim();
    const text = (body.body ?? '').trim();
    if (!stage) throw new BadRequestException('stage is required');
    if (!text) throw new BadRequestException('body is required');
    if (text.length > 4000) {
      throw new BadRequestException('Comment must be at most 4000 characters.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      return tx.trackingStageComment.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextStageCommentCode(tx),
          trackingEntryId: entry.id,
          stage,
          authorId: user.id,
          authorName: user.displayName,
          body: text,
        },
      });
    });

    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.stage_comment_added',
      metadata: { stage, commentId: created.id },
    });

    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: entry.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });

    return this.serializeComment(created);
  }

  async verify(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user, 'editor');
    if (entry.verifiedAt) {
      // Idempotent — first verifier wins; second call is a no-op.
      return { ok: true, stage: entry.stage, verifiedAt: entry.verifiedAt.toISOString() };
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          verifiedById: user.id,
          verifiedAt: now,
          stage: EscalationStage.RESOLVED,
          resolved: true,
          rowVersion: { increment: 1 },
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'auditor_verified',
          channel: 'manual',
          note: 'Auditor verified resolution.',
          reason: 'verification',
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
        action: 'tracking.verified',
      });
      return row;
    });

    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: updated.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });

    return { ok: true, stage: updated.stage, verifiedAt: now.toISOString() };
  }

  async revertVerification(idOrCode: string, user: SessionUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required to revert verification.');
    }
    const entry = await this.loadEntry(idOrCode, user, 'editor');
    if (!entry.verifiedAt) {
      return { ok: true, stage: entry.stage };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          verifiedById: null,
          verifiedAt: null,
          resolved: false,
          rowVersion: { increment: 1 },
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'verification_reverted',
          channel: 'manual',
          note: 'Verification reverted by admin.',
          reason: 'verification_revert',
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
        action: 'tracking.verification_reverted',
      });
      return row;
    });
    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: updated.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });
    return { ok: true, stage: updated.stage };
  }
}
