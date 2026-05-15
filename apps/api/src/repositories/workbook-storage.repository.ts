import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
// Import directly (not via the barrel `../object-storage`) so we don't
// pull in `object-storage.module.ts`, which provides this very class
// — that creates a circular import that breaks Nest DI on boot.
import { ObjectStorageService, sha256Hex } from '../modules/object-storage/object-storage.service';
import {
  workbookObjectKey,
  workbookDraftObjectKey,
} from '../modules/object-storage/object-key';
import { UploadedObjectsRepository } from './uploaded-objects.repository';

export interface UploadWorkbookInput {
  tenantId: string | null;
  ownerId: string | null;
  processCode: string;
  fileCode: string;
  versionNumber: number;
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

export interface UploadDraftInput {
  tenantId: string | null;
  ownerId: string | null;
  processCode: string;
  userId: string;
  functionId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

export interface StoredObject {
  uploadedObjectId: string;
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Workbook-specific S3 helper: routes writes to the `workbooks` bucket
 * (env-configurable as OBJECT_STORAGE_BUCKET_WORKBOOKS), records a
 * metadata row in `uploaded_object`, and returns the metadata id +
 * object reference for callers to attach to their domain rows.
 *
 * Failure semantics: the metadata row is created `pending` first, the
 * upload runs, and on success the row is marked `uploaded`. On failure
 * the row is marked `failed` so we never end up with an "applied"
 * pointer that has no object behind it.
 */
@Injectable()
export class WorkbookStorageRepository {
  constructor(
    private readonly storage: ObjectStorageService,
    private readonly uploadedObjects: UploadedObjectsRepository,
  ) {}

  async putWorkbook(input: UploadWorkbookInput): Promise<StoredObject> {
    const objectKey = workbookObjectKey({
      tenantId: input.tenantId ?? 'default',
      processCode: input.processCode,
      fileCode: input.fileCode,
      versionNumber: input.versionNumber,
      fileName: input.fileName,
    });
    return this.putAndRecord({
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      objectKey,
      buffer: input.buffer,
      fileName: input.fileName,
      contentType: input.contentType,
      bucket: 'workbooks',
    });
  }

  async putDraft(input: UploadDraftInput): Promise<StoredObject> {
    const objectKey = workbookDraftObjectKey({
      tenantId: input.tenantId ?? 'default',
      processCode: input.processCode,
      userId: input.userId,
      functionId: input.functionId,
      fileName: input.fileName,
    });
    return this.putAndRecord({
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      objectKey,
      buffer: input.buffer,
      fileName: input.fileName,
      contentType: input.contentType,
      bucket: 'workbooks',
    });
  }

  /** Stream an object back. Caller passes the metadata id; we look up bucket+key. */
  async getStream(uploadedObjectId: string) {
    const meta = await this.uploadedObjects.findById(uploadedObjectId);
    if (!meta) throw new Error(`uploaded_object ${uploadedObjectId} not found`);
    return this.storage.getObjectStream(meta.objectKey, { bucketName: meta.bucket });
  }

  async getBuffer(uploadedObjectId: string): Promise<Buffer> {
    const meta = await this.uploadedObjects.findById(uploadedObjectId);
    if (!meta) throw new Error(`uploaded_object ${uploadedObjectId} not found`);
    return this.storage.getObjectBuffer(meta.objectKey, { bucketName: meta.bucket });
  }

  async deleteByUploadedObjectId(uploadedObjectId: string): Promise<void> {
    const meta = await this.uploadedObjects.findById(uploadedObjectId);
    if (!meta) return;
    await this.storage.deleteObject(meta.objectKey, { bucketName: meta.bucket });
    await this.uploadedObjects.markDeleted(uploadedObjectId);
  }

  // ---- internal --------------------------------------------------------------

  private async putAndRecord(args: {
    tenantId: string | null;
    ownerId: string | null;
    objectKey: string;
    buffer: Buffer;
    fileName: string;
    contentType: string;
    bucket: 'workbooks';
  }): Promise<StoredObject> {
    const checksum = sha256Hex(args.buffer);
    const sizeBytes = args.buffer.length;
    const bucketName = this.storage.bucketFor(args.bucket);
    const id = ulid();

    await this.uploadedObjects.createPending({
      id,
      tenantId: args.tenantId,
      ownerId: args.ownerId,
      bucket: bucketName,
      objectKey: args.objectKey,
      originalFileName: args.fileName,
      contentType: args.contentType,
      sizeBytes,
      checksumSha256: checksum,
      storageProvider: this.storage.storageProvider,
      storageEndpoint: this.storage.storageEndpoint,
    });

    try {
      await this.storage.putObject({
        objectKey: args.objectKey,
        body: args.buffer,
        contentType: args.contentType,
        contentLength: sizeBytes,
        checksumSha256: checksum,
        bucket: args.bucket,
      });
      await this.uploadedObjects.markUploaded(id);
    } catch (err) {
      await this.uploadedObjects.markFailed(id).catch(() => {});
      throw err;
    }

    return {
      uploadedObjectId: id,
      bucket: bucketName,
      objectKey: args.objectKey,
      sizeBytes,
      checksumSha256: checksum,
    };
  }
}
