import { Injectable } from '@nestjs/common';
import { PgService } from '../db/pg.service';
import type { PdfJobKind, PdfJobStatus, PdfProcessingJobRow } from '../db/types';

export interface CreatePdfJobInput {
  id: string;
  tenantId: string | null;
  requestedById: string | null;
  idempotencyKey: string;
  kind: PdfJobKind;
  uploadedObjectId: string;
  options: Record<string, unknown>;
}

interface DbRow {
  id: string;
  tenantId: string | null;
  requestedById: string | null;
  idempotencyKey: string;
  kind: PdfJobKind;
  status: PdfJobStatus;
  uploadedObjectId: string;
  attempt: number;
  options: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TERMINAL: ReadonlySet<PdfJobStatus> = new Set(['succeeded', 'failed', 'cancelled']);

@Injectable()
export class PdfProcessingJobsRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Idempotent create: if a row with the same idempotencyKey exists,
   * return it untouched. Otherwise insert a fresh `queued` row.
   * Single SQL statement — no read-modify-write race.
   */
  async createOrGet(
    input: CreatePdfJobInput,
  ): Promise<{ row: PdfProcessingJobRow; deduplicated: boolean }> {
    const rows = await this.pg.query<DbRow & { __new: boolean }>(
      `WITH inserted AS (
         INSERT INTO "pdf_processing_job"
           ("id","tenantId","requestedById","idempotencyKey","kind","status","uploadedObjectId","options")
         VALUES ($1,$2,$3,$4,$5,'queued',$6,$7::jsonb)
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING *, true AS __new
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT *, false AS __new FROM "pdf_processing_job"
         WHERE "idempotencyKey" = $4 AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        input.id,
        input.tenantId,
        input.requestedById,
        input.idempotencyKey,
        input.kind,
        input.uploadedObjectId,
        JSON.stringify(input.options ?? {}),
      ],
    );
    const r = rows[0];
    if (!r) throw new Error('createOrGet: no row returned');
    return { row: toRow(r), deduplicated: !r.__new };
  }

  async findById(id: string): Promise<PdfProcessingJobRow | undefined> {
    const rows = await this.pg.query<DbRow>(
      `SELECT * FROM "pdf_processing_job" WHERE "id" = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : undefined;
  }

  /**
   * Promote queued → running. No-op if the row is already running or
   * past terminal — caller treats both as "someone else owns it now".
   */
  async markRunning(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE "pdf_processing_job"
         SET "status" = 'running',
             "attempt" = "attempt" + 1,
             "startedAt" = COALESCE("startedAt", now())
         WHERE "id" = $1 AND "status" = 'queued'`,
      [id],
    );
  }

  async markSucceeded(id: string, result: unknown): Promise<void> {
    await this.pg.query(
      `UPDATE "pdf_processing_job"
         SET "status" = 'succeeded',
             "result" = $2::jsonb,
             "finishedAt" = now(),
             "errorCode" = NULL,
             "errorMessage" = NULL
         WHERE "id" = $1 AND "status" NOT IN ('succeeded','cancelled')`,
      [id, JSON.stringify(result ?? null)],
    );
  }

  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> {
    // errorMessage is bounded to keep the row compact; never includes raw PDF content.
    const trimmedMessage = errorMessage.length > 1024 ? errorMessage.slice(0, 1024) : errorMessage;
    await this.pg.query(
      `UPDATE "pdf_processing_job"
         SET "status" = 'failed',
             "errorCode" = $2,
             "errorMessage" = $3,
             "finishedAt" = now()
         WHERE "id" = $1 AND "status" NOT IN ('succeeded','cancelled')`,
      [id, errorCode, trimmedMessage],
    );
  }

  async markCancelled(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE "pdf_processing_job"
         SET "status" = 'cancelled',
             "finishedAt" = now()
         WHERE "id" = $1 AND "status" NOT IN ('succeeded','cancelled')`,
      [id],
    );
  }

  static isTerminal(status: PdfJobStatus): boolean {
    return TERMINAL.has(status);
  }
}

function toRow(r: DbRow): PdfProcessingJobRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    requestedById: r.requestedById,
    idempotencyKey: r.idempotencyKey,
    kind: r.kind,
    status: r.status,
    uploadedObjectId: r.uploadedObjectId,
    attempt: r.attempt,
    options: r.options,
    result: r.result,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
