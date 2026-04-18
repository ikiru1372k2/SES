import { BadRequestException } from '@nestjs/common';

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);

export function assertWorkbookUpload(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.byteLength) {
    throw new BadRequestException('A non-empty file is required');
  }
  const buf = file.buffer;
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new BadRequestException('Invalid workbook: file must be a ZIP-based Office document (.xlsx / .xlsm)');
  }
  const mime = (file.mimetype || '').toLowerCase().split(';')[0]?.trim() || '';
  if (mime && !ALLOWED_MIME.has(mime)) {
    throw new BadRequestException('Unsupported Content-Type for workbook upload');
  }
  return buf;
}
