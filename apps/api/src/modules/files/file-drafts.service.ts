import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FunctionId, SessionUser } from '@ses/domain';
import { validateWorkbookDescriptor } from '@ses/domain';
import { ActivityLogService } from '../../common/activity-log.service';
import { PrismaService } from '../../common/prisma.service';
import { FilesRepository } from './files.repository';
import { ProcessAccessService } from '../../common/process-access.service';
import { requireMultipartBuffer } from '../../common/security/workbook-upload';

@Injectable()
export class FileDraftsService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly processAccess: ProcessAccessService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async upsert(processIdOrCode: string, functionId: FunctionId, file: Express.Multer.File, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const buffer = requireMultipartBuffer(file);
    const draft = await this.filesRepository.upsertDraft({
      user,
      processId: process.id,
      processCode: process.displayCode,
      tenantId: (process as { tenantId?: string }).tenantId ?? null,
      functionId,
      fileName: file.originalname,
      buffer,
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: process.id,
      entityType: 'file_draft',
      entityId: draft.id,
      action: 'draft.upserted',
      after: { functionId, fileName: draft.fileName, sizeBytes: draft.sizeBytes },
    });
    return draft;
  }

  async get(processIdOrCode: string, functionId: FunctionId, user: SessionUser, download: boolean) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    if (download) {
      const draftRow = await this.filesRepository.getDraftWithContent(user.id, process.id, functionId);
      if (!draftRow || draftRow.userId !== user.id) throw new NotFoundException('No draft found');
      const content = await this.filesRepository.getDraftContent(draftRow);
      if (!content) throw new NotFoundException('Draft has no stored content');
      await this.activity.append(this.prisma, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'file_draft',
        entityId: draftRow.id,
        action: 'draft.downloaded',
        after: { functionId, fileName: draftRow.fileName },
      });
      return { fileName: draftRow.fileName, content };
    }
    return this.filesRepository.getDraft(user.id, process.id, functionId) ?? { hasDraft: false };
  }

  async promote(processIdOrCode: string, functionId: FunctionId, body: { note?: string }, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const draft = await this.filesRepository.getDraftWithContent(user.id, process.id, functionId);
    if (!draft || draft.userId !== user.id) throw new NotFoundException('No draft found to promote');
    try {
      validateWorkbookDescriptor({ name: draft.fileName, size: draft.sizeBytes });
      const promoted = await this.filesRepository.promoteDraft({
        user,
        processId: process.id,
        processCode: process.displayCode,
        tenantId: (process as { tenantId?: string }).tenantId ?? null,
        functionId,
        note: body.note,
      });
      await this.activity.append(this.prisma, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'workbook_file',
        entityId: promoted.file.id,
        entityCode: promoted.file.displayCode,
        action: 'draft.promoted',
        after: { functionId, versionNumber: promoted.versionNumber, fileName: promoted.file.name },
      });
      return promoted;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Draft could not be promoted';
      throw new BadRequestException(message);
    }
  }

  async delete(processIdOrCode: string, functionId: FunctionId, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const before = await this.filesRepository.getDraft(user.id, process.id, functionId);
    const result = await this.filesRepository.deleteDraft(user.id, process.id, functionId);
    if (before?.id) {
      await this.activity.append(this.prisma, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'file_draft',
        entityId: before.id,
        action: 'draft.deleted',
        before: { functionId, fileName: before.fileName },
      });
    }
    return result;
  }
}
