/**
 * Strict env-driven config. Same env spec works for MinIO (local) and
 * AWS S3 (prod) without code changes.
 *
 * Multi-bucket layout (each purpose has its own bucket):
 *   - workbooks  uploaded Master Data / regular workbooks + their versions/drafts
 *   - aiPilot    AI Pilot sandbox uploads (Excel/CSV — short-lived)
 *   - pdfs       PDF processing pipeline payloads
 *
 * Bucket names are env-overridable per purpose. If a per-purpose env
 * var is unset, the legacy single `OBJECT_STORAGE_BUCKET` is used as
 * the fallback so existing configs keep working.
 */

export type BucketPurpose = 'workbooks' | 'ai-pilot' | 'pdfs';

export interface ObjectStorageBuckets {
  workbooks: string;
  aiPilot: string;
  pdfs: string;
}

export interface ObjectStorageConfig {
  driver: 's3';
  /** When set, points at a non-AWS S3-compatible endpoint (MinIO). When empty, AWS default resolution applies. */
  endpoint: string | undefined;
  region: string;
  /** Default bucket — preserved for callers that don't pass one explicitly. Equal to `buckets.aiPilot`. */
  bucket: string;
  buckets: ObjectStorageBuckets;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
}

export class ObjectStorageConfigError extends Error {
  constructor(message: string) {
    super(`object-storage config: ${message}`);
    this.name = 'ObjectStorageConfigError';
  }
}

export function loadObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig {
  const driver = (env.OBJECT_STORAGE_DRIVER ?? 's3').trim().toLowerCase();
  if (driver !== 's3') {
    throw new ObjectStorageConfigError(
      `unsupported OBJECT_STORAGE_DRIVER='${driver}'. Only 's3' is supported (MinIO and AWS S3 both speak S3).`,
    );
  }

  const region = (env.OBJECT_STORAGE_REGION ?? '').trim();
  const legacyBucket = (env.OBJECT_STORAGE_BUCKET ?? '').trim();
  const accessKey = (env.OBJECT_STORAGE_ACCESS_KEY ?? '').trim();
  const secretKey = env.OBJECT_STORAGE_SECRET_KEY ?? '';
  const endpointRaw = (env.OBJECT_STORAGE_ENDPOINT ?? '').trim();
  const endpoint = endpointRaw === '' ? undefined : endpointRaw;

  // Per-purpose bucket env vars fall back to the legacy single bucket.
  const workbooksBucket =
    (env.OBJECT_STORAGE_BUCKET_WORKBOOKS ?? '').trim() || legacyBucket;
  const aiPilotBucket =
    (env.OBJECT_STORAGE_BUCKET_AI_PILOT ?? '').trim() || legacyBucket;
  const pdfsBucket =
    (env.OBJECT_STORAGE_BUCKET_PDFS ?? '').trim() || legacyBucket;

  if (!region) throw new ObjectStorageConfigError('OBJECT_STORAGE_REGION is required');
  if (!accessKey)
    throw new ObjectStorageConfigError('OBJECT_STORAGE_ACCESS_KEY is required');
  if (!secretKey)
    throw new ObjectStorageConfigError('OBJECT_STORAGE_SECRET_KEY is required');
  if (!workbooksBucket)
    throw new ObjectStorageConfigError(
      'OBJECT_STORAGE_BUCKET_WORKBOOKS or OBJECT_STORAGE_BUCKET is required',
    );
  if (!aiPilotBucket)
    throw new ObjectStorageConfigError(
      'OBJECT_STORAGE_BUCKET_AI_PILOT or OBJECT_STORAGE_BUCKET is required',
    );
  if (!pdfsBucket)
    throw new ObjectStorageConfigError(
      'OBJECT_STORAGE_BUCKET_PDFS or OBJECT_STORAGE_BUCKET is required',
    );

  // MinIO needs forcePathStyle=true; AWS S3 uses virtual-host addressing.
  const rawForce = (env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? '').trim().toLowerCase();
  const forcePathStyle =
    rawForce === ''
      ? endpoint !== undefined
      : rawForce === 'true' || rawForce === '1' || rawForce === 'yes';

  const ttlRaw = (env.OBJECT_STORAGE_PRESIGN_TTL_SECONDS ?? '900').trim();
  const presignTtlSeconds = Number.parseInt(ttlRaw, 10);
  if (!Number.isFinite(presignTtlSeconds) || presignTtlSeconds <= 0) {
    throw new ObjectStorageConfigError(
      `OBJECT_STORAGE_PRESIGN_TTL_SECONDS must be a positive integer, got '${ttlRaw}'`,
    );
  }

  const buckets: ObjectStorageBuckets = {
    workbooks: workbooksBucket,
    aiPilot: aiPilotBucket,
    pdfs: pdfsBucket,
  };

  return {
    driver: 's3',
    endpoint,
    region,
    // Legacy default for callers that don't specify a purpose.
    bucket: aiPilotBucket,
    buckets,
    accessKey,
    secretKey,
    forcePathStyle,
    presignTtlSeconds,
  };
}

/** Strip secrets — safe to log. */
export function redactedConfig(cfg: ObjectStorageConfig): Record<string, unknown> {
  return {
    driver: cfg.driver,
    endpoint: cfg.endpoint ?? '(aws-default)',
    region: cfg.region,
    buckets: cfg.buckets,
    forcePathStyle: cfg.forcePathStyle,
    presignTtlSeconds: cfg.presignTtlSeconds,
  };
}

export function bucketFor(cfg: ObjectStorageConfig, purpose: BucketPurpose): string {
  switch (purpose) {
    case 'workbooks':
      return cfg.buckets.workbooks;
    case 'ai-pilot':
      return cfg.buckets.aiPilot;
    case 'pdfs':
      return cfg.buckets.pdfs;
  }
}
