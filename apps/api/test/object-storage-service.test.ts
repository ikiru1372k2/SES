import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { ObjectStorageService } from '../src/object-storage/object-storage.service';
import { loadObjectStorageConfig } from '../src/object-storage/object-storage.config';
import { aiPilotObjectKey } from '../src/object-storage/object-key';

const hasMinio = Boolean(process.env.OBJECT_STORAGE_ENDPOINT && process.env.OBJECT_STORAGE_BUCKET);

describe('ObjectStorageService roundtrip', { skip: !hasMinio }, () => {
  let svc: ObjectStorageService;
  let probe: S3Client;

  before(async () => {
    const cfg = loadObjectStorageConfig();
    svc = ObjectStorageService.fromConfig(cfg);
    probe = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
    // Ensure bucket exists — run.sh / minio-init usually does this.
    try {
      await probe.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch {
      // create via mc if available, otherwise skip cleanly
      const r = spawnSync('docker', ['exec', 'ses-minio-init', 'mc', 'mb', '--ignore-existing', `local/${cfg.bucket}`]);
      if (r.status !== 0) {
        // last-ditch via mc inside the running minio container
        spawnSync('docker', ['exec', 'ses-minio', 'mc', 'mb', '--ignore-existing', `local/${cfg.bucket}`]);
      }
    }
  });

  after(() => {
    probe.destroy();
  });

  it('uploads, heads, and presigns a roundtrip object', async () => {
    const body = Buffer.from('hello-object-storage');
    const key = aiPilotObjectKey({ tenantId: 'test', sessionId: 'tx', fileName: 'roundtrip.bin' });
    const result = await svc.putObject({
      objectKey: key,
      body,
      contentType: 'application/octet-stream',
      contentLength: body.length,
    });
    assert.equal(result.bucket, svc.bucket);
    assert.equal(result.objectKey, key);
    assert.equal(result.sizeBytes, body.length);
    assert.equal(result.checksumSha256.length, 64);

    const head = await svc.headObject(key);
    assert.equal(head.exists, true);
    assert.equal(head.sizeBytes, body.length);

    const url = await svc.presignDownloadUrl({ objectKey: key, ttlSeconds: 60 });
    assert.match(url, /X-Amz-Signature=/);

    await svc.deleteObject(key);
    const after = await svc.headObject(key);
    assert.equal(after.exists, false);
  });

  it('reports correct provider/endpoint metadata', () => {
    assert.equal(svc.storageProvider, 's3');
    // For MinIO we expect a non-null endpoint; for AWS S3 it would be null.
    assert.ok(typeof svc.storageEndpoint === 'string');
  });
});
