import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FunctionId, SessionUser } from '@ses/domain';
import { validateWorkbookDescriptor } from '@ses/domain';
import { FilesRepository } from './files.repository';
import { ProcessAccessService } from './common/process-access.service';
import { assertWorkbookUpload } from './common/security/workbook-upload';

@Injectable()
export class FileDraftsService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async upsert(processIdOrCode: string, functionId: FunctionId, file: Express.Multer.File, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const buffer = assertWorkbookUpload(file);
    return this.filesRepository.upsertDraft({
      user,
      processId: process.id,
      functionId,
      fileName: file.originalname,
      buffer,
    });
  }

  async get(processIdOrCode: string, functionId: FunctionId, user: SessionUser, download: boolean) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    if (download) {
      const draft = await this.filesRepository.getDraftWithContent(user.id, process.id, functionId);
      if (!draft) throw new NotFoundException('No draft found');
      return { fileName: draft.fileName, content: draft.content };
    }
    return this.filesRepository.getDraft(user.id, process.id, functionId) ?? { hasDraft: false };
  }

  async promote(processIdOrCode: string, functionId: FunctionId, body: { note?: string }, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const draft = await this.filesRepository.getDraftWithContent(user.id, process.id, functionId);
    if (!draft) throw new NotFoundException('No draft found to promote');
    try {
      validateWorkbookDescriptor({ name: draft.fileName, size: draft.sizeBytes });
      return await this.filesRepository.promoteDraft({
        user,
        processId: process.id,
        processCode: process.displayCode,
        functionId,
        note: body.note,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Draft could not be promoted';
      throw new BadRequestException(message);
    }
  }

  async delete(processIdOrCode: string, functionId: FunctionId, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.filesRepository.deleteDraft(user.id, process.id, functionId);
  }
}
