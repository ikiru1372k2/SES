import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { AiGrpcClient, PDF_JOB_KIND, PDF_JOB_STATUS } from '../src/ai-pilot/ai-grpc.client';

const PROTO_PATH = resolve(__dirname, '..', 'proto', 'ai_pilot', 'v1', 'ai_pilot.proto');

interface ServerHooks {
  startJob: (req: { idempotencyKey: string; kind: number }, attempt: number) => { jobId: string; status: number; deduplicated: boolean } | { code: grpc.status; message: string };
  getJob?: (jobId: string) => unknown;
}

async function startStubServer(hooks: ServerHooks): Promise<{ port: number; server: grpc.Server; attempts: { startJob: number } }> {
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as Record<string, any>;
  const services = pkg.ses.ai_pilot.v1;
  const server = new grpc.Server();
  const attempts = { startJob: 0 };

  server.addService(services.AiPilot.service, {
    Health: (_call: unknown, cb: (err: null, res: { ok: boolean; version: string }) => void) =>
      cb(null, { ok: true, version: 'stub-1' }),
    UploadSample: () => undefined,
    RegisterObject: () => undefined,
    GenerateRule: () => undefined,
    EnhancePrompt: () => undefined,
  });

  server.addService(services.PdfProcessing.service, {
    StartJob: (call: grpc.ServerUnaryCall<any, any>, cb: any) => {
      attempts.startJob += 1;
      const r = hooks.startJob(call.request, attempts.startJob);
      if ('jobId' in r) {
        cb(null, r);
      } else {
        cb(Object.assign(new Error(r.message), { code: r.code, details: r.message }));
      }
    },
    GetJob: (call: grpc.ServerUnaryCall<{ jobId: string }, any>, cb: any) => {
      const out = hooks.getJob?.(call.request.jobId) ?? {
        jobId: call.request.jobId,
        tenantId: '',
        requestedById: '',
        kind: PDF_JOB_KIND.EXTRACT,
        status: PDF_JOB_STATUS.QUEUED,
        object: null,
        resultJson: '',
        errorCode: '',
        errorMessage: '',
        attempt: 0,
        startedAtMs: 0,
        finishedAtMs: 0,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      cb(null, out);
    },
    StreamProgress: (call: grpc.ServerWritableStream<{ jobId: string }, any>) => {
      call.end();
    },
  });

  const port = await new Promise<number>((resolveFn, rejectFn) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) rejectFn(err);
      else resolveFn(p);
    });
  });
  return { port, server, attempts };
}

describe('AiGrpcClient', () => {
  let stub: { port: number; server: grpc.Server; attempts: { startJob: number } };
  let client: AiGrpcClient;

  before(async () => {
    stub = await startStubServer({
      startJob: (_req, attempt) => {
        if (attempt < 2) {
          return { code: grpc.status.UNAVAILABLE, message: 'flaky' };
        }
        return { jobId: 'job-1', status: PDF_JOB_STATUS.QUEUED, deduplicated: false };
      },
      getJob: (jobId) => ({
        jobId,
        tenantId: 't',
        requestedById: 'u',
        kind: PDF_JOB_KIND.EXTRACT,
        status: PDF_JOB_STATUS.SUCCEEDED,
        object: null,
        resultJson: '{"pages":3}',
        errorCode: '',
        errorMessage: '',
        attempt: 1,
        startedAtMs: 1,
        finishedAtMs: 2,
        createdAtMs: 0,
        updatedAtMs: 2,
      }),
    });
    process.env.AI_SERVICE_GRPC_URL = `127.0.0.1:${stub.port}`;
    process.env.AI_PILOT_REQUEST_TIMEOUT_MS = '5000';
    client = new AiGrpcClient();
    client.onModuleInit();
  });

  after(() => {
    client.onModuleDestroy();
    stub.server.forceShutdown();
  });

  it('Health succeeds', async () => {
    const r = await client.health();
    assert.equal(r.ok, true);
    assert.equal(r.version, 'stub-1');
  });

  it('startPdfJob retries on UNAVAILABLE then resolves', async () => {
    stub.attempts.startJob = 0;
    const r = await client.startPdfJob({
      idempotencyKey: 'k1',
      tenantId: 't',
      requestedById: 'u',
      kind: 'extract',
      object: {
        bucket: 'b',
        objectKey: 'k',
        contentType: 'application/pdf',
        sizeBytes: 1,
        checksumSha256: 'x',
      },
    });
    assert.equal(stub.attempts.startJob, 2, 'first attempt UNAVAILABLE → second succeeds');
    assert.equal(r.job.jobId, 'job-1');
    assert.equal(r.job.status, 'succeeded'); // GetJob returns SUCCEEDED in stub
    assert.deepEqual(r.job.result, { pages: 3 });
  });
});
