import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { FilesRepository } from './files.repository';
import { ProcessAccessService } from './common/process-access.service';

@Injectable()
export class FileVersionsService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async list(fileIdOrCode: string, user: SessionUser) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.findFileWithSheets(fileIdOrCode, scope ?? undefined);
    if (!file) return [];
    await this.processAccess.assertCanAccessProcess(user, file.processId);
    return this.filesRepository.listVersions(fileIdOrCode, scope ?? undefined);
  }

  async create(fileIdOrCode: string, body: { note?: string }, user: SessionUser) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.findFileWithSheets(fileIdOrCode, scope ?? undefined);
    if (!file) throw new BadRequestException(`File ${fileIdOrCode} not found`);
    await this.processAccess.require(file.processId, user, 'editor');
    return this.filesRepository.snapshotCurrentVersion(fileIdOrCode, user, body.note ?? '', scope ?? undefined);
  }

  async download(fileIdOrCode: string, versionNumber: number, user: SessionUser) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new BadRequestException('versionNumber must be a positive integer');
    }
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.getVersionDownload(fileIdOrCode, versionNumber, scope ?? undefined);
    await this.processAccess.assertCanAccessProcess(user, file.file.processId);
    return file;
  }
}
