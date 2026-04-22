import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { IdentifierService } from '../common/identifier.service';
import { ActivityLogService } from '../common/activity-log.service';
import { ProcessAccessService } from '../common/process-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_ENTRY = 20;

/**
 * Mime allow-list — deliberately narrow. The controller enforces the
 * content-type coming off multer; the service sanity-checks the filename
 * extension too so a renamed .exe masquerading as a .pdf still gets
 * rejected.
 */
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/msword', // legacy .doc
  'application/vnd.ms-excel', // legacy .xls
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/plain',
  'message/rfc822', // .eml
  'application/vnd.ms-outlook', // .msg
]);

const ALLOWED_EXT = /\.(pdf|docx?|xlsx?|png|jpe?g|txt|eml|msg)$/i;

export interface AttachmentMetaDto {
  id: string;
  displayCode: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  comment: string;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
}

@Injectable()
export class TrackingAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async loadEntry(idOrCode: string, user: SessionUser, min: 'viewer' | 'editor') {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      include: { process: { select: { id: true, displayCode: true } } },
    });
    if (!entry) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(entry.processId, user, min);
    return entry;
  }

  private async loadAttachment(trackingEntryId: string, idOrCode: string) {
    const att = await this.prisma.trackingAttachment.findFirst({
      where: {
        trackingEntryId,
        OR: [{ id: idOrCode }, { displayCode: idOrCode }],
      },
    });
    if (!att) throw new NotFoundException(`Attachment ${idOrCode} not found`);
    return att;
  }

  private serialize(row: {
    id: string;
    displayCode: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    comment: string;
    uploadedById: string;
    createdAt: Date;
    uploadedBy?: { displayName: string } | null;
  }): AttachmentMetaDto {
    return {
      id: row.id,
      displayCode: row.displayCode,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      comment: row.comment,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedBy?.displayName ?? '',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user, 'viewer');
    const rows = await this.prisma.trackingAttachment.findMany({
      where: { trackingEntryId: entry.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        displayCode: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        comment: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: { select: { displayName: true } },
      },
    });
    return { attachments: rows.map((r) => this.serialize(r)) };
  }

  async create(
    idOrCode: string,
    user: SessionUser,
    file: Express.Multer.File | undefined,
    comment: string,
  ) {
    if (!file) throw new BadRequestException('File is required.');
    if (file.size === 0) throw new BadRequestException('File is empty.');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        `Attachment exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.`,
      );
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported file type: ${mime || 'unknown'}.`);
    }
    const name = (file.originalname ?? '').trim();
    if (!name) throw new BadRequestException('File name is required.');
    if (!ALLOWED_EXT.test(name)) {
      throw new BadRequestException('File extension is not in the allow-list.');
    }

    const entry = await this.loadEntry(idOrCode, user, 'editor');

    const active = await this.prisma.trackingAttachment.count({
      where: { trackingEntryId: entry.id, deletedAt: null },
    });
    if (active >= MAX_ATTACHMENTS_PER_ENTRY) {
      throw new ConflictException(
        `Attachment limit reached (${MAX_ATTACHMENTS_PER_ENTRY} per tracking entry).`,
      );
    }

    const trimmedComment = (comment ?? '').slice(0, 2000);
    // multer gives us Node's Buffer; coerce to a plain Uint8Array so the
    // Prisma `Bytes` column accepts it without a TS mismatch.
    const content = new Uint8Array(file.buffer);
    const row = await this.prisma.$transaction(async (tx) => {
      return tx.trackingAttachment.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingAttachmentCode(tx),
          trackingEntryId: entry.id,
          uploadedById: user.id,
          fileName: name,
          mimeType: mime,
          sizeBytes: file.size,
          content,
          comment: trimmedComment,
        },
        select: {
          id: true,
          displayCode: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          comment: true,
          uploadedById: true,
          createdAt: true,
          uploadedBy: { select: { displayName: true } },
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
      action: 'tracking.attachment_added',
      metadata: { attachmentId: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes },
    });

    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: entry.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });

    return this.serialize(row);
  }

  async download(idOrCode: string, attIdOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user, 'viewer');
    const att = await this.loadAttachment(entry.id, attIdOrCode);
    if (att.deletedAt) throw new NotFoundException('Attachment has been deleted.');
    return {
      fileName: att.fileName,
      mimeType: att.mimeType,
      content: att.content,
    };
  }

  async patch(
    idOrCode: string,
    attIdOrCode: string,
    user: SessionUser,
    body: { comment?: string },
  ) {
    const entry = await this.loadEntry(idOrCode, user, 'editor');
    const att = await this.loadAttachment(entry.id, attIdOrCode);
    if (att.deletedAt) throw new NotFoundException('Attachment has been deleted.');
    if (typeof body.comment !== 'string') {
      throw new BadRequestException('comment is required');
    }
    const comment = body.comment.slice(0, 2000);
    const updated = await this.prisma.trackingAttachment.update({
      where: { id: att.id },
      data: { comment },
      select: {
        id: true,
        displayCode: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        comment: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: { select: { displayName: true } },
      },
    });
    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: entry.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });
    return this.serialize(updated);
  }

  async remove(idOrCode: string, attIdOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user, 'editor');
    const att = await this.loadAttachment(entry.id, attIdOrCode);
    if (att.deletedAt) return { ok: true };
    if (att.uploadedById !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('Only the uploader or an admin can delete an attachment.');
    }
    await this.prisma.trackingAttachment.update({
      where: { id: att.id },
      data: { deletedAt: new Date() },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.attachment_deleted',
      metadata: { attachmentId: att.id, fileName: att.fileName },
    });
    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: entry.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });
    return { ok: true };
  }
}
