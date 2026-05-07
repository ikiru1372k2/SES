/**
 * Hand-written row types for tables consumed by repositories that already
 * exist. The SQL migrations under apps/api/db/migrations/ are the source
 * of truth — these mirror them. Add a type here when (and only when) a
 * repository module starts using it; do not pre-populate types
 * speculatively.
 */

export type UploadedObjectStatus = 'pending' | 'uploaded' | 'failed' | 'deleted';

export interface UploadedObjectRow {
  id: string;
  tenantId: string | null;
  ownerId: string | null;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageProvider: string;
  storageEndpoint: string | null;
  status: UploadedObjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type PdfJobKind = 'extract' | 'summarize';
export type PdfJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PdfProcessingJobRow {
  id: string;
  tenantId: string | null;
  requestedById: string | null;
  idempotencyKey: string;
  kind: PdfJobKind;
  status: PdfJobStatus;
  uploadedObjectId: string;
  attempt: number;
  options: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
