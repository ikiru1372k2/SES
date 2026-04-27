import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { s3Config } from '../../config/s3.config';

export interface S3UploadResult {
  key: string;
  bucket: string;
  sizeBytes: number;
  sha256Hex: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket = s3Config.bucket;
  private readonly env = process.env.NODE_ENV || 'development';

  constructor() {
    this.client = new S3Client({
      region: s3Config.region,
      ...(s3Config.accessKeyId && s3Config.secretAccessKey
        ? { credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey } }
        : {}),
      ...(s3Config.endpoint ? { endpoint: s3Config.endpoint } : {}),
    });
  }

  buildKey(tenantId: string, category: string, filename: string): string {
    return `${this.env}/${tenantId}/${category}/${filename}`;
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<S3UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ServerSideEncryption: 'AES256',
      }),
    );
    const sha256Hex = createHash('sha256').update(buffer).digest('hex');
    this.logger.debug(`Uploaded ${key} (${buffer.byteLength} bytes)`);
    return { key, bucket: this.bucket, sizeBytes: buffer.byteLength, sha256Hex };
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.debug(`Deleted ${key}`);
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${srcKey}`,
        Key: destKey,
        ServerSideEncryption: 'AES256',
      }),
    );
  }
}
