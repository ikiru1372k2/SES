import { Injectable } from '@nestjs/common';
import { PgService } from '../db/pg.service';
import type { UploadedObjectRow, UploadedObjectStatus } from '../db/types';

export interface CreatePendingInput {
  id: string;
  tenantId: string | null;
  ownerId: string | null;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageProvider: string;
  storageEndpoint: string | null;
}

interface DbUploadedObjectRow {
  id: string;
  tenantId: string | null;
  ownerId: string | null;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: string | number;
  checksumSha256: string;
  storageProvider: string;
  storageEndpoint: string | null;
  status: UploadedObjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UploadedObjectsRepository {
  constructor(private readonly pg: PgService) {}

  async createPending(input: CreatePendingInput): Promise<UploadedObjectRow> {
    const rows = await this.pg.query<DbUploadedObjectRow>(
      `INSERT INTO "uploaded_object"
        ("id","tenantId","ownerId","bucket","objectKey","originalFileName","contentType",
         "sizeBytes","checksumSha256","storageProvider","storageEndpoint","status")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.ownerId,
        input.bucket,
        input.objectKey,
        input.originalFileName,
        input.contentType,
        input.sizeBytes,
        input.checksumSha256,
        input.storageProvider,
        input.storageEndpoint,
      ],
    );
    return toRow(rows[0]!);
  }

  async markUploaded(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE "uploaded_object" SET "status" = 'uploaded' WHERE "id" = $1 AND "status" = 'pending'`,
      [id],
    );
  }

  async markFailed(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE "uploaded_object" SET "status" = 'failed' WHERE "id" = $1 AND "status" = 'pending'`,
      [id],
    );
  }

  async markDeleted(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE "uploaded_object" SET "status" = 'deleted' WHERE "id" = $1`,
      [id],
    );
  }

  async findById(id: string): Promise<UploadedObjectRow | undefined> {
    const rows = await this.pg.query<DbUploadedObjectRow>(
      `SELECT * FROM "uploaded_object" WHERE "id" = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : undefined;
  }

  async findByChecksum(
    checksumSha256: string,
    tenantId: string | null,
  ): Promise<UploadedObjectRow | undefined> {
    const rows = tenantId
      ? await this.pg.query<DbUploadedObjectRow>(
          `SELECT * FROM "uploaded_object"
            WHERE "checksumSha256" = $1 AND "tenantId" = $2 AND "status" = 'uploaded'
            ORDER BY "createdAt" DESC LIMIT 1`,
          [checksumSha256, tenantId],
        )
      : await this.pg.query<DbUploadedObjectRow>(
          `SELECT * FROM "uploaded_object"
            WHERE "checksumSha256" = $1 AND "status" = 'uploaded'
            ORDER BY "createdAt" DESC LIMIT 1`,
          [checksumSha256],
        );
    return rows[0] ? toRow(rows[0]) : undefined;
  }
}

function toRow(r: DbUploadedObjectRow): UploadedObjectRow {
  return {
    ...r,
    sizeBytes: typeof r.sizeBytes === 'string' ? Number(r.sizeBytes) : r.sizeBytes,
  };
}
