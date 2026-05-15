import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { ActivityLogService } from '../../common/activity-log.service';
import { PrismaService } from '../../common/prisma.service';
import { FilesRepository } from './files.repository';
import { ProcessAccessService } from '../../common/process-access.service';

@Injectable()
export class FileVersionsService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly processAccess: ProcessAccessService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async list(fileIdOrCode: string, user: SessionUser) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.findFileWithSheets(fileIdOrCode, scope);
    if (!file) return [];
    await this.processAccess.assertCanAccessProcess(user, file.processId);
    return this.filesRepository.listVersions(fileIdOrCode, scope);
  }

  async create(fileIdOrCode: string, body: { note?: string }, user: SessionUser) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.findFileWithSheets(fileIdOrCode, scope);
    if (!file) throw new BadRequestException(`File ${fileIdOrCode} not found`);
    await this.processAccess.require(file.processId, user, 'editor');
    const created = await this.filesRepository.snapshotCurrentVersion(fileIdOrCode, user, body.note ?? '', scope);
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: file.processId,
      entityType: 'file_version',
      entityId: created.id,
      entityCode: undefined,
      action: 'file.version_created',
      after: { fileId: created.fileId, versionNumber: created.versionNumber, note: created.note },
    });
    return created;
  }

  async download(fileIdOrCode: string, versionNumber: number, user: SessionUser) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new BadRequestException('versionNumber must be a positive integer');
    }
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.getVersionDownload(fileIdOrCode, versionNumber, scope);
    await this.processAccess.assertCanAccessProcess(user, file.file.processId);
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: file.file.processId,
      entityType: 'workbook_file',
      entityId: file.file.id,
      entityCode: file.file.displayCode,
      action: 'file.version_downloaded',
      after: { versionNumber: versionNumber },
    });
    return file;
  }
}
