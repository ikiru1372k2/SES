import { ulid } from 'ulid';

/**
 * Sanitize a user-supplied filename for use in an object key. Keeps
 * letters, digits, dot, dash, underscore. Collapses runs of unsafe
 * characters into a single dash. Limits length to 120 chars (S3 max
 * object key is 1024 — this is a safety margin for the prefix).
 */
export function sanitizeFileName(input: string): string {
  const trimmed = (input ?? '').toString().trim();
  if (!trimmed) return 'file';
  const cleaned = trimmed
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // Strip leading dots/dashes so `../etc/passwd` becomes `etc-passwd` rather
    // than `..-etc-passwd`. Object keys are prefixed safely either way, but
    // surfacing dotty leaders in metadata/logs is misleading.
    .replace(/^[.\-]+/, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = cleaned || 'file';
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

export interface AiPilotKeyParts {
  tenantId: string;
  sessionId: string;
  fileName: string;
}

/**
 * Collision-safe object key for AI Pilot uploads:
 *   ai-pilot/{tenantId}/{sessionId}/{ULID}-{safeFileName}
 * The ULID guarantees uniqueness even if the same user uploads the same
 * filename twice in the same session.
 */
export function aiPilotObjectKey(parts: AiPilotKeyParts): string {
  const safeTenant = sanitizeFileName(parts.tenantId || 'default');
  const safeSession = sanitizeFileName(parts.sessionId || 'no-session');
  const safeName = sanitizeFileName(parts.fileName);
  return `ai-pilot/${safeTenant}/${safeSession}/${ulid()}-${safeName}`;
}

export interface WorkbookKeyParts {
  tenantId: string;
  processCode: string;
  fileCode: string;
  versionNumber: number;
  fileName: string;
}

/**
 * Workbook upload key:
 *   workbooks/{tenant}/{processCode}/{fileCode}/v{N}-{ULID}-{safeFileName}
 * Lives in the `ses-workbooks` bucket. The fileCode segment makes it
 * straightforward to inspect a single workbook's history in MinIO/S3.
 */
export function workbookObjectKey(parts: WorkbookKeyParts): string {
  const tenant = sanitizeFileName(parts.tenantId || 'default');
  const proc = sanitizeFileName(parts.processCode || 'no-process');
  const file = sanitizeFileName(parts.fileCode || 'no-file');
  const name = sanitizeFileName(parts.fileName);
  const version = Math.max(1, Math.floor(parts.versionNumber || 1));
  return `workbooks/${tenant}/${proc}/${file}/v${version}-${ulid()}-${name}`;
}

export interface WorkbookDraftKeyParts {
  tenantId: string;
  processCode: string;
  userId: string;
  functionId: string;
  fileName: string;
}

/**
 * In-progress draft key:
 *   drafts/{tenant}/{processCode}/{userId}/{functionId}/{ULID}-{safeFileName}
 * Drafts live in the same `ses-workbooks` bucket but in a `drafts/` prefix
 * so retention rules can target them separately if required.
 */
export function workbookDraftObjectKey(parts: WorkbookDraftKeyParts): string {
  const tenant = sanitizeFileName(parts.tenantId || 'default');
  const proc = sanitizeFileName(parts.processCode || 'no-process');
  const user = sanitizeFileName(parts.userId || 'no-user');
  const fn = sanitizeFileName(parts.functionId || 'no-function');
  const name = sanitizeFileName(parts.fileName);
  return `drafts/${tenant}/${proc}/${user}/${fn}/${ulid()}-${name}`;
}

export interface PdfKeyParts {
  tenantId: string;
  jobId: string;
  fileName: string;
}

/**
 * PDF processing input key:
 *   pdf/{tenant}/{jobId}/{ULID}-{safeFileName}
 * Lives in the `ses-ai-pdfs` bucket so PDF retention/lifecycle is
 * independent of workbook and AI-pilot data.
 */
export function pdfObjectKey(parts: PdfKeyParts): string {
  const tenant = sanitizeFileName(parts.tenantId || 'default');
  const job = sanitizeFileName(parts.jobId || 'no-job');
  const name = sanitizeFileName(parts.fileName);
  return `pdf/${tenant}/${job}/${ulid()}-${name}`;
}
