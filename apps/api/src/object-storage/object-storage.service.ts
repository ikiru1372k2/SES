import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import {
  BucketPurpose,
  ObjectStorageConfig,
  bucketFor,
  loadObjectStorageConfig,
} from './object-storage.config';

export interface PutObjectInput {
  objectKey: string;
  body: Buffer | Readable;
  contentType: string;
  contentLength?: number;
  /** Pre-computed sha256 of the body — used to set x-amz-checksum-sha256. Optional. */
  checksumSha256?: string;
  /**
   * Which logical bucket to write to. Defaults to the legacy single
   * bucket (== ai-pilot under the new layout) so existing callers that
   * don't pass this still work.
   */
  bucket?: BucketPurpose;
}

export interface PutObjectResult {
  bucket: string;
  objectKey: string;
  etag: string | undefined;
  sizeBytes: number;
  checksumSha256: string;
  storageProvider: 's3';
  storageEndpoint: string | null;
}

export interface PresignDownloadInput {
  objectKey: string;
  /** Override default TTL. Capped at 7 days (S3 max for SigV4). */
  ttlSeconds?: number;
  /** Which logical bucket the object lives in. Defaults to the legacy single bucket. */
  bucket?: BucketPurpose;
  /**
   * Bypass the purpose lookup and use this exact bucket name. Useful
   * when the bucket is already known from a stored metadata row.
   */
  bucketName?: string;
}

export const OBJECT_STORAGE_CONFIG = Symbol('OBJECT_STORAGE_CONFIG');
export const S3_CLIENT = Symbol('S3_CLIENT');

const TRANSIENT_S3_CODES = new Set([
  'RequestTimeout',
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
  'ThrottlingException',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
]);

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

/**
 * S3-compatible object storage. Same code targets MinIO (endpoint set,
 * forcePathStyle=true) and AWS S3 (endpoint empty, forcePathStyle=false).
 *
 * Never logs request/response bodies. Never returns access keys.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private cfg: ObjectStorageConfig | undefined;
  private client: S3Client | undefined;

  // Decorator-free zero-arg constructor: keeps Nest DI happy without
  // needing a parameter decorator (which `tsx` chokes on under
  // experimentalDecorators=false in test mode). Tests that need a
  // custom config call `ObjectStorageService.fromConfig(cfg, client)`.
  constructor() {}

  static fromConfig(cfg: ObjectStorageConfig, client?: S3Client): ObjectStorageService {
    const instance = Object.create(ObjectStorageService.prototype) as ObjectStorageService;
    Object.assign(instance, {
      logger: new Logger(ObjectStorageService.name),
      cfg,
      client: client ?? buildS3Client(cfg),
    });
    return instance;
  }

  onModuleInit(): void {
    this.logger.log('object-storage config will be loaded on first use');
  }

  private config(): ObjectStorageConfig {
    this.cfg ??= loadObjectStorageConfig();
    return this.cfg;
  }

  private s3(): S3Client {
    this.client ??= buildS3Client(this.config());
    return this.client;
  }

  /**
   * Default bucket — historical AI Pilot bucket. New code should pass
   * a `bucket` purpose explicitly to `putObject`/`presign` etc.
   */
  get bucket(): string {
    return this.config().bucket;
  }

  bucketFor(purpose: BucketPurpose): string {
    return bucketFor(this.config(), purpose);
  }

  get storageEndpoint(): string | null {
    return this.config().endpoint ?? null;
  }

  get storageProvider(): 's3' {
    return 's3';
  }

  /**
   * Resolve the SDK-level Bucket parameter from a purpose, an explicit
   * bucket name, or the default. Internal helper.
   */
  private resolveBucketName(input: { bucket?: BucketPurpose; bucketName?: string }): string {
    if (input.bucketName) return input.bucketName;
    const cfg = this.config();
    if (input.bucket) return bucketFor(cfg, input.bucket);
    return cfg.bucket;
  }

  /**
   * Streamed upload via @aws-sdk/lib-storage. The body may be a Buffer
   * or a Readable; large bodies are multipart-uploaded automatically.
   */
  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const checksum =
      input.checksumSha256 ?? (Buffer.isBuffer(input.body) ? sha256Hex(input.body) : '');
    const sizeBytes =
      input.contentLength ?? (Buffer.isBuffer(input.body) ? input.body.length : 0);
    const bucketName = this.resolveBucketName(input);

    return this.withRetry('putObject', async () => {
      const upload = new Upload({
        client: this.s3(),
        params: {
          Bucket: bucketName,
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        },
      });
      const r = await upload.done();
      return {
        bucket: bucketName,
        objectKey: input.objectKey,
        etag: r.ETag,
        sizeBytes,
        checksumSha256: checksum,
        storageProvider: 's3',
        storageEndpoint: this.config().endpoint ?? null,
      } satisfies PutObjectResult;
    });
  }

  async headObject(
    objectKey: string,
    opts: { bucket?: BucketPurpose; bucketName?: string } = {},
  ): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    const bucketName = this.resolveBucketName(opts);
    try {
      const r = await this.s3().send(
        new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
      );
      return {
        exists: true,
        sizeBytes: r.ContentLength ?? undefined,
        contentType: r.ContentType ?? undefined,
      };
    } catch (err) {
      if (err instanceof S3ServiceException && err.name === 'NotFound') {
        return { exists: false };
      }
      throw err;
    }
  }

  async getObjectStream(
    objectKey: string,
    opts: { bucket?: BucketPurpose; bucketName?: string } = {},
  ): Promise<Readable> {
    const bucketName = this.resolveBucketName(opts);
    const r = await this.s3().send(
      new GetObjectCommand({ Bucket: bucketName, Key: objectKey }),
    );
    if (!r.Body) throw new Error(`empty body for ${bucketName}/${objectKey}`);
    if (r.Body instanceof Readable) return r.Body;
    if (typeof (r.Body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
      return Readable.fromWeb(
        (r.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream() as never,
      );
    }
    throw new Error('unexpected S3 body type');
  }

  /** Read a whole object into a Buffer. Use only for small objects. */
  async getObjectBuffer(
    objectKey: string,
    opts: { bucket?: BucketPurpose; bucketName?: string } = {},
  ): Promise<Buffer> {
    const stream = await this.getObjectStream(objectKey, opts);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(
    objectKey: string,
    opts: { bucket?: BucketPurpose; bucketName?: string } = {},
  ): Promise<void> {
    const bucketName = this.resolveBucketName(opts);
    await this.withRetry('deleteObject', () =>
      this.s3().send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey })),
    );
  }

  /**
   * Pre-signed GET URL. The AI sidecar (or browser) can fetch the object
   * directly without seeing our credentials.
   */
  async presignDownloadUrl(input: PresignDownloadInput): Promise<string> {
    const ttl = clampTtl(input.ttlSeconds ?? this.config().presignTtlSeconds);
    const bucketName = this.resolveBucketName(input);
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({ Bucket: bucketName, Key: input.objectKey }),
      { expiresIn: ttl },
    );
  }

  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < MAX_RETRIES) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt === MAX_RETRIES - 1) throw err;
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        this.logger.warn(`${op} transient failure (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoff}ms`);
        await sleep(backoff);
        attempt += 1;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${op} failed`);
  }
}

export function buildS3Client(cfg: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function isTransient(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return TRANSIENT_S3_CODES.has(err.name);
  }
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && TRANSIENT_S3_CODES.has(code);
}

function clampTtl(seconds: number): number {
  const max = 7 * 24 * 60 * 60;
  if (seconds < 1) return 1;
  if (seconds > max) return max;
  return Math.floor(seconds);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
