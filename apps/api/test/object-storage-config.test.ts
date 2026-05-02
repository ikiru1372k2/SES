import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  loadObjectStorageConfig,
  redactedConfig,
  ObjectStorageConfigError,
} from '../src/object-storage';

const MINIO = {
  OBJECT_STORAGE_DRIVER: 's3',
  OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'ses-ai-files',
  OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
  OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
  OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
};

const AWS = {
  OBJECT_STORAGE_DRIVER: 's3',
  OBJECT_STORAGE_ENDPOINT: '',
  OBJECT_STORAGE_REGION: 'ap-south-1',
  OBJECT_STORAGE_BUCKET: 'prod-bucket',
  OBJECT_STORAGE_ACCESS_KEY: 'AKIA...',
  OBJECT_STORAGE_SECRET_KEY: 'shhhhh',
  OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
};

describe('object-storage config (env-only provider switch)', () => {
  it('loads MinIO config when endpoint is set', () => {
    const cfg = loadObjectStorageConfig(MINIO as NodeJS.ProcessEnv);
    assert.equal(cfg.driver, 's3');
    assert.equal(cfg.endpoint, 'http://localhost:9000');
    assert.equal(cfg.region, 'us-east-1');
    assert.equal(cfg.bucket, 'ses-ai-files');
    assert.equal(cfg.forcePathStyle, true);
  });

  it('loads AWS S3 config when endpoint is empty', () => {
    const cfg = loadObjectStorageConfig(AWS as NodeJS.ProcessEnv);
    assert.equal(cfg.endpoint, undefined);
    assert.equal(cfg.region, 'ap-south-1');
    assert.equal(cfg.forcePathStyle, false);
  });

  it('forcePathStyle defaults to true when an endpoint is set, false otherwise', () => {
    const minioNoFlag = loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_FORCE_PATH_STYLE: '' } as NodeJS.ProcessEnv);
    assert.equal(minioNoFlag.forcePathStyle, true);
    const awsNoFlag = loadObjectStorageConfig({ ...AWS, OBJECT_STORAGE_FORCE_PATH_STYLE: '' } as NodeJS.ProcessEnv);
    assert.equal(awsNoFlag.forcePathStyle, false);
  });

  it('rejects missing required vars', () => {
    assert.throws(
      () => loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_BUCKET: '' } as NodeJS.ProcessEnv),
      ObjectStorageConfigError,
    );
    assert.throws(
      () => loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_ACCESS_KEY: '' } as NodeJS.ProcessEnv),
      ObjectStorageConfigError,
    );
    assert.throws(
      () => loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_REGION: '' } as NodeJS.ProcessEnv),
      ObjectStorageConfigError,
    );
  });

  it('rejects unsupported drivers', () => {
    assert.throws(
      () => loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_DRIVER: 'azure' } as NodeJS.ProcessEnv),
      ObjectStorageConfigError,
    );
  });

  it('rejects invalid presign TTL', () => {
    assert.throws(
      () => loadObjectStorageConfig({ ...MINIO, OBJECT_STORAGE_PRESIGN_TTL_SECONDS: 'banana' } as NodeJS.ProcessEnv),
      ObjectStorageConfigError,
    );
  });

  it('redactedConfig never exposes credentials', () => {
    const cfg = loadObjectStorageConfig(MINIO as NodeJS.ProcessEnv);
    const r = redactedConfig(cfg);
    const json = JSON.stringify(r);
    assert.equal(json.includes('minioadmin'), false);
    assert.equal((r as { accessKey?: string }).accessKey, undefined);
    assert.equal((r as { secretKey?: string }).secretKey, undefined);
  });
});
