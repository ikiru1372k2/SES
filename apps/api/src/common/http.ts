import { BadRequestException } from '@nestjs/common';

const disallowedFilenameChars = /[\r\n"\\<>|:*?]/g;

export function attachmentContentDisposition(fileName: string, fallbackBase = 'download'): string {
  const base = (fileName || fallbackBase).replace(disallowedFilenameChars, '_').slice(0, 200);
  const ascii = base.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"`;
}

export function parseIfMatch(value: string | undefined): number {
  if (!value) throw new BadRequestException('Missing If-Match header');
  const normalized = value.replace(/"/g, '').trim();
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException('If-Match must be a positive integer');
  }
  return parsed;
}

export function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function fromDateOnly(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}
