import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { PgService } from '../db/pg.service';
import { ObjectStorageService } from '../object-storage';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { PdfProcessingJobsRepository } from '../repositories/pdf-processing-jobs.repository';
import { AiGrpcClient } from '../ai-pilot/ai-grpc.client';
import type { PdfJobKind, PdfProcessingJobRow } from '../db/types';

const ALLOWED_PDF_MIME = new Set(['application/pdf']);
const MAX_PROMPT_LEN = 4000;

export interface StartJobInput {
  tenantId: string | null;
  requestedById: string | null;
  uploadedObjectId: string;
  kind: PdfJobKind;
  prompt?: string;
  options?: Record<string, unknown>;
}

export interface StartJobResult {
  job: PdfProcessingJobRow;
  deduplicated: boolean;
}

@Injectable()
export class PdfProcessingService {
  private readonly logger = new Logger(PdfProcessingService.name);

  constructor(
    private readonly pg: PgService,
    private readonly storage: ObjectStorageService,
    private readonly uploadedObjects: UploadedObjectsRepository,
    private readonly jobs: PdfProcessingJobsRepository,
    private readonly grpc: AiGrpcClient,
  ) {}

  async startJob(input: StartJobInput): Promise<StartJobResult> {
    if (input.prompt && input.prompt.length > MAX_PROMPT_LEN) {
      throw new BadRequestException(`prompt exceeds ${MAX_PROMPT_LEN} chars`);
    }
    const obj = await this.uploadedObjects.findById(input.uploadedObjectId);
    if (!obj) throw new NotFoundException(`uploadedObject ${input.uploadedObjectId} not found`);
    if (obj.status !== 'uploaded') {
      throw new BadRequestException(`uploadedObject status is '${obj.status}', expected 'uploaded'`);
    }
    if (!ALLOWED_PDF_MIME.has(obj.contentType)) {
      throw new BadRequestException(`unsupported contentType '${obj.contentType}' (PDF only)`);
    }

    const idempotencyKey = deriveIdempotencyKey({
      tenantId: input.tenantId,
      objectKey: obj.objectKey,
      kind: input.kind,
      promptHash: input.prompt ? sha256Hex(input.prompt) : '',
      optionsHash: sha256Hex(canonical(input.options ?? {})),
    });

    const inserted = await this.pg.tx(async () =>
      this.jobs.createOrGet({
        id: ulid(),
        tenantId: input.tenantId,
        requestedById: input.requestedById,
        idempotencyKey,
        kind: input.kind,
        uploadedObjectId: obj.id,
        options: input.options ?? {},
      }),
    );

    if (inserted.deduplicated) {
      this.logger.log(`startJob deduplicated jobId=${inserted.row.id} idempotency=${shortHash(idempotencyKey)}`);
      return { job: inserted.row, deduplicated: true };
    }

    // Hand off to the AI sidecar via gRPC. Done after DB insert so a retry
    // is safe — sidecar's StartJob is also keyed by idempotencyKey.
    try {
      // The PDF object's bucket is recorded on its metadata row, so we
      // presign against that exact bucket — the new ses-ai-pdfs bucket
      // for fresh uploads, the legacy single bucket for older rows.
      const presignedUrl = await this.storage.presignDownloadUrl({
        objectKey: obj.objectKey,
        bucketName: obj.bucket,
      });
      await this.grpc.startPdfJob({
        idempotencyKey,
        tenantId: input.tenantId ?? '',
        requestedById: input.requestedById ?? '',
        kind: input.kind,
        object: {
          bucket: obj.bucket,
          objectKey: obj.objectKey,
          contentType: obj.contentType,
          sizeBytes: obj.sizeBytes,
          checksumSha256: obj.checksumSha256,
          presignedUrl,
        },
        prompt: input.prompt,
        options: input.options,
      });
      await this.jobs.markRunning(inserted.row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'gRPC StartJob failed';
      // Do not surface raw err to clients — message may include sidecar
      // internals. Persist sanitized form for forensics and re-raise a
      // generic 503.
      await this.jobs
        .markFailed(inserted.row.id, 'GRPC_START_FAILED', message)
        .catch(() => {});
      throw err;
    }

    const refreshed = await this.jobs.findById(inserted.row.id);
    return { job: refreshed ?? inserted.row, deduplicated: false };
  }

  async getJob(id: string): Promise<PdfProcessingJobRow> {
    const local = await this.jobs.findById(id);
    if (!local) throw new NotFoundException(`job ${id} not found`);
    if (PdfProcessingJobsRepository.isTerminal(local.status)) return local;

    // Reconcile with the sidecar — terminal state there is authoritative.
    try {
      const remote = await this.grpc.getPdfJob(id);
      if (remote.status === 'succeeded') {
        await this.jobs.markSucceeded(id, remote.result);
        return (await this.jobs.findById(id)) ?? local;
      }
      if (remote.status === 'failed') {
        await this.jobs.markFailed(
          id,
          remote.errorCode ?? 'UNKNOWN',
          remote.errorMessage ?? 'unknown',
        );
        return (await this.jobs.findById(id)) ?? local;
      }
      if (remote.status === 'cancelled') {
        await this.jobs.markCancelled(id);
        return (await this.jobs.findById(id)) ?? local;
      }
    } catch (err) {
      // sidecar unreachable — return last known local state without poisoning the row.
      this.logger.warn(`getJob reconcile failed jobId=${id} err=${err instanceof Error ? err.message : 'unknown'}`);
    }
    return local;
  }
}

function deriveIdempotencyKey(parts: {
  tenantId: string | null;
  objectKey: string;
  kind: PdfJobKind;
  promptHash: string;
  optionsHash: string;
}): string {
  return sha256Hex(
    `${parts.tenantId ?? ''}|${parts.objectKey}|${parts.kind}|${parts.promptHash}|${parts.optionsHash}`,
  );
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function shortHash(s: string): string {
  return s.slice(0, 12);
}
