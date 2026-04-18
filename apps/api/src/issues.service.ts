import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ActivityLogService } from './common/activity-log.service';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';

const MAX_ISSUE_KEY_LEN = 512;

function assertIssueKey(issueKey: string): void {
  if (!issueKey || issueKey.length > MAX_ISSUE_KEY_LEN) {
    throw new BadRequestException('Invalid issueKey');
  }
}

function serializeComment(comment: {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  body: string;
  createdAt: Date;
  author: { displayName: string };
}) {
  return {
    id: comment.id,
    displayCode: comment.displayCode,
    rowVersion: comment.rowVersion,
    issueKey: comment.issueKey,
    processId: comment.processId,
    author: comment.author.displayName,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

function serializeCorrection(correction: {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  correctedEffort: number | null;
  correctedState: string | null;
  correctedManager: string | null;
  note: string;
  updatedAt: Date;
}) {
  return {
    id: correction.id,
    displayCode: correction.displayCode,
    rowVersion: correction.rowVersion,
    issueKey: correction.issueKey,
    processId: correction.processId,
    effort: correction.correctedEffort ?? undefined,
    projectState: correction.correctedState ?? undefined,
    projectManager: correction.correctedManager ?? undefined,
    note: correction.note,
    updatedAt: correction.updatedAt.toISOString(),
  };
}

function serializeAcknowledgment(ack: {
  id: string;
  displayCode: string;
  rowVersion: number;
  issueKey: string;
  processId: string;
  status: string;
  updatedAt: Date;
}) {
  return {
    id: ack.id,
    displayCode: ack.displayCode,
    rowVersion: ack.rowVersion,
    issueKey: ack.issueKey,
    processId: ack.processId,
    status: ack.status,
    updatedAt: ack.updatedAt.toISOString(),
  };
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async listComments(processIdOrCode: string, issueKey: string, user: SessionUser) {
    assertIssueKey(issueKey);
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const comments = await this.prisma.issueComment.findMany({
      where: { processId: process.id, issueKey, deletedAt: null },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(serializeComment);
  }

  async listAllComments(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const comments = await this.prisma.issueComment.findMany({
      where: { processId: process.id, deletedAt: null },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(serializeComment);
  }

  async addComment(processIdOrCode: string, issueKey: string, body: { body: string }, user: SessionUser) {
    assertIssueKey(issueKey);
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.issueComment.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextCommentCode(tx),
          processId: process.id,
          issueKey,
          authorId: user.id,
          body: body.body.trim(),
        },
        include: { author: true },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'issue_comment',
        entityId: comment.id,
        entityCode: comment.displayCode,
        action: 'issue.comment_added',
        after: { issueKey },
      });
      return serializeComment(comment);
    });
  }

  async deleteComment(idOrCode: string, user: SessionUser) {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.issueComment.findFirst({
        where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
        include: { author: true },
      });
      if (!comment) throw new NotFoundException(`Comment ${idOrCode} not found`);
      await this.processAccess.require(comment.processId, user, 'editor');
      await tx.issueComment.update({
        where: { id: comment.id },
        data: {
          deletedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: comment.processId,
        entityType: 'issue_comment',
        entityId: comment.id,
        entityCode: comment.displayCode,
        action: 'issue.comment_deleted',
        before: serializeComment(comment),
      });
      return { ok: true };
    });
  }

  async listCorrections(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const corrections = await this.prisma.issueCorrection.findMany({
      where: { processId: process.id },
      orderBy: { updatedAt: 'desc' },
    });
    return corrections.map(serializeCorrection);
  }

  async saveCorrection(
    processIdOrCode: string,
    issueKey: string,
    body: { effort?: number; projectState?: string; projectManager?: string; note?: string },
    user: SessionUser,
  ) {
    assertIssueKey(issueKey);
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.issueCorrection.findFirst({
        where: { processId: process.id, issueKey },
      });
      const correction = existing
        ? await tx.issueCorrection.update({
            where: { id: existing.id },
            data: {
              correctedEffort: body.effort ?? null,
              correctedState: body.projectState ?? null,
              correctedManager: body.projectManager ?? null,
              note: body.note?.trim() ?? '',
              updatedById: user.id,
              updatedAt: new Date(),
              rowVersion: { increment: 1 },
            },
          })
        : await tx.issueCorrection.create({
            data: {
              id: createId(),
              displayCode: await this.identifiers.nextCorrectionCode(tx, issueKey),
              processId: process.id,
              issueKey,
              correctedEffort: body.effort ?? null,
              correctedState: body.projectState ?? null,
              correctedManager: body.projectManager ?? null,
              note: body.note?.trim() ?? '',
              updatedById: user.id,
            },
          });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'issue_correction',
        entityId: correction.id,
        entityCode: correction.displayCode,
        action: 'issue.correction_saved',
        after: serializeCorrection(correction),
      });
      return serializeCorrection(correction);
    });
  }

  async clearCorrection(processIdOrCode: string, issueKey: string, user: SessionUser) {
    assertIssueKey(issueKey);
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.issueCorrection.findFirst({
        where: { processId: process.id, issueKey },
      });
      if (!correction) return { ok: true };
      await tx.issueCorrection.delete({ where: { id: correction.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'issue_correction',
        entityId: correction.id,
        entityCode: correction.displayCode,
        action: 'issue.correction_cleared',
        before: serializeCorrection(correction),
      });
      return { ok: true };
    });
  }

  async listAcknowledgments(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const acknowledgments = await this.prisma.issueAcknowledgment.findMany({
      where: { processId: process.id },
      orderBy: { updatedAt: 'desc' },
    });
    return acknowledgments.map(serializeAcknowledgment);
  }

  async saveAcknowledgment(
    processIdOrCode: string,
    issueKey: string,
    body: { status: string },
    user: SessionUser,
  ) {
    assertIssueKey(issueKey);
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.issueAcknowledgment.findFirst({
        where: { processId: process.id, issueKey },
      });
      const acknowledgment = existing
        ? await tx.issueAcknowledgment.update({
            where: { id: existing.id },
            data: {
              status: body.status,
              updatedById: user.id,
              updatedAt: new Date(),
              rowVersion: { increment: 1 },
            },
          })
        : await tx.issueAcknowledgment.create({
            data: {
              id: createId(),
              displayCode: await this.identifiers.acknowledgmentCode(tx, issueKey),
              processId: process.id,
              issueKey,
              status: body.status,
              updatedById: user.id,
            },
          });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'issue_acknowledgment',
        entityId: acknowledgment.id,
        entityCode: acknowledgment.displayCode,
        action: 'issue.acknowledgment_saved',
        after: serializeAcknowledgment(acknowledgment),
      });
      return serializeAcknowledgment(acknowledgment);
    });
  }
}
