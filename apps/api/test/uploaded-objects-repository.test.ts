import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { ulid } from 'ulid';
import { PgService } from '../src/db/pg.service';
import { UploadedObjectsRepository } from '../src/repositories/uploaded-objects.repository';
import { runMigrations } from '../db/runner';

const hasDb = Boolean(process.env.DATABASE_URL);

describe('UploadedObjectsRepository', { skip: !hasDb }, () => {
  let pg: PgService;
  let repo: UploadedObjectsRepository;

  before(async () => {
    // Ensure migrations are applied — db-runner.test.ts may have wiped the schema
    // and is racing against us under parallel test execution.
    await runMigrations({ dryRun: false, baseline: false, confirmBaseline: false });
    pg = new PgService();
    await pg.onModuleInit();
    repo = new UploadedObjectsRepository(pg);
  });
  after(async () => {
    await pg.onModuleDestroy();
  });

  it('createPending → markUploaded transitions cleanly', async () => {
    const id = ulid();
    const objectKey = `ai-pilot/test/sess/${id}-x.bin`;
    const row = await repo.createPending({
      id,
      tenantId: 'ses-tenant-default',
      ownerId: null,
      bucket: 'ses-ai-files',
      objectKey,
      originalFileName: 'x.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 42,
      checksumSha256: 'a'.repeat(64),
      storageProvider: 's3',
      storageEndpoint: 'http://localhost:9000',
    });
    assert.equal(row.status, 'pending');
    assert.equal(row.bucket, 'ses-ai-files');

    await repo.markUploaded(id);
    const after = await repo.findById(id);
    assert.equal(after?.status, 'uploaded');
  });

  it('createPending → markFailed transitions and stops further markUploaded', async () => {
    const id = ulid();
    await repo.createPending({
      id,
      tenantId: null,
      ownerId: null,
      bucket: 'ses-ai-files',
      objectKey: `ai-pilot/test/fail/${id}-y.bin`,
      originalFileName: 'y.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 1,
      checksumSha256: 'b'.repeat(64),
      storageProvider: 's3',
      storageEndpoint: null,
    });
    await repo.markFailed(id);
    await repo.markUploaded(id);
    const row = await repo.findById(id);
    assert.equal(row?.status, 'failed', 'markUploaded must not promote a failed row');
  });

  it('rejects (bucket, objectKey) duplicates', async () => {
    const id1 = ulid();
    const id2 = ulid();
    const dup = `ai-pilot/test/dup/${id1}-z.bin`;
    await repo.createPending({
      id: id1, tenantId: null, ownerId: null,
      bucket: 'ses-ai-files', objectKey: dup,
      originalFileName: 'z.bin', contentType: 'application/octet-stream',
      sizeBytes: 1, checksumSha256: 'c'.repeat(64),
      storageProvider: 's3', storageEndpoint: null,
    });
    await assert.rejects(
      repo.createPending({
        id: id2, tenantId: null, ownerId: null,
        bucket: 'ses-ai-files', objectKey: dup,
        originalFileName: 'z.bin', contentType: 'application/octet-stream',
        sizeBytes: 1, checksumSha256: 'c'.repeat(64),
        storageProvider: 's3', storageEndpoint: null,
      }),
    );
  });

  it('findByChecksum returns the most recent uploaded match', async () => {
    const checksum = 'd'.repeat(64);
    const id = ulid();
    await repo.createPending({
      id, tenantId: 'ses-tenant-default', ownerId: null,
      bucket: 'ses-ai-files',
      objectKey: `ai-pilot/test/cs/${id}-w.bin`,
      originalFileName: 'w.bin', contentType: 'application/octet-stream',
      sizeBytes: 1, checksumSha256: checksum,
      storageProvider: 's3', storageEndpoint: null,
    });
    await repo.markUploaded(id);
    const found = await repo.findByChecksum(checksum, 'ses-tenant-default');
    assert.equal(found?.id, id);
  });
});
