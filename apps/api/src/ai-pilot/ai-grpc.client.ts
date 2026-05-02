import { resolve } from 'node:path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = resolve(__dirname, '..', '..', 'proto', 'ai_pilot', 'v1', 'ai_pilot.proto');

const TRANSIENT_GRPC_CODES = new Set<grpc.status>([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.ABORTED,
  grpc.status.INTERNAL,
]);

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

interface GrpcClient {
  Health(req: object, deadline: grpc.CallOptions, cb: GrpcCallback<HealthResponse>): void;
  StartJob(req: StartJobReq, deadline: grpc.CallOptions, cb: GrpcCallback<StartJobRes>): void;
  GetJob(req: { jobId: string }, deadline: grpc.CallOptions, cb: GrpcCallback<PdfJobMessage>): void;
  StreamProgress(req: { jobId: string; fromSequence?: number }, deadline: grpc.CallOptions): grpc.ClientReadableStream<PdfJobEvent>;
  close: () => void;
}

type GrpcCallback<T> = (err: grpc.ServiceError | null, value?: T) => void;

interface HealthResponse {
  ok: boolean;
  version: string;
}
interface StartJobReq {
  idempotencyKey: string;
  tenantId: string;
  requestedById: string;
  kind: number;
  object: ObjectRefMessage;
  prompt: string;
  optionsJson: string;
}
interface StartJobRes {
  jobId: string;
  status: number;
  deduplicated: boolean;
}
interface ObjectRefMessage {
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  presignedUrl: string;
}
interface PdfJobMessage {
  jobId: string;
  tenantId: string;
  requestedById: string;
  kind: number;
  status: number;
  object: ObjectRefMessage | null;
  resultJson: string;
  errorCode: string;
  errorMessage: string;
  attempt: number;
  startedAtMs: number | string;
  finishedAtMs: number | string;
  createdAtMs: number | string;
  updatedAtMs: number | string;
}
interface PdfJobEvent {
  sequence: number | string;
  progress?: { percent: number; stage: string };
  terminal?: PdfJobMessage;
}

export const PDF_JOB_KIND = {
  EXTRACT: 1,
  SUMMARIZE: 2,
} as const;

export const PDF_JOB_STATUS = {
  QUEUED: 1,
  RUNNING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  CANCELLED: 5,
} as const;

export type PdfJobKindWire = (typeof PDF_JOB_KIND)[keyof typeof PDF_JOB_KIND];
export type PdfJobStatusWire = (typeof PDF_JOB_STATUS)[keyof typeof PDF_JOB_STATUS];

export interface AiGrpcStartJobInput {
  idempotencyKey: string;
  tenantId: string;
  requestedById: string;
  kind: 'extract' | 'summarize';
  object: {
    bucket: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
    presignedUrl?: string;
  };
  prompt?: string;
  options?: Record<string, unknown>;
}

export interface AiGrpcJob {
  jobId: string;
  tenantId: string;
  requestedById: string;
  kind: 'extract' | 'summarize';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
}

@Injectable()
export class AiGrpcClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiGrpcClient.name);
  private aiPilot: GrpcClient | undefined;
  private pdfProcessing: GrpcClient | undefined;
  private readonly target: string;
  private readonly timeoutMs: number;

  constructor() {
    this.target = (process.env.AI_SERVICE_GRPC_URL ?? 'localhost:50051').replace(/^grpc:\/\//, '');
    this.timeoutMs = Number(process.env.AI_PILOT_REQUEST_TIMEOUT_MS ?? 60000);
  }

  onModuleInit(): void {
    const def = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: Number,
      enums: Number,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as unknown as {
      ses: {
        ai_pilot: {
          v1: {
            AiPilot: new (target: string, creds: grpc.ChannelCredentials) => GrpcClient;
            PdfProcessing: new (target: string, creds: grpc.ChannelCredentials) => GrpcClient;
          };
        };
      };
    };
    const creds = grpc.credentials.createInsecure();
    this.aiPilot = new pkg.ses.ai_pilot.v1.AiPilot(this.target, creds);
    this.pdfProcessing = new pkg.ses.ai_pilot.v1.PdfProcessing(this.target, creds);
    this.logger.log(`gRPC client connected to ${this.target}`);
  }

  onModuleDestroy(): void {
    this.aiPilot?.close();
    this.pdfProcessing?.close();
  }

  async health(): Promise<HealthResponse> {
    return this.unary<HealthResponse>('aiPilot.Health', (cb) =>
      this.aiPilot!.Health({}, { deadline: this.deadline() }, cb),
    );
  }

  async startPdfJob(input: AiGrpcStartJobInput): Promise<{ job: AiGrpcJob; deduplicated: boolean }> {
    const wire: StartJobReq = {
      idempotencyKey: input.idempotencyKey,
      tenantId: input.tenantId,
      requestedById: input.requestedById,
      kind: input.kind === 'extract' ? PDF_JOB_KIND.EXTRACT : PDF_JOB_KIND.SUMMARIZE,
      object: {
        bucket: input.object.bucket,
        objectKey: input.object.objectKey,
        contentType: input.object.contentType,
        sizeBytes: input.object.sizeBytes,
        checksumSha256: input.object.checksumSha256,
        presignedUrl: input.object.presignedUrl ?? '',
      },
      prompt: input.prompt ?? '',
      optionsJson: JSON.stringify(input.options ?? {}),
    };
    const res = await this.unary<StartJobRes>('pdfProcessing.StartJob', (cb) =>
      this.pdfProcessing!.StartJob(wire, { deadline: this.deadline() }, cb),
    );
    const job = await this.getPdfJob(res.jobId);
    return { job, deduplicated: res.deduplicated };
  }

  async getPdfJob(jobId: string): Promise<AiGrpcJob> {
    const r = await this.unary<PdfJobMessage>('pdfProcessing.GetJob', (cb) =>
      this.pdfProcessing!.GetJob({ jobId }, { deadline: this.deadline() }, cb),
    );
    return decodeJob(r);
  }

  /**
   * Server-streaming reader. Invokes onProgress for each Progress event,
   * resolves with the terminal job. Caller-side timeout = 2× per-call
   * deadline (streams legitimately run longer than unary RPCs).
   */
  async streamProgress(
    jobId: string,
    fromSequence: number,
    onProgress: (percent: number, stage: string, sequence: number) => void,
  ): Promise<AiGrpcJob> {
    return new Promise<AiGrpcJob>((resolveFn, rejectFn) => {
      const stream = this.pdfProcessing!.StreamProgress(
        { jobId, fromSequence },
        { deadline: this.deadline(this.timeoutMs * 2) },
      );
      let terminal: AiGrpcJob | undefined;
      stream.on('data', (evt: PdfJobEvent) => {
        if (evt.terminal) {
          terminal = decodeJob(evt.terminal);
        } else if (evt.progress) {
          onProgress(evt.progress.percent, evt.progress.stage, Number(evt.sequence));
        }
      });
      stream.on('end', () => {
        if (terminal) resolveFn(terminal);
        else rejectFn(new Error('stream ended without terminal event'));
      });
      stream.on('error', (err: grpc.ServiceError) => {
        rejectFn(this.toException(err, 'pdfProcessing.StreamProgress'));
      });
    });
  }

  /**
   * Unary call wrapper: deadline + bounded retry on transient gRPC codes
   * with exponential backoff. Never logs request/response bodies.
   */
  private async unary<T>(
    op: string,
    invoke: (cb: GrpcCallback<T>) => void,
  ): Promise<T> {
    let attempt = 0;
    let lastErr: grpc.ServiceError | undefined;
    while (attempt < MAX_RETRIES) {
      try {
        return await new Promise<T>((resolveFn, rejectFn) => {
          invoke((err, val) => {
            if (err) rejectFn(err);
            else resolveFn(val as T);
          });
        });
      } catch (err) {
        const svcErr = err as grpc.ServiceError;
        lastErr = svcErr;
        if (!isTransient(svcErr) || attempt === MAX_RETRIES - 1) {
          throw this.toException(svcErr, op);
        }
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        this.logger.warn(`${op} transient (${grpc.status[svcErr.code]}) attempt ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(backoff);
        attempt += 1;
      }
    }
    throw this.toException(lastErr ?? new Error(`${op} exhausted`), op);
  }

  private toException(err: grpc.ServiceError | Error, op: string): Error {
    const code = (err as grpc.ServiceError).code;
    if (code === grpc.status.UNAVAILABLE || code === grpc.status.DEADLINE_EXCEEDED) {
      return new ServiceUnavailableException(`AI service unavailable (${op})`);
    }
    return err;
  }

  private deadline(ms?: number): Date {
    return new Date(Date.now() + (ms ?? this.timeoutMs));
  }
}

function isTransient(err: { code?: grpc.status }): boolean {
  return err.code !== undefined && TRANSIENT_GRPC_CODES.has(err.code);
}

function decodeJob(m: PdfJobMessage): AiGrpcJob {
  let result: unknown = null;
  if (m.resultJson) {
    try {
      result = JSON.parse(m.resultJson);
    } catch {
      result = m.resultJson;
    }
  }
  return {
    jobId: m.jobId,
    tenantId: m.tenantId,
    requestedById: m.requestedById,
    kind: m.kind === PDF_JOB_KIND.EXTRACT ? 'extract' : 'summarize',
    status:
      m.status === PDF_JOB_STATUS.QUEUED
        ? 'queued'
        : m.status === PDF_JOB_STATUS.RUNNING
          ? 'running'
          : m.status === PDF_JOB_STATUS.SUCCEEDED
            ? 'succeeded'
            : m.status === PDF_JOB_STATUS.CANCELLED
              ? 'cancelled'
              : 'failed',
    result,
    errorCode: m.errorCode || null,
    errorMessage: m.errorMessage || null,
    attempt: m.attempt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
