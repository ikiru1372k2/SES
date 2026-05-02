import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from './repositories/types';
import type { FunctionId, SessionUser } from '@ses/domain';
import { DEFAULT_FUNCTION_ID } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ActivityLogService } from './common/activity-log.service';
import { ProcessAccessService } from './common/process-access.service';
import { requireMultipartBuffer } from './common/security/workbook-upload';
import { requestContext } from './common/request-context';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { FilesRepository, serializeWorkbookFile } from './files.repository';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly filesRepository: FilesRepository,
  ) {}

  async getFileOrThrow(idOrCode: string, user: SessionUser) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.filesRepository.findFileWithSheets(idOrCode, scope);
    if (!file) throw new NotFoundException(`File ${idOrCode} not found`);
    await this.processAccess.assertCanAccessProcess(user, file.processId);
    return file;
  }

  async list(processIdOrCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const files = await this.filesRepository.listFiles(process.id, functionId);
    return files.map(serializeWorkbookFile);
  }

  async upload(
    processIdOrCode: string,
    file: Express.Multer.File,
    user: SessionUser,
    options: { functionId: FunctionId; clientTempId?: string },
  ) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const buffer = requireMultipartBuffer(file);

    const uploaded = await this.prisma.$transaction(async (tx) => {
      let withSheets;
      try {
        withSheets = await this.filesRepository.createUploadedFile(tx, {
          processId: process.id,
          processCode: process.displayCode,
          tenantId: (process as { tenantId?: string }).tenantId ?? null,
          functionId: options.functionId,
          file,
          buffer,
          uploadedById: user.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid workbook';
        throw new BadRequestException(message);
      }

      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'workbook_file',
        entityId: withSheets.id,
        entityCode: withSheets.displayCode,
        action: 'file.uploaded',
        after: {
          name: withSheets.name,
          sizeBytes: withSheets.sizeBytes,
          processCode: process.displayCode,
          functionId: options.functionId,
        },
      });
      return serializeWorkbookFile(withSheets);
    });

    // After-commit emit
    this.realtime.emitToProcess(process.displayCode, 'file.uploaded', {
      fileCode: uploaded.displayCode,
      fileId: uploaded.id,
      functionId: uploaded.functionId,
      name: uploaded.name,
      sizeBytes: uploaded.sizeBytes,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });

    // Include the client-provided temp id so the frontend can rekey its
    // IndexedDB cache from the temp id to the server id — fixes the
    // "files disappear after reload" hydration bug (issue #63 §Acceptance).
    return { ...uploaded, clientTempId: options.clientTempId ?? null };
  }

  async get(idOrCode: string, user: SessionUser) {
    return serializeWorkbookFile(await this.getFileOrThrow(idOrCode, user));
  }

  async updateSheet(
    fileIdOrCode: string,
    sheetIdOrCode: string,
    expectedRowVersion: number,
    body: { isSelected?: boolean },
    user: SessionUser,
  ) {
    const scoped = await this.getFileOrThrow(fileIdOrCode, user);
    await this.processAccess.require(scoped.processId, user, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.workbookFile.findFirst({
        where: { OR: [{ id: fileIdOrCode }, { displayCode: fileIdOrCode }] },
      });
      if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
      const sheet = await tx.workbookSheet.findFirst({
        where: { fileId: file.id, OR: [{ id: sheetIdOrCode }, { displayCode: sheetIdOrCode }] },
      });
      if (!sheet) throw new NotFoundException(`Sheet ${sheetIdOrCode} not found`);
      const updated = await tx.workbookFile.updateMany({
        where: { id: file.id, rowVersion: expectedRowVersion },
        data: { rowVersion: { increment: 1 } },
      });
      if (!updated.count) {
        const latest = await tx.workbookFile.findUniqueOrThrow({
          where: { id: file.id },
          include: { sheets: { orderBy: { sheetName: 'asc' } } },
        });
        throw new ConflictException({
          code: 'row_version_conflict',
          current: serializeWorkbookFile(latest),
          requestId: requestContext.get().requestId,
        });
      }
      const next = await tx.workbookSheet.update({
        where: { id: sheet.id },
        data: { isSelected: body.isSelected ?? sheet.isSelected },
      });
      const latestFile = await tx.workbookFile.findUniqueOrThrow({
        where: { id: file.id },
        include: { sheets: { orderBy: { sheetName: 'asc' } } },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: file.processId,
        entityType: 'workbook_sheet',
        entityId: next.id,
        entityCode: next.displayCode,
        action: 'file.sheet_selection_updated',
        before: { isSelected: sheet.isSelected },
        after: { isSelected: next.isSelected },
      });
      return serializeWorkbookFile(latestFile);
    });
  }

  async preview(
    fileIdOrCode: string,
    sheetIdOrCode: string,
    user: SessionUser,
    page = 1,
    pageSize = 100,
    auditRunIdOrCode?: string,
  ) {
    if (!Number.isFinite(page) || page < 1) throw new BadRequestException('Invalid page');
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new BadRequestException('pageSize must be between 1 and 500');
    }
    const file = await this.getFileOrThrow(fileIdOrCode, user);
    const sheet = file.sheets.find((item: any) => item.id === sheetIdOrCode || item.displayCode === sheetIdOrCode);
    if (!sheet) throw new NotFoundException(`Sheet ${sheetIdOrCode} not found`);
    const rows = (sheet.rows as unknown[][]) ?? [];
    const headerRowIndex = sheet.headerRowIx ?? 0;
    const headers = ((sheet.originalHeaders as string[] | null) ?? rows[headerRowIndex]?.map((cell) => String(cell ?? '')) ?? []);
    const populatedRows = rows
      .slice(headerRowIndex + 1)
      .map((row, index) => ({ rowIndex: headerRowIndex + 1 + index, values: row.map((cell) => String(cell ?? '')) }))
      .filter((row) => row.values.some((value) => value.trim() !== ''));
    const start = Math.max(0, (page - 1) * pageSize);
    const slice = populatedRows.slice(start, start + pageSize);

    let issues = new Map<number, { id: string; displayCode: string; severity: string; issueKey: string }>();
    if (auditRunIdOrCode) {
      const run = await this.prisma.auditRun.findFirst({
        where: { OR: [{ id: auditRunIdOrCode }, { displayCode: auditRunIdOrCode }], fileId: file.id },
        include: { issues: true },
      });
      if (run) {
        issues = new Map(
          run.issues
            .filter((issue: any) => issue.sheetName === sheet.sheetName && issue.rowIndex !== null)
            .map((issue: any) => [issue.rowIndex!, { id: issue.id, displayCode: issue.displayCode, severity: issue.severity, issueKey: issue.issueKey }]),
        );
      }
    }

    return {
      fileId: file.id,
      fileCode: file.displayCode,
      sheetName: sheet.sheetName,
      sheetCode: sheet.displayCode,
      page,
      pageSize,
      totalRows: populatedRows.length,
      headerRowIndex,
      headers,
      rows: slice.map((row) => ({ ...row, issue: issues.get(row.rowIndex) })),
    };
  }

  async download(idOrCode: string, user: SessionUser, version?: number) {
    const scope = this.processAccess.whereProcessReadableBy(user);
    if (version !== undefined) {
      const file = await this.filesRepository.getVersionDownload(idOrCode, version, scope);
      await this.processAccess.assertCanAccessProcess(user, file.file.processId);
      await this.activity.append(this.prisma, {
        actorId: user.id,
        actorEmail: user.email,
        processId: file.file.processId,
        entityType: 'workbook_file',
        entityId: file.file.id,
        entityCode: file.file.displayCode,
        action: 'file.version_downloaded',
        after: { versionNumber: version },
      });
      return file;
    }
    const file = await this.filesRepository.getCurrentDownload(idOrCode, user, scope);
    await this.processAccess.assertCanAccessProcess(user, file.file.processId);
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: file.file.processId,
      entityType: 'workbook_file',
      entityId: file.file.id,
      entityCode: file.file.displayCode,
      action: 'file.downloaded',
      after: { current: true },
    });
    return file;
  }

  async delete(idOrCode: string, user: SessionUser) {
    const scoped = await this.getFileOrThrow(idOrCode, user);
    await this.processAccess.require(scoped.processId, user, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.workbookFile.findFirst({
        where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      });
      if (!file) throw new NotFoundException(`File ${idOrCode} not found`);
      await tx.savedVersion.deleteMany({
        where: { auditRun: { fileId: file.id } },
      });
      await tx.auditRun.deleteMany({ where: { fileId: file.id } });
      await tx.workbookSheet.deleteMany({ where: { fileId: file.id } });
      await tx.workbookFile.delete({ where: { id: file.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: file.processId,
        entityType: 'workbook_file',
        entityId: file.id,
        entityCode: file.displayCode,
        action: 'file.deleted',
        before: { name: file.name },
      });
      return { ok: true };
    });
  }
}
