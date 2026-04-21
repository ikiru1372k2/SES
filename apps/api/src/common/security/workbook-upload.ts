import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);

type FileTypeFromBuffer = (input: Uint8Array | ArrayBuffer) => Promise<{ mime: string } | undefined>;
let fileTypeFromBufferCached: FileTypeFromBuffer | null = null;

async function getFileTypeFromBuffer(): Promise<FileTypeFromBuffer> {
  if (!fileTypeFromBufferCached) {
    const mod = (await (0, eval)('import("file-type")')) as typeof import('file-type');
    fileTypeFromBufferCached = mod.fileTypeFromBuffer;
  }
  return fileTypeFromBufferCached;
}

export async function validateWorkbookMultipartAsync(file: Express.Multer.File | undefined): Promise<Buffer> {
  if (!file?.buffer?.byteLength) {
    throw new BadRequestException('A non-empty file is required');
  }
  const buf = file.buffer;
  const fileTypeFromBuffer = await getFileTypeFromBuffer();
  const detected = await fileTypeFromBuffer(buf);
  const mime = detected?.mime ?? '';
  if (!ALLOWED_MIME.has(mime)) {
    throw new UnsupportedMediaTypeException('Workbook must be .xlsx or .xlsm (validated from file contents, not extension)');
  }
  return buf;
}

export function requireMultipartBuffer(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.byteLength) {
    throw new BadRequestException('A non-empty file is required');
  }
  return file.buffer;
}
