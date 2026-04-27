/**
 * Helpers that convert Prisma WorkbookFile rows into the DomainWorkbookFile
 * shape required by the audit engine. Shared between AuditRunnerService and
 * AuditAnalyticsService to avoid duplication.
 */
import { NotFoundException } from '@nestjs/common';
import type { AuditIssue, WorkbookFile as DomainWorkbookFile } from '@ses/domain';
import type { PrismaService } from '../../common/prisma.service';

export async function buildDomainFile(
  prisma: PrismaService,
  fileId: string,
): Promise<DomainWorkbookFile> {
  const file = await prisma.workbookFile.findUnique({
    where: { id: fileId },
    include: { sheets: { orderBy: { sheetName: 'asc' } } },
  });
  if (!file) throw new NotFoundException(`File ${fileId} not found`);
  return {
    id: file.id,
    displayCode: file.displayCode,
    name: file.name,
    processId: file.processId,
    rowVersion: file.rowVersion,
    uploadedAt: file.uploadedAt.toISOString(),
    lastAuditedAt: file.lastAuditedAt?.toISOString() ?? null,
    isAudited: Boolean(file.lastAuditedAt),
    rawData: Object.fromEntries(file.sheets.map((sheet) => [sheet.sheetName, (sheet.rows as unknown[][]) ?? []])),
    sheets: file.sheets.map((sheet) => ({
      id: sheet.id,
      displayCode: sheet.displayCode,
      name: sheet.sheetName,
      status: sheet.status as DomainWorkbookFile['sheets'][number]['status'],
      rowCount: sheet.rowCount,
      isSelected: sheet.isSelected,
      headerRowIndex: sheet.headerRowIx ?? undefined,
      originalHeaders: (sheet.originalHeaders as string[] | null) ?? undefined,
      normalizedHeaders: (sheet.normalizedHeaders as string[] | null) ?? undefined,
    })),
  };
}

export function severitySummary(issues: AuditIssue[]) {
  return {
    high: issues.filter((issue) => issue.severity === 'High').length,
    medium: issues.filter((issue) => issue.severity === 'Medium').length,
    low: issues.filter((issue) => issue.severity === 'Low').length,
  };
}
