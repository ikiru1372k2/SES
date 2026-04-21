import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { FunctionId, SessionUser } from '@ses/domain';
import { createId, DEFAULT_FUNCTION_ID } from '@ses/domain';
import { parseWorkbookBuffer } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ActivityLogService } from './common/activity-log.service';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';
import { assertWorkbookUpload } from './common/security/workbook-upload';
import { requestContext } from './common/request-context';
import { RealtimeGateway } from './realtime/realtime.gateway';

function serializeSheet(sheet: {
  id: string;
  displayCode: string;
  sheetName: string;
  status: string;
  rowCount: number;
  isSelected: boolean;
  headerRowIx: number | null;
  originalHeaders: unknown;
  normalizedHeaders: unknown;
}) {
  return {
    id: sheet.id,
    displayCode: sheet.displayCode,
    name: sheet.sheetName,
    status: sheet.status,
    rowCount: sheet.rowCount,
    isSelected: sheet.isSelected,
    headerRowIndex: sheet.headerRowIx ?? undefined,
    originalHeaders: (sheet.originalHeaders as string[] | null) ?? undefined,
    normalizedHeaders: (sheet.normalizedHeaders as string[] | null) ?? undefined,
  };
}

function serializeFile(file: {
  id: string;
  displayCode: string;
  processId: string;
  functionId?: string | null;
  rowVersion: number;
  name: string;
  sizeBytes: number;
  mimeType: string;
  storageKind: string;
  uploadedAt: Date;
  lastAuditedAt: Date | null;
  sheets?: Array<{
    id: string;
    displayCode: string;
    sheetName: string;
    status: string;
    rowCount: number;
    isSelected: boolean;
    headerRowIx: number | null;
    originalHeaders: unknown;
    normalizedHeaders: unknown;
  }>;
}) {
  return {
    id: file.id,
    displayCode: file.displayCode,
    processId: file.processId,
    functionId: (file.functionId ?? DEFAULT_FUNCTION_ID) as FunctionId,
    rowVersion: file.rowVersion,
    name: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    storageKind: file.storageKind,
    uploadedAt: file.uploadedAt.toISOString(),
    lastAuditedAt: file.lastAuditedAt?.toISOString() ?? null,
    isAudited: Boolean(file.lastAuditedAt),
    sheets: file.sheets?.map(serializeSheet) ?? [],
  };
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async getFileOrThrow(idOrCode: string, user: SessionUser) {
    const match: Prisma.WorkbookFileWhereInput = { OR: [{ id: idOrCode }, { displayCode: idOrCode }] };
    const scope = this.processAccess.whereProcessReadableBy(user);
    const file = await this.prisma.workbookFile.findFirst({
      where: scope ? { AND: [match, { process: scope }] } : match,
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
    if (!file) throw new NotFoundException(`File ${idOrCode} not found`);
    await this.processAccess.assertCanAccessProcess(user, file.processId);
    return file;
  }

  async list(processIdOrCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const files = await this.prisma.workbookFile.findMany({
      where: functionId ? { processId: process.id, functionId } : { processId: process.id },
      orderBy: { uploadedAt: 'desc' },
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
    return files.map(serializeFile);
  }

  async upload(
    processIdOrCode: string,
    file: Express.Multer.File,
    user: SessionUser,
    options: { functionId: FunctionId; clientTempId?: string },
  ) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const buffer = assertWorkbookUpload(file);
    let workbook;
    try {
      workbook = await parseWorkbookBuffer(buffer, file.originalname);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid workbook';
      throw new BadRequestException(message);
    }
    const contentSha256 = createHash('sha256').update(buffer).digest();

    const uploaded = await this.prisma.$transaction(async (tx) => {
      const fileCode = await this.identifiers.nextFileCode(tx, process.displayCode);
      const created = await tx.workbookFile.create({
        data: {
          id: createId(),
          displayCode: fileCode,
          processId: process.id,
          functionId: options.functionId,
          name: workbook.name,
          sizeBytes: buffer.byteLength,
          contentSha256,
          mimeType: file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          storageKind: 'postgres',
          // PRISMA-JSON: content is Bytes; parsedSheets is Json — both unavoidable until Prisma 6
          content: buffer as any,
          parsedSheets: workbook.sheets as any,
          uploadedById: user.id,
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });

      for (const sheet of workbook.sheets) {
        await tx.workbookSheet.create({
          data: {
            id: createId(),
            displayCode: await this.identifiers.nextSheetCode(tx, fileCode),
            fileId: created.id,
            sheetName: sheet.name,
            status: sheet.status,
            rowCount: sheet.rowCount,
            isSelected: sheet.isSelected,
            headerRowIx: sheet.headerRowIndex,
            // PRISMA-JSON: rows/originalHeaders/normalizedHeaders are Json columns
            rows: (workbook.rawData[sheet.name] ?? []) as any,
            originalHeaders: (sheet.originalHeaders ?? undefined) as any,
            normalizedHeaders: (sheet.normalizedHeaders ?? undefined) as any,
          } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
        });
      }

      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'workbook_file',
        entityId: created.id,
        entityCode: created.displayCode,
        action: 'file.uploaded',
        after: {
          name: created.name,
          sizeBytes: created.sizeBytes,
          processCode: process.displayCode,
          functionId: options.functionId,
        },
      });

      const withSheets = await tx.workbookFile.findUniqueOrThrow({
        where: { id: created.id },
        include: { sheets: { orderBy: { sheetName: 'asc' } } },
      });
      return serializeFile(withSheets);
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
    return serializeFile(await this.getFileOrThrow(idOrCode, user));
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
          current: serializeFile(latest),
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
      return serializeFile(latestFile);
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
    const sheet = file.sheets.find((item) => item.id === sheetIdOrCode || item.displayCode === sheetIdOrCode);
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
            .filter((issue) => issue.sheetName === sheet.sheetName && issue.rowIndex !== null)
            .map((issue) => [issue.rowIndex!, { id: issue.id, displayCode: issue.displayCode, severity: issue.severity, issueKey: issue.issueKey }]),
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

  async download(idOrCode: string, user: SessionUser) {
    const file = await this.getFileOrThrow(idOrCode, user);
    return {
      fileName: file.name,
      mimeType: file.mimeType,
      content: file.content,
    };
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
