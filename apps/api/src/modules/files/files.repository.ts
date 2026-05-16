import type { Prisma } from '../../repositories/types';
import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { FunctionId, SessionUser } from '@ses/domain';
import { createId, parseWorkbookBuffer } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { WorkbookStorageRepository } from '../../repositories/workbook-storage.repository';
import { UploadedObjectsRepository } from '../../repositories/uploaded-objects.repository';

type Tx = Prisma.TransactionClient;

type WorkbookForSerialization = {
  id: string;
  displayCode: string;
  processId: string;
  functionId?: string | null;
  rowVersion: number;
  currentVersion?: number;
  state?: string;
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
};

export function serializeWorkbookFile(file: WorkbookForSerialization) {
  return {
    id: file.id,
    displayCode: file.displayCode,
    processId: file.processId,
    functionId: file.functionId,
    rowVersion: file.rowVersion,
    currentVersion: file.currentVersion ?? 1,
    state: file.state ?? 'completed',
    name: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    storageKind: file.storageKind,
    uploadedAt: file.uploadedAt.toISOString(),
    lastAuditedAt: file.lastAuditedAt?.toISOString() ?? null,
    isAudited: Boolean(file.lastAuditedAt),
    sheets: file.sheets?.map((sheet) => ({
      id: sheet.id,
      displayCode: sheet.displayCode,
      name: sheet.sheetName,
      status: sheet.status,
      rowCount: sheet.rowCount,
      isSelected: sheet.isSelected,
      headerRowIndex: sheet.headerRowIx ?? undefined,
      originalHeaders: (sheet.originalHeaders as string[] | null) ?? undefined,
      normalizedHeaders: (sheet.normalizedHeaders as string[] | null) ?? undefined,
    })) ?? [],
  };
}

function sha256(buffer: Buffer | Uint8Array) {
  return createHash('sha256').update(buffer).digest();
}

@Injectable()
export class FilesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly workbookStorage: WorkbookStorageRepository,
    private readonly uploadedObjects: UploadedObjectsRepository,
  ) {}

  async findFileWithSheets(idOrCode: string, processScope?: Prisma.ProcessWhereInput) {
    const match: Prisma.WorkbookFileWhereInput = { OR: [{ id: idOrCode }, { displayCode: idOrCode }] };
    return this.prisma.workbookFile.findFirst({
      where: processScope ? { AND: [match, { process: processScope }] } : match,
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
  }

  async listFiles(processId: string, functionId?: FunctionId) {
    return this.prisma.workbookFile.findMany({
      where: functionId ? { processId, functionId } : { processId },
      orderBy: { uploadedAt: 'desc' },
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
  }

  async createUploadedFile(
    tx: Tx,
    input: {
      processId: string;
      processCode: string;
      tenantId: string | null;
      functionId: FunctionId;
      file: Express.Multer.File;
      buffer: Buffer;
      uploadedById: string;
    },
  ) {
    const workbook = await parseWorkbookBuffer(input.buffer, input.file.originalname);
    const fileCode = await this.identifiers.nextFileCode(tx, input.processCode);
    const contentSha256 = sha256(input.buffer);
    const mimeType =
      input.file.mimetype ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Upload to S3 before DB rows; orphans on tx rollback are swept by janitor.
    const wbObject = await this.workbookStorage.putWorkbook({
      tenantId: input.tenantId,
      ownerId: input.uploadedById,
      processCode: input.processCode,
      fileCode,
      versionNumber: 1,
      buffer: input.buffer,
      fileName: workbook.name,
      contentType: mimeType,
    });

    // Same bytes serve as v1 FileVersion — reuse the uploaded_object row.
    const versionObject = wbObject;

    const created = await tx.workbookFile.create({
      data: {
        id: createId(),
        displayCode: fileCode,
        processId: input.processId,
        functionId: input.functionId,
        name: workbook.name,
        sizeBytes: input.buffer.byteLength,
        contentSha256,
        mimeType,
        storageKind: 's3',
        parsedSheets: workbook.sheets as any,
        uploadedById: input.uploadedById,
        state: 'completed',
        currentVersion: 1,
        uploadedObjectId: wbObject.uploadedObjectId,
      } as any,
    });

    await tx.fileVersion.create({
      data: {
        id: createId(),
        fileId: created.id,
        versionNumber: 1,
        contentSha256,
        sizeBytes: input.buffer.byteLength,
        note: 'Initial uploaded version',
        createdById: input.uploadedById,
        uploadedObjectId: versionObject.uploadedObjectId,
      },
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
          rows: (workbook.rawData[sheet.name] ?? []) as any,
          originalHeaders: (sheet.originalHeaders ?? undefined) as any,
          normalizedHeaders: (sheet.normalizedHeaders ?? undefined) as any,
        } as any,
      });
    }

    await tx.fileDraft.deleteMany({
      where: { userId: input.uploadedById, processId: input.processId, functionId: input.functionId },
    });

    return tx.workbookFile.findUniqueOrThrow({
      where: { id: created.id },
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
  }

  async getCurrentDownload(idOrCode: string, user: SessionUser, processScope?: Prisma.ProcessWhereInput) {
    const file = await this.findFileWithSheets(idOrCode, processScope);
    if (!file) throw new NotFoundException(`File ${idOrCode} not found`);
    const content = await this.fetchFileContent(file);
    if (!content) throw new NotFoundException(`File ${idOrCode} has no stored content`);
    return {
      file,
      fileName: file.name,
      mimeType: file.mimeType,
      content,
      user,
    };
  }

  async getVersionDownload(fileIdOrCode: string, versionNumber: number, processScope?: Prisma.ProcessWhereInput) {
    const file = await this.findFileWithSheets(fileIdOrCode, processScope);
    if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
    const version = await this.prisma.fileVersion.findUnique({
      where: { fileId_versionNumber: { fileId: file.id, versionNumber } },
    });
    if (!version) throw new NotFoundException(`Version ${versionNumber} not found for ${fileIdOrCode}`);
    const content = await this.fetchVersionContent(version);
    if (!content) throw new NotFoundException(`Version ${versionNumber} for ${fileIdOrCode} has no stored content`);
    return {
      file,
      version,
      fileName: versionNumber === file.currentVersion ? file.name : `${file.name.replace(/\.(xlsx|xlsm)$/i, '')}_v${versionNumber}.xlsx`,
      mimeType: file.mimeType,
      content,
    };
  }

  /**
   * Fetch a workbook's bytes. Prefers the new MinIO/S3 path
   * (`uploadedObjectId`); falls back to legacy `FileBlob.content` for
   * rows uploaded before the storage migration.
   */
  private async fetchFileContent(file: { id: string; uploadedObjectId?: string | null }): Promise<Buffer | null> {
    if (file.uploadedObjectId) {
      try {
        return await this.workbookStorage.getBuffer(file.uploadedObjectId);
      } catch (err) {
        // Fall through to BYTEA for legacy rows / transient S3 errors.
      }
    }
    const blob = await this.prisma.fileBlob.findUnique({ where: { fileId: file.id } });
    if (!blob || !blob.content) return null;
    return blob.content as Buffer;
  }

  private async fetchVersionContent(version: {
    content?: Buffer | null;
    uploadedObjectId?: string | null;
  }): Promise<Buffer | null> {
    if (version.uploadedObjectId) {
      try {
        return await this.workbookStorage.getBuffer(version.uploadedObjectId);
      } catch {
        // fall through
      }
    }
    return (version.content as Buffer | null | undefined) ?? null;
  }

  async listVersions(fileIdOrCode: string, processScope?: Prisma.ProcessWhereInput) {
    const file = await this.findFileWithSheets(fileIdOrCode, processScope);
    if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
    const versions = await this.prisma.fileVersion.findMany({
      where: { fileId: file.id },
      orderBy: { versionNumber: 'desc' },
      include: { createdBy: { select: { displayCode: true, displayName: true, email: true } } },
    });
    return versions.map((version) => ({
      id: version.id,
      fileId: version.fileId,
      versionNumber: version.versionNumber,
      note: version.note,
      sizeBytes: version.sizeBytes,
      createdAt: version.createdAt.toISOString(),
      createdBy: version.createdBy,
      isCurrent: version.versionNumber === file.currentVersion,
    }));
  }

  async snapshotCurrentVersion(fileIdOrCode: string, user: SessionUser, note = '', processScope?: Prisma.ProcessWhereInput) {
    const file = await this.findFileWithSheets(fileIdOrCode, processScope);
    if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
    // Confirm bytes are reachable before writing the snapshot row.
    const content = await this.fetchFileContent(file);
    if (!content) throw new NotFoundException(`File ${fileIdOrCode} has no stored content`);
    const latest = await this.prisma.fileVersion.aggregate({
      where: { fileId: file.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (latest._max.versionNumber ?? 0) + 1;
    // Reuse uploadedObjectId — identical bytes; legacy rows keep writing BYTEA.
    const useObjectRef = Boolean(file.uploadedObjectId);
    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.fileVersion.create({
        data: {
          id: createId(),
          fileId: file.id,
          versionNumber,
          content: useObjectRef ? null : content,
          contentSha256: file.contentSha256,
          sizeBytes: file.sizeBytes,
          note: note.trim(),
          createdById: user.id,
          uploadedObjectId: useObjectRef ? file.uploadedObjectId : null,
        },
      });
      await tx.workbookFile.update({
        where: { id: file.id },
        data: { currentVersion: versionNumber, rowVersion: { increment: 1 } },
      });
      return version;
    });
    return {
      id: created.id,
      fileId: created.fileId,
      versionNumber: created.versionNumber,
      note: created.note,
      sizeBytes: created.sizeBytes,
      createdAt: created.createdAt.toISOString(),
      isCurrent: true,
    };
  }

  async upsertDraft(input: {
    user: SessionUser;
    processId: string;
    processCode: string;
    tenantId: string | null;
    functionId: FunctionId;
    fileName: string;
    buffer: Buffer;
  }) {
    const now = new Date();
    const stored = await this.workbookStorage.putDraft({
      tenantId: input.tenantId,
      ownerId: input.user.id,
      processCode: input.processCode,
      userId: input.user.id,
      functionId: input.functionId,
      fileName: input.fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: input.buffer,
    });

    // Drop the previous draft's object so the bucket doesn't accumulate orphans.
    const existing = await this.prisma.fileDraft.findUnique({
      where: {
        userId_processId_functionId: {
          userId: input.user.id,
          processId: input.processId,
          functionId: input.functionId,
        },
      },
    });
    if (existing?.uploadedObjectId && existing.uploadedObjectId !== stored.uploadedObjectId) {
      this.workbookStorage
        .deleteByUploadedObjectId(existing.uploadedObjectId)
        .catch(() => undefined);
    }

    const draft = await this.prisma.fileDraft.upsert({
      where: {
        userId_processId_functionId: {
          userId: input.user.id,
          processId: input.processId,
          functionId: input.functionId,
        },
      },
      create: {
        id: createId(),
        userId: input.user.id,
        processId: input.processId,
        functionId: input.functionId,
        fileName: input.fileName,
        content: null,
        sizeBytes: input.buffer.byteLength,
        updatedAt: now,
        uploadedObjectId: stored.uploadedObjectId,
      },
      update: {
        fileName: input.fileName,
        content: null,
        sizeBytes: input.buffer.byteLength,
        updatedAt: now,
        uploadedObjectId: stored.uploadedObjectId,
      },
    });
    return this.serializeDraft(draft);
  }

  async getDraft(userId: string, processId: string, functionId: FunctionId) {
    const draft = await this.prisma.fileDraft.findUnique({
      where: { userId_processId_functionId: { userId, processId, functionId } },
    });
    return draft ? this.serializeDraft(draft) : null;
  }

  async getDraftWithContent(userId: string, processId: string, functionId: FunctionId) {
    return this.prisma.fileDraft.findUnique({
      where: { userId_processId_functionId: { userId, processId, functionId } },
    });
  }

  async deleteDraft(userId: string, processId: string, functionId: FunctionId) {
    const existing = await this.prisma.fileDraft.findUnique({
      where: { userId_processId_functionId: { userId, processId, functionId } },
    });
    if (existing?.uploadedObjectId) {
      this.workbookStorage
        .deleteByUploadedObjectId(existing.uploadedObjectId)
        .catch(() => undefined);
    }
    await this.prisma.fileDraft.deleteMany({ where: { userId, processId, functionId } });
    return { ok: true };
  }

  async promoteDraft(input: {
    user: SessionUser;
    processId: string;
    processCode: string;
    tenantId: string | null;
    functionId: FunctionId;
    note?: string;
  }) {
    const draft = await this.getDraftWithContent(input.user.id, input.processId, input.functionId);
    if (!draft) throw new NotFoundException('No draft found to promote');
    const buffer = await this.fetchDraftContent(draft);
    if (!buffer) throw new NotFoundException('Draft has no stored content');
    const workbook = await parseWorkbookBuffer(buffer, draft.fileName);
    const contentSha256 = sha256(buffer);

    // Decide target file first so the S3 key carries the right fileCode + version.
    const latestFile = await this.prisma.workbookFile.findFirst({
      where: { processId: input.processId, functionId: input.functionId },
      orderBy: { uploadedAt: 'desc' },
    });
    const isFirstUpload = !latestFile;
    const fileCode = isFirstUpload
      ? await this.identifiers.nextFileCode(this.prisma, input.processCode)
      : latestFile!.displayCode;
    const versionNumber = isFirstUpload ? 1 : latestFile!.currentVersion + 1;

    const stored = await this.workbookStorage.putWorkbook({
      tenantId: input.tenantId,
      ownerId: input.user.id,
      processCode: input.processCode,
      fileCode,
      versionNumber,
      buffer,
      fileName: workbook.name,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    return this.prisma.$transaction(async (tx) => {
      if (isFirstUpload) {
        const created = await tx.workbookFile.create({
          data: {
            id: createId(),
            displayCode: fileCode,
            processId: input.processId,
            functionId: input.functionId,
            name: workbook.name,
            sizeBytes: buffer.byteLength,
            contentSha256,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            storageKind: 's3',
            parsedSheets: workbook.sheets as any,
            uploadedById: input.user.id,
            state: 'completed',
            currentVersion: 1,
            uploadedObjectId: stored.uploadedObjectId,
          } as any,
        });
        await tx.fileVersion.create({
          data: {
            id: createId(),
            fileId: created.id,
            versionNumber: 1,
            contentSha256,
            sizeBytes: buffer.byteLength,
            note: input.note?.trim() || 'Promoted from draft',
            createdById: input.user.id,
            uploadedObjectId: stored.uploadedObjectId,
          },
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
              rows: (workbook.rawData[sheet.name] ?? []) as any,
              originalHeaders: (sheet.originalHeaders ?? undefined) as any,
              normalizedHeaders: (sheet.normalizedHeaders ?? undefined) as any,
            } as any,
          });
        }
        await tx.fileDraft.delete({ where: { id: draft.id } });
        const withSheets = await tx.workbookFile.findUniqueOrThrow({
          where: { id: created.id },
          include: { sheets: { orderBy: { sheetName: 'asc' } } },
        });
        return { file: serializeWorkbookFile(withSheets), versionNumber: 1 };
      }

      await tx.fileVersion.create({
        data: {
          id: createId(),
          fileId: latestFile!.id,
          versionNumber,
          contentSha256,
          sizeBytes: buffer.byteLength,
          note: input.note?.trim() || 'Promoted from draft',
          createdById: input.user.id,
          uploadedObjectId: stored.uploadedObjectId,
        },
      });
      await tx.workbookSheet.deleteMany({ where: { fileId: latestFile!.id } });
      for (const sheet of workbook.sheets) {
        await tx.workbookSheet.create({
          data: {
            id: createId(),
            displayCode: await this.identifiers.nextSheetCode(tx, latestFile!.displayCode),
            fileId: latestFile!.id,
            sheetName: sheet.name,
            status: sheet.status,
            rowCount: sheet.rowCount,
            isSelected: sheet.isSelected,
            headerRowIx: sheet.headerRowIndex,
            rows: (workbook.rawData[sheet.name] ?? []) as any,
            originalHeaders: (sheet.originalHeaders ?? undefined) as any,
            normalizedHeaders: (sheet.normalizedHeaders ?? undefined) as any,
          } as any,
        });
      }
      await tx.workbookFile.update({
        where: { id: latestFile!.id },
        data: {
          name: workbook.name,
          sizeBytes: buffer.byteLength,
          contentSha256,
          parsedSheets: workbook.sheets as any,
          state: 'completed',
          currentVersion: versionNumber,
          rowVersion: { increment: 1 },
          uploadedObjectId: stored.uploadedObjectId,
          storageKind: 's3',
        } as any,
      });
      if (draft.uploadedObjectId) {
        this.workbookStorage
          .deleteByUploadedObjectId(draft.uploadedObjectId)
          .catch(() => undefined);
      }
      await tx.fileDraft.delete({ where: { id: draft.id } });
      const withSheets = await tx.workbookFile.findUniqueOrThrow({
        where: { id: latestFile!.id },
        include: { sheets: { orderBy: { sheetName: 'asc' } } },
      });
      return { file: serializeWorkbookFile(withSheets), versionNumber };
    });
  }

  /** Public helper for callers (file-drafts.service) that already loaded a row. */
  async getDraftContent(draft: {
    content?: Buffer | null;
    uploadedObjectId?: string | null;
  }): Promise<Buffer | null> {
    return this.fetchDraftContent(draft);
  }

  private async fetchDraftContent(draft: {
    content?: Buffer | null;
    uploadedObjectId?: string | null;
  }): Promise<Buffer | null> {
    if (draft.uploadedObjectId) {
      try {
        return await this.workbookStorage.getBuffer(draft.uploadedObjectId);
      } catch {
        // fall back to BYTEA
      }
    }
    return (draft.content as Buffer | null | undefined) ?? null;
  }

  private serializeDraft(draft: {
    id: string;
    userId: string;
    processId: string;
    functionId: string;
    fileName: string;
    sizeBytes: number;
    updatedAt: Date;
    createdAt: Date;
  }) {
    return {
      id: draft.id,
      userId: draft.userId,
      processId: draft.processId,
      functionId: draft.functionId,
      fileName: draft.fileName,
      sizeBytes: draft.sizeBytes,
      updatedAt: draft.updatedAt.toISOString(),
      createdAt: draft.createdAt.toISOString(),
    };
  }
}
