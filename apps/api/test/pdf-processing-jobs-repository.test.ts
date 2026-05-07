import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { ulid } from 'ulid';
import { PgService } from '../src/db/pg.service';
import { UploadedObjectsRepository } from '../src/repositories/uploaded-objects.repository';
import { PdfProcessingJobsRepository } from '../src/repositories/pdf-processing-jobs.repository';
import { runMigrations } from '../db/runner';

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedUploadedObject(repo: UploadedObjectsRepository): Promise<string> {
  const id = ulid();
  const objectKey = `pdf-test/${id}.pdf`;
  await repo.createPending({
    id,
    tenantId: 'tnt-1',
    ownerId: 'usr-1',
    bucket: 'ses-ai-files',
    objectKey,
    originalFileName: 'doc.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64),
    storageProvider: 's3',
    storageEndpoint: null,
  });
  await repo.markUploaded(id);
  return id;
}

describe('PdfProcessingJobsRepository', { skip: !hasDb }, () => {
  let pg: PgService;
  let objects: UploadedObjectsRepository;
  let jobs: PdfProcessingJobsRepository;

  before(async () => {
    await runMigrations({ dryRun: false, baseline: false });
    pg = new PgService();
    await pg.onModuleInit();
    objects = new UploadedObjectsRepository(pg);
    jobs = new PdfProcessingJobsRepository(pg);
  });
  after(async () => {
    await pg.onModuleDestroy();
  });

  it('createOrGet inserts a queued row on first call', async () => {
    const objectId = await seedUploadedObject(objects);
    const idem = `idem-${ulid()}`;
    const r = await jobs.createOrGet({
      id: ulid(),
      tenantId: 'tnt-1',
      requestedById: 'usr-1',
      idempotencyKey: idem,
      kind: 'extract',
      uploadedObjectId: objectId,
      options: { pages: '1-10' },
    });
    assert.equal(r.deduplicated, false);
    assert.equal(r.row.status, 'queued');
    assert.equal(r.row.kind, 'extract');
    assert.equal(r.row.attempt, 0);
  });

  it('createOrGet returns the existing row on duplicate idempotencyKey', async () => {
    const objectId = await seedUploadedObject(objects);
    const idem = `idem-${ulid()}`;
    const a = await jobs.createOrGet({
      id: ulid(),
      tenantId: 'tnt-1',
      requestedById: 'usr-1',
      idempotencyKey: idem,
      kind: 'summarize',
      uploadedObjectId: objectId,
      options: {},
    });
    const b = await jobs.createOrGet({
      id: ulid(),
      tenantId: 'tnt-1',
      requestedById: 'usr-1',
      idempotencyKey: idem,
      kind: 'summarize',
      uploadedObjectId: objectId,
      options: {},
    });
    assert.equal(a.deduplicated, false);
    assert.equal(b.deduplicated, true);
    assert.equal(a.row.id, b.row.id);
  });

  it('state transitions: queued → running → succeeded', async () => {
    const objectId = await seedUploadedObject(objects);
    const r = await jobs.createOrGet({
      id: ulid(),
      tenantId: null,
      requestedById: null,
      idempotencyKey: `idem-${ulid()}`,
      kind: 'extract',
      uploadedObjectId: objectId,
      options: {},
    });
    await jobs.markRunning(r.row.id);
    let after = await jobs.findById(r.row.id);
    assert.equal(after?.status, 'running');
    assert.equal(after?.attempt, 1);

    await jobs.markSucceeded(r.row.id, { pages: 4, text: 'hello' });
    after = await jobs.findById(r.row.id);
    assert.equal(after?.status, 'succeeded');
    assert.deepEqual(after?.result, { pages: 4, text: 'hello' });
    assert.ok(after?.finishedAt);
  });

  it('markSucceeded does not regress a cancelled row', async () => {
    const objectId = await seedUploadedObject(objects);
    const r = await jobs.createOrGet({
      id: ulid(),
      tenantId: null,
      requestedById: null,
      idempotencyKey: `idem-${ulid()}`,
      kind: 'extract',
      uploadedObjectId: objectId,
      options: {},
    });
    await jobs.markCancelled(r.row.id);
    await jobs.markSucceeded(r.row.id, { ok: true });
    const after = await jobs.findById(r.row.id);
    assert.equal(after?.status, 'cancelled', 'cancelled is terminal — succeeded must not overwrite');
  });

  it('markFailed truncates error message to 1024 chars', async () => {
    const objectId = await seedUploadedObject(objects);
    const r = await jobs.createOrGet({
      id: ulid(),
      tenantId: null,
      requestedById: null,
      idempotencyKey: `idem-${ulid()}`,
      kind: 'extract',
      uploadedObjectId: objectId,
      options: {},
    });
    await jobs.markFailed(r.row.id, 'TIMEOUT', 'x'.repeat(5000));
    const after = await jobs.findById(r.row.id);
    assert.equal(after?.status, 'failed');
    assert.equal(after?.errorCode, 'TIMEOUT');
    assert.equal(after?.errorMessage?.length, 1024);
  });

  it('isTerminal classifies states correctly', () => {
    assert.equal(PdfProcessingJobsRepository.isTerminal('queued'), false);
    assert.equal(PdfProcessingJobsRepository.isTerminal('running'), false);
    assert.equal(PdfProcessingJobsRepository.isTerminal('succeeded'), true);
    assert.equal(PdfProcessingJobsRepository.isTerminal('failed'), true);
    assert.equal(PdfProcessingJobsRepository.isTerminal('cancelled'), true);
  });
});
